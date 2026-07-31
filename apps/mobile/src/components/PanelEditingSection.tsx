import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import {
  buildPanelUpdate,
  createPanelDraft,
  isPanelDraftDirty,
  type PanelDraft,
  type PanelDraftValidationReason,
} from '../domain/panelDraft';
import type { PageRecord, PanelRecord, UpdatePanelInput } from '../lib/api';
import { showDirtyStoryPrompt, type DirtyStoryAction } from '../lib/dirtyStoryPrompt';
import { t, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';
import { colors, spacing } from '../constants/theme';
import { PanelEditor } from './PanelEditor';
import { StorySelectionSection } from './StorySelectionSection';

export interface PanelEditingSectionHandle {
  prepareToLeave(): Promise<boolean>;
}

export interface PanelEditingApiPort {
  getPanels(
    pageId: string,
    organizationId?: string | null,
  ): Promise<{ panels: PanelRecord[] }>;
  updatePanel(
    panelId: string,
    body: UpdatePanelInput,
    organizationId?: string | null,
  ): Promise<PanelRecord>;
}

interface PanelEditingSectionProps {
  api: PanelEditingApiPort;
  generationActive: boolean;
  language: UiLanguage;
  organizationId: string | null;
  pageListReady: boolean;
  pages: readonly PageRecord[];
  resolveDirtyAction?: () => Promise<DirtyStoryAction>;
  sessionKey: string;
}

export const PanelEditingSection = forwardRef<
  PanelEditingSectionHandle,
  PanelEditingSectionProps
>(function PanelEditingSection({
  api,
  generationActive,
  language,
  organizationId,
  pageListReady,
  pages,
  resolveDirtyAction,
  sessionKey,
}, ref): React.JSX.Element {
  const queryClient = useQueryClient();
  const queryKeys = useMemo(
    () => storyQueryKeys(sessionKey, organizationId),
    [organizationId, sessionKey],
  );
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [savedPanel, setSavedPanel] = useState<PanelRecord | null>(null);
  const [savedDraft, setSavedDraft] = useState<PanelDraft | null>(null);
  const [draft, setDraft] = useState<PanelDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [validationReason, setValidationReason] = useState<PanelDraftValidationReason | null>(null);
  const saveOperation = useRef<Promise<boolean> | null>(null);
  const transitionOperation = useRef<Promise<boolean> | null>(null);

  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const panelsQuery = useQuery({
    enabled: selectedPage !== null,
    queryKey: selectedPage === null
      ? [...queryKeys.panelLists(), 'disabled']
      : queryKeys.panels(selectedPage.id),
    queryFn: () => api.getPanels(selectedPage!.id, organizationId),
  });
  const panels = useMemo(
    () => sortPanels(panelsQuery.data?.panels ?? []),
    [panelsQuery.data?.panels],
  );
  const panelDirty = savedDraft !== null
    && draft !== null
    && isPanelDraftDirty(savedDraft, draft);
  const currentServerPanel = panels.find((panel) => panel.id === selectedPanelId);
  const remoteChanged = panelDirty
    && savedPanel !== null
    && panelsQuery.data !== undefined
    && (
      currentServerPanel === undefined
      || currentServerPanel.updated_at !== savedPanel.updated_at
    );
  const readOnly = selectedPage === null
    || selectedPage.status === 'confirmed'
    || selectedPage.status === 'generating'
    || generationActive;

  const applySelectedPanel = useCallback((panel: PanelRecord | null): void => {
    setSelectedPanelId(panel?.id ?? null);
    setSavedPanel(panel);
    const nextDraft = panel === null ? null : createPanelDraft(panel);
    setSavedDraft(nextDraft);
    setDraft(nextDraft);
  }, []);

  useEffect(() => {
    if (selectedPageId !== null && selectedPage === null && !panelDirty) {
      setSelectedPageId(null);
      applySelectedPanel(null);
    }
  }, [applySelectedPanel, panelDirty, selectedPage, selectedPageId]);

  useEffect(() => {
    if (selectedPage === null || panelsQuery.isLoading || panelDirty) {
      return;
    }
    const selected = panels.find((panel) => panel.id === selectedPanelId);
    if (selected === undefined) {
      if (selectedPanelId !== null) {
        applySelectedPanel(null);
      }
      return;
    }
    if (savedPanel !== selected) {
      applySelectedPanel(selected);
    }
  }, [
    applySelectedPanel,
    panelDirty,
    panels,
    panelsQuery.isLoading,
    savedPanel,
    selectedPage,
    selectedPanelId,
  ]);

  const saveCurrentPanel = useCallback((): Promise<boolean> => {
    if (saveOperation.current !== null) {
      return saveOperation.current;
    }
    if (!panelDirty) {
      return Promise.resolve(true);
    }
    if (
      selectedPage === null
      || selectedPanelId === null
      || savedPanel === null
      || savedDraft === null
      || draft === null
    ) {
      setNoticeMessage(null);
      setErrorMessage(t(language, 'panelSaveTargetMissing'));
      return Promise.resolve(false);
    }
    if (readOnly || panelsQuery.isFetching || panelsQuery.isError) {
      setNoticeMessage(null);
      setErrorMessage(t(language, 'panelSaveBlocked'));
      return Promise.resolve(false);
    }
    if (remoteChanged) {
      setNoticeMessage(null);
      setErrorMessage(t(language, 'panelRemoteChanged'));
      return Promise.resolve(false);
    }
    const update = buildPanelUpdate(
      savedDraft,
      draft,
      savedPanel.entities.map((assignment) => assignment.entity_id),
    );
    if (!update.ok) {
      setNoticeMessage(null);
      setErrorMessage(null);
      setValidationReason(update.reason);
      return Promise.resolve(false);
    }
    if (Object.keys(update.payload).length === 0) {
      setSavedDraft(draft);
      setValidationReason(null);
      return Promise.resolve(true);
    }

    setBusy(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    setValidationReason(null);
    let operation: Promise<boolean> | null = null;
    operation = (async (): Promise<boolean> => {
      try {
        const updated = await api.updatePanel(
          selectedPanelId,
          update.payload,
          organizationId,
        );
        if (updated.page_id !== selectedPage.id) {
          setErrorMessage(t(language, 'panelSaveError'));
          return false;
        }
        queryClient.setQueryData<{ panels: PanelRecord[] }>(
          queryKeys.panels(selectedPage.id),
          (current) => current === undefined
            ? current
            : { panels: sortPanels(upsertPanel(current.panels, updated)) },
        );
        applySelectedPanel(updated);
        setNoticeMessage(t(language, 'panelSaved'));
        return true;
      } catch {
        setErrorMessage(t(language, 'panelSaveError'));
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
    applySelectedPanel,
    draft,
    language,
    organizationId,
    panelDirty,
    panelsQuery.isError,
    panelsQuery.isFetching,
    queryClient,
    queryKeys,
    readOnly,
    remoteChanged,
    savedDraft,
    savedPanel,
    selectedPage,
    selectedPanelId,
  ]);

  const resolvePendingPanel = useCallback(async (): Promise<boolean> => {
    if (saveOperation.current !== null) {
      return saveOperation.current;
    }
    if (!panelDirty) {
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
      setValidationReason(null);
      return true;
    }
    return saveCurrentPanel();
  }, [language, panelDirty, resolveDirtyAction, saveCurrentPanel, savedDraft]);

  useImperativeHandle(ref, () => ({
    prepareToLeave: resolvePendingPanel,
  }), [resolvePendingPanel]);

  const transition = useCallback((changeSelection: () => void): Promise<boolean> => {
    if (transitionOperation.current !== null) {
      return transitionOperation.current;
    }
    const operation = (async (): Promise<boolean> => {
      if (!(await resolvePendingPanel())) {
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
  }, [resolvePendingPanel]);

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{t(language, 'panelEditing')}</Text>
      <Text style={styles.muted}>{t(language, 'panelEditingHelp')}</Text>
      {pageListReady ? (
        <StorySelectionSection
          emptyMessage={t(language, 'pageEmpty')}
          error={false}
          errorMessage={t(language, 'pageLoadError')}
          heading={t(language, 'pages')}
          items={pages.map((page) => ({
            id: page.id,
            label: t(language, 'pageLabel', { number: String(page.page_number) }),
          }))}
          loading={false}
          loadingMessage={t(language, 'pageLoading')}
          onRetry={() => undefined}
          onSelect={(pageId) => {
            if (pageId !== selectedPageId) {
              void transition(() => {
                setSelectedPageId(pageId);
                applySelectedPanel(null);
                setErrorMessage(null);
                setNoticeMessage(null);
                setValidationReason(null);
              });
            }
          }}
          retryLabel={t(language, 'pageListRetry')}
          selectedId={selectedPageId}
          selectSuffix={t(language, 'storySelectSuffix')}
        />
      ) : null}
      {selectedPage === null ? null : (
        <StorySelectionSection
          emptyMessage={t(language, 'panelNoPanels')}
          error={panelsQuery.isError}
          errorMessage={t(language, 'panelLoadError')}
          heading={t(language, 'panels')}
          items={panels.map((panel) => ({
            id: panel.id,
            label: t(language, 'panelLabel', { number: String(panel.order) }),
          }))}
          loading={panelsQuery.isLoading}
          loadingMessage={t(language, 'panelLoading')}
          onRetry={() => void panelsQuery.refetch()}
          onSelect={(panelId) => {
            const panel = panels.find((candidate) => candidate.id === panelId);
            if (panel !== undefined && panel.id !== selectedPanelId) {
              void transition(() => {
                applySelectedPanel(panel);
                setErrorMessage(null);
                setNoticeMessage(null);
                setValidationReason(null);
              });
            }
          }}
          retryLabel={t(language, 'panelRetry')}
          selectedId={selectedPanelId}
          selectSuffix={t(language, 'storySelectSuffix')}
        />
      )}
      {draft === null || savedPanel === null ? null : (
        <PanelEditor
          assignedEntityIds={savedPanel.entities.map((assignment) => assignment.entity_id)}
          busy={busy}
          dirty={panelDirty}
          draft={draft}
          errorMessage={errorMessage}
          language={language}
          noticeMessage={noticeMessage}
          onChange={(nextDraft) => {
            setDraft(nextDraft);
            setErrorMessage(null);
            setNoticeMessage(null);
            setValidationReason(null);
          }}
          onSave={() => void saveCurrentPanel()}
          readOnly={readOnly}
          remoteChanged={remoteChanged}
          validationReason={validationReason}
        />
      )}
    </View>
  );
});

function sortPanels(panels: readonly PanelRecord[]): PanelRecord[] {
  return [...panels].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

function upsertPanel(panels: readonly PanelRecord[], panel: PanelRecord): PanelRecord[] {
  return panels.some((candidate) => candidate.id === panel.id)
    ? panels.map((candidate) => candidate.id === panel.id ? panel : candidate)
    : [...panels, panel];
}

const styles = StyleSheet.create({
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
  section: {
    gap: spacing.md,
  },
});
