import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import {
  buildEntityStateCreate,
  buildEntityStateUpdate,
  createEntityStateDraft,
  emptyEntityStateDraft,
  hasRemoteEntityStateChanged,
  isEntityStateDraftDirty,
  type EntityStateDraft,
  type EntityStateDraftValidationReason,
} from '../domain/entityStateDraft';
import type {
  ChapterRecord,
  CreateEntityStateInput,
  EntityRecord,
  EntityStateRecord,
  EpisodeRecord,
  SceneRecord,
  UpdateEntityStateInput,
} from '../lib/api';
import { showDirtyStoryPrompt, type DirtyStoryAction } from '../lib/dirtyStoryPrompt';
import { t, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';
import { StorySelectionSection } from './StorySelectionSection';

const NO_SCENE_ID = '__entity-state-no-scene__';

export interface EntityStateSectionHandle {
  prepareToLeave(): Promise<boolean>;
}

export interface EntityStateApiPort {
  createEntityState(
    entityId: string,
    body: CreateEntityStateInput,
    organizationId?: string | null,
  ): Promise<EntityStateRecord>;
  getChapters(
    workId: string,
    organizationId?: string | null,
  ): Promise<{ chapters: ChapterRecord[] }>;
  getEntityStates(
    entityId: string,
    organizationId?: string | null,
  ): Promise<{ entity_states: EntityStateRecord[] }>;
  getEpisodes(
    chapterId: string,
    organizationId?: string | null,
  ): Promise<{ episodes: EpisodeRecord[] }>;
  getScenes(
    episodeId: string,
    organizationId?: string | null,
  ): Promise<{ scenes: SceneRecord[] }>;
  updateEntityState(
    entityId: string,
    stateId: string,
    body: UpdateEntityStateInput,
    organizationId?: string | null,
  ): Promise<EntityStateRecord>;
}

interface EntityStateSectionProps {
  api: EntityStateApiPort;
  editingBlocked: boolean;
  entity: EntityRecord;
  language: UiLanguage;
  onOperationActiveChange?(operationId: string, active: boolean): void;
  organizationId: string | null;
  resolveDirtyAction?: () => Promise<DirtyStoryAction>;
  sessionKey: string;
}

interface EntityStateSceneOption {
  episodeId: string;
  id: string;
  label: string;
  sceneId: string;
}

interface PendingCreateAttempt {
  beforeIds: ReadonlySet<string>;
  payload: CreateEntityStateInput;
}

const EntityStateSectionInner = forwardRef<
  EntityStateSectionHandle,
  EntityStateSectionProps
>(function EntityStateSection({
  api,
  editingBlocked,
  entity,
  language,
  onOperationActiveChange,
  organizationId,
  resolveDirtyAction,
  sessionKey,
}, ref): React.JSX.Element {
  const queryClient = useQueryClient();
  const queryKeys = useMemo(
    () => storyQueryKeys(sessionKey, organizationId),
    [organizationId, sessionKey],
  );
  const scopeKey = `${sessionKey}:${organizationId ?? 'personal'}:${entity.work_id}:${entity.id}`;
  const currentScope = useRef(scopeKey);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [savedState, setSavedState] = useState<EntityStateRecord | null>(null);
  const [savedDraft, setSavedDraft] = useState<EntityStateDraft | null>(null);
  const [draft, setDraft] = useState<EntityStateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [createAmbiguous, setCreateAmbiguous] = useState(false);
  const saveOperation = useRef<Promise<boolean> | null>(null);
  const transitionOperation = useRef<Promise<boolean> | null>(null);
  const pendingCreate = useRef<PendingCreateAttempt | null>(null);
  const stateQueryKey = queryKeys.entityStates(entity.id);

  const statesQuery = useQuery({
    queryKey: stateQueryKey,
    queryFn: () => api.getEntityStates(entity.id, organizationId),
  });
  const sceneCatalogQuery = useQuery({
    enabled: false,
    queryKey: queryKeys.entityStateSceneCatalog(entity.work_id),
    queryFn: () => loadEntityStateSceneOptions(
      api,
      entity.work_id,
      language,
      organizationId,
    ),
  });
  const states = useMemo(
    () => sortEntityStates(statesQuery.data?.entity_states ?? []),
    [statesQuery.data?.entity_states],
  );
  const dirty = draft !== null
    && isEntityStateDraftDirty(savedDraft ?? emptyEntityStateDraft(), draft);
  const selectedStateMissing = selectedStateId !== null
    && statesQuery.data !== undefined
    && !states.some((state) => state.id === selectedStateId);

  const applyState = useCallback((state: EntityStateRecord | null): void => {
    setSelectedStateId(state?.id ?? null);
    setSavedState(state);
    const nextDraft = state === null ? null : createEntityStateDraft(state);
    setSavedDraft(nextDraft);
    setDraft(nextDraft);
    setCreateAmbiguous(false);
    pendingCreate.current = null;
  }, []);

  const beginNew = useCallback((): void => {
    setSelectedStateId(null);
    setSavedState(null);
    setSavedDraft(emptyEntityStateDraft());
    setDraft(emptyEntityStateDraft());
    setCreateAmbiguous(false);
    pendingCreate.current = null;
    setErrorMessage(null);
    setNoticeMessage(null);
  }, []);

  const setOperationActive = useCallback((active: boolean): void => {
    onOperationActiveChange?.(`entity-state:${scopeKey}`, active);
  }, [onOperationActiveChange, scopeKey]);

  const acceptSavedState = useCallback((state: EntityStateRecord): void => {
    queryClient.setQueryData<{ entity_states: EntityStateRecord[] }>(
      stateQueryKey,
      (current) => ({
        entity_states: upsertEntityState(current?.entity_states ?? [], state),
      }),
    );
    applyState(state);
  }, [applyState, queryClient, stateQueryKey]);

  const invalidateSceneReferences = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sceneLists() })
      .catch(() => undefined);
  }, [queryClient, queryKeys]);

  const ensureSelectedSceneStillExists = useCallback(async (
    sceneId: string,
  ): Promise<boolean> => {
    const result = await sceneCatalogQuery.refetch();
    if (result.isError || result.data === undefined) {
      setErrorMessage(t(language, 'characterStateSceneCatalogError'));
      return false;
    }
    if (!result.data.some((option) => option.sceneId === sceneId)) {
      setErrorMessage(t(language, 'characterStateRemoteChanged'));
      return false;
    }
    return true;
  }, [language, sceneCatalogQuery]);

  const saveCurrentState = useCallback((): Promise<boolean> => {
    if (saveOperation.current !== null) return saveOperation.current;
    if (draft === null) return Promise.resolve(false);
    if (savedState !== null && !dirty) return Promise.resolve(true);
    if (createAmbiguous) return Promise.resolve(false);

    const createResult = savedState === null ? buildEntityStateCreate(draft) : null;
    const updateResult = savedState === null || savedDraft === null
      ? null
      : buildEntityStateUpdate(savedDraft, draft);
    const invalidReason = createResult !== null && !createResult.ok
      ? createResult.reason
      : updateResult !== null && !updateResult.ok
        ? updateResult.reason
        : null;
    if (invalidReason !== null) {
      setNoticeMessage(null);
      setErrorMessage(entityStateValidationMessage(language, invalidReason));
      return Promise.resolve(false);
    }
    const payload = savedState === null
      ? (createResult as { ok: true; payload: CreateEntityStateInput }).payload
      : (updateResult as { ok: true; payload: UpdateEntityStateInput }).payload;
    if (savedState !== null && Object.keys(payload).length === 0) return Promise.resolve(true);

    const operationScope = scopeKey;
    const operationEntityId = entity.id;
    const operationSavedState = savedState;
    setBusy(true);
    setOperationActive(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    let operation: Promise<boolean> | null = null;
    operation = (async (): Promise<boolean> => {
      try {
        const fresh = await statesQuery.refetch();
        if (currentScope.current !== operationScope) return false;
        if (fresh.isError || fresh.data === undefined) {
          setErrorMessage(t(language, 'characterStateLoadError'));
          return false;
        }
        const beforeStates = fresh.data.entity_states;
        if (operationSavedState !== null) {
          const remote = beforeStates.find((state) => state.id === operationSavedState.id);
          if (
            remote === undefined
            || remote.entity_id !== operationEntityId
            || hasRemoteEntityStateChanged(operationSavedState, remote)
          ) {
            setErrorMessage(t(language, 'characterStateRemoteChanged'));
            return false;
          }
        }
        const requestedSceneId = payload.scene_id;
        if (
          requestedSceneId !== undefined
          && requestedSceneId !== null
          && !(await ensureSelectedSceneStillExists(requestedSceneId))
        ) return false;

        if (operationSavedState === null) {
          pendingCreate.current = {
            beforeIds: new Set(beforeStates.map((state) => state.id)),
            payload: payload as CreateEntityStateInput,
          };
          const created = await api.createEntityState(
            operationEntityId,
            payload as CreateEntityStateInput,
            organizationId,
          );
          if (currentScope.current !== operationScope) return false;
          if (!entityStateMatchesCreateResponse(
            created,
            operationEntityId,
            payload as CreateEntityStateInput,
            pendingCreate.current.beforeIds,
          )) {
            throw new Error('Entity state create response does not match request');
          }
          acceptSavedState(created);
          setNoticeMessage(t(language, 'characterStateCreated'));
          if (created.scene_id !== null) invalidateSceneReferences();
          return true;
        }

        const updated = await api.updateEntityState(
          operationEntityId,
          operationSavedState.id,
          payload as UpdateEntityStateInput,
          organizationId,
        );
        if (currentScope.current !== operationScope) return false;
        if (!entityStateMatchesUpdateResponse(
          updated,
          operationSavedState,
          payload as UpdateEntityStateInput,
        )) {
          throw new Error('Entity state update response does not match request');
        }
        acceptSavedState(updated);
        setNoticeMessage(t(language, 'characterStateSaved'));
        if (payload.scene_id !== undefined) invalidateSceneReferences();
        return true;
      } catch {
        if (currentScope.current !== operationScope) return false;
        if (operationSavedState === null) {
          setCreateAmbiguous(true);
          setErrorMessage(t(language, 'characterStateAmbiguous'));
        } else {
          setErrorMessage(t(language, 'characterStateSaveError'));
        }
        return false;
      } finally {
        setBusy(false);
        setOperationActive(false);
        if (saveOperation.current === operation) saveOperation.current = null;
      }
    })();
    saveOperation.current = operation;
    return operation;
  }, [
    acceptSavedState,
    api,
    createAmbiguous,
    dirty,
    draft,
    ensureSelectedSceneStillExists,
    entity.id,
    invalidateSceneReferences,
    language,
    organizationId,
    savedDraft,
    savedState,
    scopeKey,
    setOperationActive,
    statesQuery,
  ]);

  const resolvePendingState = useCallback(async (): Promise<boolean> => {
    if (saveOperation.current !== null) return saveOperation.current;
    if (editingBlocked) return false;
    if (!dirty) return true;
    const action = resolveDirtyAction === undefined
      ? await showDirtyStoryPrompt(language)
      : await resolveDirtyAction();
    if (action === 'cancel') return false;
    if (action === 'discard') {
      setDraft(savedDraft);
      setCreateAmbiguous(false);
      pendingCreate.current = null;
      setErrorMessage(null);
      setNoticeMessage(null);
      return true;
    }
    return saveCurrentState();
  }, [
    dirty,
    editingBlocked,
    language,
    resolveDirtyAction,
    saveCurrentState,
    savedDraft,
  ]);

  useImperativeHandle(ref, () => ({
    prepareToLeave: resolvePendingState,
  }), [resolvePendingState]);

  const transition = useCallback((changeSelection: () => void): Promise<boolean> => {
    if (editingBlocked || busy) return Promise.resolve(false);
    if (transitionOperation.current !== null) return transitionOperation.current;
    const operation = (async (): Promise<boolean> => {
      if (!(await resolvePendingState())) return false;
      changeSelection();
      return true;
    })();
    transitionOperation.current = operation;
    void operation.finally(() => {
      if (transitionOperation.current === operation) transitionOperation.current = null;
    });
    return operation;
  }, [busy, editingBlocked, resolvePendingState]);

  const reconcileAmbiguousCreate = useCallback(async (): Promise<void> => {
    const attempt = pendingCreate.current;
    if (attempt === null || busy) return;
    const operationScope = scopeKey;
    setBusy(true);
    setOperationActive(true);
    try {
      const result = await statesQuery.refetch();
      if (currentScope.current !== operationScope) return;
      if (result.isError || result.data === undefined) {
        setErrorMessage(t(language, 'characterStateLoadError'));
        return;
      }
      const matches = result.data.entity_states.filter(
        (state) => !attempt.beforeIds.has(state.id)
          && entityStateMatchesCreateResponse(
            state,
            entity.id,
            attempt.payload,
            attempt.beforeIds,
          ),
      );
      if (matches.length === 1) {
        acceptSavedState(matches[0]!);
        setNoticeMessage(t(language, 'characterStateCreated'));
        setErrorMessage(null);
        return;
      }
      setCreateAmbiguous(false);
      pendingCreate.current = null;
      setErrorMessage(null);
      setNoticeMessage(t(language, 'characterStateRefreshed'));
    } finally {
      setBusy(false);
      setOperationActive(false);
    }
  }, [
    acceptSavedState,
    busy,
    entity.id,
    language,
    scopeKey,
    setOperationActive,
    statesQuery,
  ]);

  const sceneItems = sceneCatalogQuery.data === undefined
    ? []
    : [
        { id: NO_SCENE_ID, label: t(language, 'characterStateCommonScene') },
        ...sceneCatalogQuery.data,
      ];

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{t(language, 'characterStateHeading')}</Text>
      <Text style={styles.muted}>{t(language, 'characterStateHelp')}</Text>
      <StorySelectionSection
        emptyMessage={t(language, 'characterStateEmpty')}
        error={statesQuery.isError && statesQuery.data === undefined}
        errorMessage={t(language, 'characterStateLoadError')}
        heading={t(language, 'characterStateTarget')}
        items={states.map((state, index) => ({
          id: state.id,
          label: stateLabel(state, index, language),
        }))}
        loading={statesQuery.isLoading}
        loadingMessage={t(language, 'characterStateLoading')}
        onRetry={() => void statesQuery.refetch()}
        onSelect={(stateId) => {
          const state = states.find((candidate) => candidate.id === stateId);
          if (
            state !== undefined
            && (
              state.id !== selectedStateId
              || savedState === null
              || hasRemoteEntityStateChanged(savedState, state)
            )
          ) {
            void transition(() => {
              applyState(state);
              setErrorMessage(null);
              setNoticeMessage(null);
            });
          }
        }}
        retryLabel={t(language, 'characterStateRetry')}
        selectedId={selectedStateId}
        selectSuffix={t(language, 'storySelectSuffix')}
      />
      <PrimaryButton
        disabled={editingBlocked || busy || createAmbiguous}
        label={t(language, 'characterStateNew')}
        onPress={() => void transition(beginNew)}
      />
      {draft === null ? null : (
        <View style={styles.editor}>
          {sceneCatalogQuery.data === undefined ? (
            <>
              {savedState?.scene_id === null || savedState === null ? null : (
                <Notice message={t(language, 'characterStateSceneCurrentPreserved')} />
              )}
              {sceneCatalogQuery.isError ? (
                <Notice message={t(language, 'characterStateSceneCatalogError')} tone="danger" />
              ) : null}
              <PrimaryButton
                disabled={editingBlocked || busy}
                label={t(language, 'characterStateSceneCatalogLoad')}
                loading={sceneCatalogQuery.isFetching}
                onPress={() => void sceneCatalogQuery.refetch()}
              />
              {sceneCatalogQuery.isFetching ? (
                <Text style={styles.muted}>
                  {t(language, 'characterStateSceneCatalogLoading')}
                </Text>
              ) : null}
            </>
          ) : (
            <StorySelectionSection
              emptyMessage={t(language, 'characterStateCommonScene')}
              error={false}
              errorMessage={t(language, 'characterStateSceneCatalogError')}
              heading={t(language, 'characterStateSceneTarget')}
              items={sceneItems}
              loading={false}
              loadingMessage={t(language, 'characterStateSceneCatalogLoading')}
              onRetry={() => void sceneCatalogQuery.refetch()}
              onSelect={(optionId) => {
                const sceneId = optionId === NO_SCENE_ID ? null : optionId;
                setDraft((current) => current === null ? current : {
                  ...current,
                  scene_id: sceneId,
                });
              }}
              retryLabel={t(language, 'characterStateSceneCatalogLoad')}
              selectedId={draft.scene_id ?? NO_SCENE_ID}
              selectSuffix={t(language, 'storySelectSuffix')}
            />
          )}
          <StateTextInput
            editable={!editingBlocked && !busy && !createAmbiguous}
            label={t(language, 'characterStateCostume')}
            onChangeText={(value) => setDraft((current) => current === null ? current : {
              ...current,
              costume_note: value,
            })}
            value={draft.costume_note}
          />
          <StateTextInput
            editable={!editingBlocked && !busy && !createAmbiguous}
            label={t(language, 'characterStateCondition')}
            onChangeText={(value) => setDraft((current) => current === null ? current : {
              ...current,
              condition_note: value,
            })}
            value={draft.condition_note}
          />
          <StateTextInput
            editable={!editingBlocked && !busy && !createAmbiguous}
            label={t(language, 'characterStateHair')}
            onChangeText={(value) => setDraft((current) => current === null ? current : {
              ...current,
              hair_note: value,
            })}
            value={draft.hair_note}
          />
          <Text style={styles.label}>{t(language, 'characterStateExpression')}</Text>
          <TextInput
            accessibilityLabel={t(language, 'characterStateExpression')}
            editable={!editingBlocked && !busy && !createAmbiguous}
            maxLength={101}
            onChangeText={(value) => setDraft((current) => current === null ? current : {
              ...current,
              expression_default: value,
            })}
            style={styles.input}
            value={draft.expression_default}
          />
          <StateTextInput
            editable={!editingBlocked && !busy && !createAmbiguous}
            label={t(language, 'characterStateExtra')}
            onChangeText={(value) => setDraft((current) => current === null ? current : {
              ...current,
              extra_note: value,
            })}
            value={draft.extra_note}
          />
          {savedState?.costume_ref_id === null || savedState === null ? null : (
            <Notice message={t(language, 'characterStateCostumeReferencePreserved')} />
          )}
          {selectedStateMissing && errorMessage === null ? (
            <Notice message={t(language, 'characterStateRemoteChanged')} tone="danger" />
          ) : null}
          {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
          {noticeMessage === null ? null : <Notice message={noticeMessage} />}
          {createAmbiguous ? (
            <PrimaryButton
              disabled={busy}
              label={t(language, 'characterStateRefresh')}
              loading={busy}
              onPress={() => void reconcileAmbiguousCreate()}
            />
          ) : (
            <PrimaryButton
              disabled={editingBlocked || busy || (savedState !== null && !dirty)}
              label={t(
                language,
                savedState === null ? 'characterStateCreate' : 'characterStateSave',
              )}
              loading={busy}
              onPress={() => void saveCurrentState()}
            />
          )}
        </View>
      )}
    </View>
  );
});

export const EntityStateSection = forwardRef<
  EntityStateSectionHandle,
  EntityStateSectionProps
>(function EntityStateSection(props, ref): React.JSX.Element {
  const scopeKey = `${props.sessionKey}:${props.organizationId ?? 'personal'}:${props.entity.work_id}:${props.entity.id}`;
  return <EntityStateSectionInner key={scopeKey} {...props} ref={ref} />;
});

function StateTextInput({
  editable,
  label,
  onChangeText,
  value,
}: {
  editable: boolean;
  label: string;
  onChangeText(value: string): void;
  value: string;
}): React.JSX.Element {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
        maxLength={2_001}
        multiline
        onChangeText={onChangeText}
        style={[styles.input, styles.multiline]}
        textAlignVertical="top"
        value={value}
      />
    </>
  );
}

async function loadEntityStateSceneOptions(
  api: EntityStateApiPort,
  workId: string,
  language: UiLanguage,
  organizationId: string | null,
): Promise<EntityStateSceneOption[]> {
  const chapterResponse = await api.getChapters(workId, organizationId);
  const chapters = [...chapterResponse.chapters].sort(byOrderThenId);
  if (chapters.some((chapter) => chapter.work_id !== workId)) {
    throw new Error('Chapter response does not match work');
  }
  const options: EntityStateSceneOption[] = [];
  const seenSceneIds = new Set<string>();
  for (const chapter of chapters) {
    const episodeResponse = await api.getEpisodes(chapter.id, organizationId);
    const episodes = [...episodeResponse.episodes].sort(byOrderThenId);
    if (episodes.some((episode) => episode.chapter_id !== chapter.id)) {
      throw new Error('Episode response does not match chapter');
    }
    for (const episode of episodes) {
      const sceneResponse = await api.getScenes(episode.id, organizationId);
      const scenes = [...sceneResponse.scenes].sort(byOrderThenId);
      if (scenes.some((scene) => scene.episode_id !== episode.id)) {
        throw new Error('Scene response does not match episode');
      }
      for (const scene of scenes) {
        if (seenSceneIds.has(scene.id)) throw new Error('Duplicate scene response');
        seenSceneIds.add(scene.id);
        options.push({
          episodeId: episode.id,
          id: scene.id,
          label: t(language, 'characterStateSceneLabel', {
            chapter: String(chapter.order),
            episode: String(episode.order),
            location: scene.location ?? t(language, 'characterStateSceneNoLocation'),
            scene: String(scene.order),
          }),
          sceneId: scene.id,
        });
      }
    }
  }
  return options;
}

function stateLabel(
  state: EntityStateRecord,
  index: number,
  language: UiLanguage,
): string {
  const summary = [
    state.costume_note,
    state.condition_note,
    state.hair_note,
    state.expression_default,
    state.extra_note,
  ].find((value) => value !== null && value.trim().length > 0)
    ?? t(language, 'characterStateNoDetails');
  return t(language, 'characterStateLabel', {
    number: String(index + 1),
    summary,
  });
}

function entityStateValidationMessage(
  language: UiLanguage,
  reason: EntityStateDraftValidationReason,
): string {
  if (reason === 'expression_required') {
    return t(language, 'characterStateExpressionRequired');
  }
  if (reason === 'expression_too_long') {
    return t(language, 'characterStateExpressionTooLong');
  }
  return t(language, 'characterStateNoteTooLong');
}

function entityStateMatchesCreateResponse(
  state: EntityStateRecord,
  entityId: string,
  payload: CreateEntityStateInput,
  beforeIds: ReadonlySet<string>,
): boolean {
  return state.entity_id === entityId
    && !beforeIds.has(state.id)
    && state.costume_ref_id === null
    && entityStateMatchesRequestedFields(state, payload);
}

function entityStateMatchesUpdateResponse(
  state: EntityStateRecord,
  saved: EntityStateRecord,
  payload: UpdateEntityStateInput,
): boolean {
  return state.id === saved.id
    && state.entity_id === saved.entity_id
    && state.scene_id === (payload.scene_id === undefined ? saved.scene_id : payload.scene_id)
    && state.costume_note === (
      payload.costume_note === undefined ? saved.costume_note : payload.costume_note
    )
    && state.costume_ref_id === saved.costume_ref_id
    && state.condition_note === (
      payload.condition_note === undefined ? saved.condition_note : payload.condition_note
    )
    && state.hair_note === (
      payload.hair_note === undefined ? saved.hair_note : payload.hair_note
    )
    && state.expression_default === (
      payload.expression_default === undefined
        ? saved.expression_default
        : payload.expression_default
    )
    && state.extra_note === (
      payload.extra_note === undefined ? saved.extra_note : payload.extra_note
    )
    && state.created_at === saved.created_at;
}

function entityStateMatchesRequestedFields(
  state: EntityStateRecord,
  payload: CreateEntityStateInput | UpdateEntityStateInput,
): boolean {
  if (payload.scene_id !== undefined && state.scene_id !== payload.scene_id) return false;
  if (
    payload.costume_note !== undefined
    && state.costume_note !== payload.costume_note
  ) return false;
  if (
    payload.condition_note !== undefined
    && state.condition_note !== payload.condition_note
  ) return false;
  if (payload.hair_note !== undefined && state.hair_note !== payload.hair_note) return false;
  if (
    payload.expression_default !== undefined
    && state.expression_default !== payload.expression_default
  ) return false;
  if (payload.extra_note !== undefined && state.extra_note !== payload.extra_note) return false;
  return true;
}

function sortEntityStates(states: readonly EntityStateRecord[]): EntityStateRecord[] {
  return [...states].sort((left, right) => left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id));
}

function upsertEntityState(
  states: readonly EntityStateRecord[],
  state: EntityStateRecord,
): EntityStateRecord[] {
  const existing = states.findIndex((candidate) => candidate.id === state.id);
  if (existing === -1) return sortEntityStates([...states, state]);
  const next = [...states];
  next[existing] = state;
  return sortEntityStates(next);
}

function byOrderThenId<T extends { id: string; order: number }>(left: T, right: T): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

const styles = StyleSheet.create({
  editor: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  heading: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    padding: spacing.sm,
  },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  multiline: {
    minHeight: 88,
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  section: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
});
