import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import {
  buildPageSettingsUpdate,
  createPageSettingsDraft,
  hasRemotePageSettingsChanged,
  isPageSettingsDraftDirty,
  type PageSettingsDraft,
} from '../domain/pageSettingsDraft';
import type { PageRecord, UpdatePageSettingsInput } from '../lib/api';
import { showDirtyStoryPrompt, type DirtyStoryAction } from '../lib/dirtyStoryPrompt';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';
import { StorySelectionSection } from './StorySelectionSection';

export interface PageSettingsSectionHandle {
  prepareToLeave(): Promise<boolean>;
}

export interface PageSettingsApiPort {
  updatePageSettings(
    pageId: string,
    body: UpdatePageSettingsInput,
    organizationId?: string | null,
  ): Promise<PageRecord>;
}

interface PageSettingsSectionProps {
  api: PageSettingsApiPort;
  editingBlocked: boolean;
  episodeId: string;
  language: UiLanguage;
  organizationId: string | null;
  pageListReady: boolean;
  pages: readonly PageRecord[];
  refreshPages(): Promise<readonly PageRecord[]>;
  resolveDirtyAction?: () => Promise<DirtyStoryAction>;
  sessionKey: string;
}

interface PageListCache {
  pages: PageRecord[];
  next_cursor?: string | null;
}

const DIALOGUE_MODES: readonly {
  labelKey: MessageKey;
  value: PageRecord['dialogue_mode'];
}[] = [
  { labelKey: 'pageSettingsModeImageBaked', value: 'image_baked' },
  { labelKey: 'pageSettingsModeBalloonOnly', value: 'balloon_only' },
  { labelKey: 'pageSettingsModeMixed', value: 'mixed' },
];

export const PageSettingsSection = forwardRef<
  PageSettingsSectionHandle,
  PageSettingsSectionProps
>(function PageSettingsSection({
  api,
  editingBlocked,
  episodeId,
  language,
  organizationId,
  pageListReady,
  pages,
  refreshPages,
  resolveDirtyAction,
  sessionKey,
}, ref): React.JSX.Element {
  const queryClient = useQueryClient();
  const queryKeys = useMemo(
    () => storyQueryKeys(sessionKey, organizationId),
    [organizationId, sessionKey],
  );
  const scopeKey = `${sessionKey}:${organizationId ?? 'personal'}:${episodeId}`;
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [savedPage, setSavedPage] = useState<PageRecord | null>(null);
  const [savedDraft, setSavedDraft] = useState<PageSettingsDraft | null>(null);
  const [draft, setDraft] = useState<PageSettingsDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const saveOperation = useRef<Promise<boolean> | null>(null);
  const transitionOperation = useRef<Promise<boolean> | null>(null);

  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const dirty = savedDraft !== null
    && draft !== null
    && isPageSettingsDraftDirty(savedDraft, draft);
  const remoteChanged = dirty
    && savedPage !== null
    && pageListReady
    && (
      selectedPage === null
      || hasRemotePageSettingsChanged(savedPage, selectedPage)
    );
  const readOnly = selectedPage === null
    || selectedPage.status === 'confirmed'
    || selectedPage.status === 'generating'
    || editingBlocked;

  const applySelectedPage = useCallback((page: PageRecord | null): void => {
    setSelectedPageId(page?.id ?? null);
    setSavedPage(page);
    const nextDraft = page === null ? null : createPageSettingsDraft(page);
    setSavedDraft(nextDraft);
    setDraft(nextDraft);
  }, []);

  useEffect(() => {
    applySelectedPage(null);
    setErrorMessage(null);
    setNoticeMessage(null);
  }, [applySelectedPage, scopeKey]);

  useEffect(() => {
    if (selectedPageId !== null && selectedPage === null && !dirty) {
      applySelectedPage(null);
    }
  }, [applySelectedPage, dirty, selectedPage, selectedPageId]);

  useEffect(() => {
    if (selectedPage === null || dirty || savedPage === selectedPage) {
      return;
    }
    applySelectedPage(selectedPage);
  }, [applySelectedPage, dirty, savedPage, selectedPage]);

  const saveCurrentPage = useCallback((): Promise<boolean> => {
    if (saveOperation.current !== null) {
      return saveOperation.current;
    }
    if (!dirty) {
      return Promise.resolve(true);
    }
    if (
      selectedPage === null
      || selectedPageId === null
      || savedPage === null
      || savedDraft === null
      || draft === null
    ) {
      setNoticeMessage(null);
      setErrorMessage(t(language, 'pageSettingsSaveError'));
      return Promise.resolve(false);
    }
    if (readOnly) {
      setNoticeMessage(null);
      setErrorMessage(t(language, 'pageSettingsSaveBlocked'));
      return Promise.resolve(false);
    }
    if (remoteChanged) {
      setNoticeMessage(null);
      setErrorMessage(t(language, 'pageSettingsRemoteChanged'));
      return Promise.resolve(false);
    }
    const payload = buildPageSettingsUpdate(savedDraft, draft);
    if (Object.keys(payload).length === 0) {
      setSavedDraft(draft);
      return Promise.resolve(true);
    }

    const operationScope = scopeKey;
    const operationPageId = selectedPageId;
    setBusy(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    let operation: Promise<boolean> | null = null;
    operation = (async (): Promise<boolean> => {
      try {
        const freshPages = await refreshPages();
        if (currentScope.current !== operationScope) {
          return false;
        }
        const remotePage = freshPages.find((page) => page.id === operationPageId);
        if (
          remotePage === undefined
          || remotePage.episode_id !== episodeId
          || hasRemotePageSettingsChanged(savedPage, remotePage)
        ) {
          setErrorMessage(t(language, 'pageSettingsRemoteChanged'));
          return false;
        }
        if (remotePage.status === 'confirmed' || remotePage.status === 'generating') {
          setErrorMessage(t(language, 'pageSettingsReadOnly'));
          return false;
        }
        const updated = await api.updatePageSettings(
          operationPageId,
          payload,
          organizationId,
        );
        if (
          currentScope.current !== operationScope
          || updated.id !== operationPageId
          || updated.episode_id !== episodeId
        ) {
          if (currentScope.current === operationScope) {
            setErrorMessage(t(language, 'pageSettingsSaveError'));
          }
          return false;
        }
        queryClient.setQueryData<PageListCache>(
          queryKeys.pages(episodeId),
          (current) => current === undefined
            ? current
            : { ...current, pages: upsertPage(current.pages, updated) },
        );
        applySelectedPage(updated);
        setNoticeMessage(t(language, 'pageSettingsSaved'));
        return true;
      } catch {
        if (currentScope.current === operationScope) {
          setErrorMessage(t(language, 'pageSettingsSaveError'));
        }
        return false;
      } finally {
        setBusy(false);
        if (saveOperation.current === operation) {
          saveOperation.current = null;
        }
      }
    })();
    saveOperation.current = operation;
    return operation;
  }, [
    api,
    applySelectedPage,
    dirty,
    draft,
    episodeId,
    language,
    organizationId,
    queryClient,
    queryKeys,
    readOnly,
    refreshPages,
    remoteChanged,
    savedDraft,
    savedPage,
    scopeKey,
    selectedPage,
    selectedPageId,
  ]);

  const resolvePendingPage = useCallback(async (): Promise<boolean> => {
    if (saveOperation.current !== null) {
      return saveOperation.current;
    }
    if (!dirty) {
      return true;
    }
    const action = resolveDirtyAction === undefined
      ? await showDirtyStoryPrompt(language)
      : await resolveDirtyAction();
    if (action === 'cancel') {
      return false;
    }
    if (action === 'discard') {
      setDraft(savedDraft);
      setErrorMessage(null);
      setNoticeMessage(null);
      return true;
    }
    return saveCurrentPage();
  }, [dirty, language, resolveDirtyAction, saveCurrentPage, savedDraft]);

  useImperativeHandle(ref, () => ({
    prepareToLeave: resolvePendingPage,
  }), [resolvePendingPage]);

  const transition = useCallback((changeSelection: () => void): Promise<boolean> => {
    if (transitionOperation.current !== null) {
      return transitionOperation.current;
    }
    const operation = (async (): Promise<boolean> => {
      if (!(await resolvePendingPage())) {
        return false;
      }
      changeSelection();
      return true;
    })();
    transitionOperation.current = operation;
    void operation.finally(() => {
      if (transitionOperation.current === operation) {
        transitionOperation.current = null;
      }
    });
    return operation;
  }, [resolvePendingPage]);

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{t(language, 'pageSettings')}</Text>
      <Text style={styles.muted}>{t(language, 'pageSettingsHelp')}</Text>
      {pageListReady ? (
        <StorySelectionSection
          emptyMessage={t(language, 'pageEmpty')}
          error={false}
          errorMessage={t(language, 'pageLoadError')}
          heading={t(language, 'pageSettingsTarget')}
          items={pages.map((page) => ({
            id: page.id,
            label: t(language, 'pageSettingsPageLabel', {
              number: String(page.page_number),
            }),
          }))}
          loading={false}
          loadingMessage={t(language, 'pageLoading')}
          onRetry={() => undefined}
          onSelect={(pageId) => {
            const page = pages.find((candidate) => candidate.id === pageId);
            if (
              page !== undefined
              && (page.id !== selectedPageId || remoteChanged)
            ) {
              void transition(() => {
                applySelectedPage(page);
                setErrorMessage(null);
                setNoticeMessage(null);
              });
            }
          }}
          retryLabel={t(language, 'pageListRetry')}
          selectedId={selectedPageId}
          selectSuffix={t(language, 'storySelectSuffix')}
        />
      ) : null}
      {draft === null ? null : (
        <View style={styles.editor}>
          <Text style={styles.subheading}>{t(language, 'pageSettingsDialogueMode')}</Text>
          <View style={styles.choices}>
            {DIALOGUE_MODES.map((mode) => (
              <Pressable
                accessibilityLabel={t(language, mode.labelKey)}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: readOnly || busy,
                  selected: draft.dialogue_mode === mode.value,
                }}
                disabled={readOnly || busy}
                key={mode.value}
                onPress={() => {
                  setDraft({ ...draft, dialogue_mode: mode.value });
                  setErrorMessage(null);
                  setNoticeMessage(null);
                }}
                style={({ pressed }) => [
                  styles.choice,
                  draft.dialogue_mode === mode.value && styles.choiceSelected,
                  (readOnly || busy) && styles.disabled,
                  pressed && !readOnly && !busy && styles.pressed,
                ]}
              >
                <Text style={styles.choiceText}>{t(language, mode.labelKey)}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityLabel={t(
              language,
              draft.page_dialogue_toggle
                ? 'pageSettingsDialogueHide'
                : 'pageSettingsDialogueShow',
            )}
            accessibilityRole="button"
            accessibilityState={{
              disabled: readOnly || busy,
              selected: draft.page_dialogue_toggle,
            }}
            disabled={readOnly || busy}
            onPress={() => {
              setDraft({
                ...draft,
                page_dialogue_toggle: !draft.page_dialogue_toggle,
              });
              setErrorMessage(null);
              setNoticeMessage(null);
            }}
            style={({ pressed }) => [
              styles.choice,
              draft.page_dialogue_toggle && styles.choiceSelected,
              (readOnly || busy) && styles.disabled,
              pressed && !readOnly && !busy && styles.pressed,
            ]}
          >
            <Text style={styles.choiceText}>
              {t(
                language,
                draft.page_dialogue_toggle
                  ? 'pageSettingsDialogueEnabled'
                  : 'pageSettingsDialogueDisabled',
              )}
            </Text>
          </Pressable>
          {selectedPage?.status === 'confirmed' || selectedPage?.status === 'generating' ? (
            <Notice message={t(language, 'pageSettingsReadOnly')} tone="danger" />
          ) : null}
          {remoteChanged ? (
            <Notice message={t(language, 'pageSettingsRemoteChanged')} tone="danger" />
          ) : null}
          {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
          {noticeMessage === null ? null : <Notice message={noticeMessage} />}
          <PrimaryButton
            disabled={!dirty || readOnly || remoteChanged}
            label={t(language, 'pageSettingsSave')}
            loading={busy}
            onPress={() => void saveCurrentPage()}
          />
        </View>
      )}
    </View>
  );
});

function upsertPage(pages: readonly PageRecord[], page: PageRecord): PageRecord[] {
  return pages.some((candidate) => candidate.id === page.id)
    ? pages.map((candidate) => candidate.id === page.id ? page : candidate)
    : [...pages, page];
}

const styles = StyleSheet.create({
  choice: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    padding: spacing.sm,
  },
  choiceSelected: {
    borderColor: colors.accent,
  },
  choiceText: {
    color: colors.ink,
    fontSize: 15,
  },
  choices: {
    gap: spacing.xs,
  },
  disabled: {
    opacity: 0.5,
  },
  editor: {
    gap: spacing.sm,
  },
  heading: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.75,
  },
  section: {
    gap: spacing.md,
  },
  subheading: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
  },
});
