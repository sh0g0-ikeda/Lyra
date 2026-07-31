import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  EntityReferenceSection,
  type EntityReferenceApiPort,
} from '../components/EntityReferenceSection';
import { StorySelectionSection } from '../components/StorySelectionSection';
import { colors, radius, spacing } from '../constants/theme';
import {
  buildCreateEntityInput,
  buildUpdateEntityInput,
  createEntityDraft,
  emptyEntityDraft,
  isEntityDraftDirty,
  type EntityDraft,
  type EntityDraftValidationReason,
  type EntityType,
} from '../domain/entityDraft';
import type {
  CreateEntityInput,
  EntityRecord,
  ListEntitiesPageInput,
  ListWorksPageInput,
  UpdateEntityInput,
  WorkRecord,
} from '../lib/api';
import {
  showDirtyStoryPrompt,
  type DirtyStoryAction,
} from '../lib/dirtyStoryPrompt';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';
import type { EntityReferenceImagePickerPort } from '../infrastructure/entityReferenceImagePicker';
import type { EntityReferenceConfirmPromptInput } from '../lib/entityReferenceConfirmPrompt';

const ENTITY_PAGE_LIMIT = 50;

interface EntityPage {
  entities: EntityRecord[];
  next_cursor: string | null;
}

export interface CharactersScreenHandle {
  prepareToLeave(): Promise<boolean>;
}

export interface CharactersApiPort extends EntityReferenceApiPort {
  createEntity(
    workId: string,
    body: CreateEntityInput,
    organizationId?: string | null,
  ): Promise<EntityRecord>;
  getEntitiesPage(
    workId: string,
    input: ListEntitiesPageInput,
    organizationId?: string | null,
  ): Promise<EntityPage>;
  getWorksPage(
    input: ListWorksPageInput,
    organizationId?: string | null,
  ): Promise<{ works: WorkRecord[]; next_cursor: string | null }>;
  updateEntity(
    entityId: string,
    body: UpdateEntityInput,
    organizationId?: string | null,
  ): Promise<EntityRecord>;
  updateEntityGenerationContext(
    entityId: string,
    promptSupplement: string | null,
    organizationId?: string | null,
  ): Promise<EntityRecord>;
}

interface CharactersScreenProps {
  api: CharactersApiPort;
  imageApiBaseUrl: string;
  imageAuthorizationHeader: string | null;
  language: UiLanguage;
  organizationId: string | null;
  confirmReferenceCandidate?: (
    input: EntityReferenceConfirmPromptInput,
  ) => Promise<boolean>;
  referenceImagePicker?: EntityReferenceImagePickerPort;
  resolveDirtyAction?: () => Promise<DirtyStoryAction>;
  sessionKey: string;
}

export const CharactersScreen = forwardRef<
  CharactersScreenHandle,
  CharactersScreenProps
>(function CharactersScreen({
  api,
  imageApiBaseUrl,
  imageAuthorizationHeader,
  language,
  organizationId,
  confirmReferenceCandidate,
  referenceImagePicker,
  resolveDirtyAction,
  sessionKey,
}, ref): React.JSX.Element {
  const queryClient = useQueryClient();
  const queryKeys = useMemo(
    () => storyQueryKeys(sessionKey, organizationId),
    [organizationId, sessionKey],
  );
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [savedEntity, setSavedEntity] = useState<EntityRecord | null>(null);
  const [draft, setDraft] = useState<EntityDraft>(emptyEntityDraft);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [activeReferenceOperationIds, setActiveReferenceOperationIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const savedEntityRef = useRef<EntityRecord | null>(null);
  const saveOperation = useRef<Promise<boolean> | null>(null);
  const transitionOperation = useRef<Promise<boolean> | null>(null);
  const referenceOperationActive = activeReferenceOperationIds.size > 0;
  const trackReferenceOperation = useCallback((
    operationId: string,
    active: boolean,
  ): void => {
    setActiveReferenceOperationIds((current) => {
      if (active ? current.has(operationId) : !current.has(operationId)) {
        return current;
      }
      const next = new Set(current);
      if (active) {
        next.add(operationId);
      } else {
        next.delete(operationId);
      }
      return next;
    });
  }, []);

  const worksQuery = useQuery({
    queryKey: queryKeys.works(),
    queryFn: () => api.getWorksPage({ limit: 50 }, organizationId),
  });
  const entitiesQuery = useInfiniteQuery({
    enabled: selectedWorkId !== null,
    queryKey: selectedWorkId === null
      ? [...queryKeys.works(), 'character-entities-disabled']
      : queryKeys.entities(selectedWorkId),
    queryFn: ({ pageParam }) => api.getEntitiesPage(
      selectedWorkId!,
      { limit: ENTITY_PAGE_LIMIT, cursor: pageParam },
      organizationId,
    ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });

  const works = worksQuery.data?.works ?? [];
  const entities = useMemo(
    () => deduplicateEntities(
      entitiesQuery.data?.pages.flatMap((page) => page.entities) ?? [],
    ),
    [entitiesQuery.data?.pages],
  );
  const selectedEntityFromList = selectedEntityId === null
    ? null
    : entities.find((entity) => entity.id === selectedEntityId) ?? null;
  const dirty = isEntityDraftDirty(savedEntity, draft);

  const applyEntity = useCallback((entity: EntityRecord | null): void => {
    savedEntityRef.current = entity;
    setSelectedEntityId(entity?.id ?? null);
    setSavedEntity(entity);
    setDraft(entity === null ? emptyEntityDraft() : createEntityDraft(entity));
    setSaveError(null);
    setSaveNotice(null);
  }, []);

  useEffect(() => {
    if (
      savedEntity === null
      || selectedEntityFromList === null
      || dirty
      || selectedEntityFromList.updated_at === savedEntity.updated_at
    ) {
      return;
    }
    applyEntity(selectedEntityFromList);
  }, [applyEntity, dirty, savedEntity, selectedEntityFromList]);

  const updateEntityCache = useCallback(async (entity: EntityRecord): Promise<void> => {
    const workId = entity.work_id;
    const queryKey = queryKeys.entities(workId);
    await queryClient.cancelQueries({ exact: true, queryKey });
    queryClient.setQueryData<InfiniteData<EntityPage, string | null>>(
      queryKey,
      (current) => upsertEntityInPages(current, entity),
    );
    void queryClient.invalidateQueries({ exact: true, queryKey });
  }, [queryClient, queryKeys]);

  const saveCurrentDraft = useCallback((): Promise<boolean> => {
    if (saveOperation.current !== null) {
      return saveOperation.current;
    }
    if (!dirty) {
      return Promise.resolve(true);
    }
    if (selectedWorkId === null) {
      return Promise.resolve(false);
    }

    const createResult = savedEntity === null
      ? buildCreateEntityInput(draft)
      : null;
    const updateResult = savedEntity === null
      ? null
      : buildUpdateEntityInput(savedEntity, draft);
    const invalidReason = createResult !== null && !createResult.ok
      ? createResult.reason
      : updateResult !== null && !updateResult.ok
        ? updateResult.reason
        : null;
    if (invalidReason !== null && invalidReason !== 'no_changes') {
      setSaveNotice(null);
      setSaveError(entityValidationMessage(language, invalidReason));
      return Promise.resolve(false);
    }
    if (invalidReason === 'no_changes') {
      return Promise.resolve(true);
    }

    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    const operation = (async (): Promise<boolean> => {
      try {
        const saved = savedEntity === null
          ? await api.createEntity(
              selectedWorkId,
              (createResult as { ok: true; input: CreateEntityInput }).input,
              organizationId,
            )
          : await api.updateEntity(
              savedEntity.id,
              (updateResult as { ok: true; input: UpdateEntityInput }).input,
              organizationId,
            );
        if (saved.work_id !== selectedWorkId) {
          throw new Error('Entity response work does not match the selected work');
        }
        await updateEntityCache(saved).catch(() => undefined);
        savedEntityRef.current = saved;
        setSelectedEntityId(saved.id);
        setSavedEntity(saved);
        setDraft(createEntityDraft(saved));
        setSaveNotice(t(
          language,
          savedEntity === null ? 'characterCreated' : 'characterSaved',
        ));
        return true;
      } catch {
        setSaveError(t(language, 'characterSaveError'));
        return false;
      } finally {
        setSaving(false);
      }
    })();
    saveOperation.current = operation;
    void operation.finally(() => {
      if (saveOperation.current === operation) {
        saveOperation.current = null;
      }
    });
    return operation;
  }, [
    api,
    dirty,
    draft,
    language,
    organizationId,
    savedEntity,
    selectedWorkId,
    updateEntityCache,
  ]);

  const prepareEntityForGeneration = useCallback(async (
    sourcePromptSupplement?: string,
  ): Promise<EntityRecord | null> => {
    if (savedEntityRef.current === null || !(await saveCurrentDraft())) {
      return null;
    }
    const current = savedEntityRef.current;
    if (
      current === null
      || current.id !== selectedEntityId
      || current.work_id !== selectedWorkId
    ) {
      return null;
    }
    if (
      sourcePromptSupplement === undefined
      || sourcePromptSupplement === current.prompt_supplement
    ) {
      return current;
    }
    try {
      const updated = await api.updateEntityGenerationContext(
        current.id,
        sourcePromptSupplement,
        organizationId,
      );
      if (updated.id !== current.id || updated.work_id !== selectedWorkId) {
        throw new Error('Entity response does not match the generation context');
      }
      await updateEntityCache(updated).catch(() => undefined);
      savedEntityRef.current = updated;
      setSavedEntity(updated);
      setDraft(createEntityDraft(updated));
      return updated;
    } catch {
      setSaveNotice(null);
      setSaveError(t(language, 'characterSaveError'));
      return null;
    }
  }, [
    api,
    language,
    organizationId,
    saveCurrentDraft,
    selectedEntityId,
    selectedWorkId,
    updateEntityCache,
  ]);

  const resolvePendingChanges = useCallback(async (): Promise<boolean> => {
    if (referenceOperationActive) {
      return false;
    }
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
      setDraft(savedEntity === null
        ? emptyEntityDraft()
        : createEntityDraft(savedEntity));
      setSaveError(null);
      setSaveNotice(null);
      return true;
    }
    return saveCurrentDraft();
  }, [
    dirty,
    language,
    referenceOperationActive,
    resolveDirtyAction,
    saveCurrentDraft,
    savedEntity,
  ]);

  useImperativeHandle(ref, () => ({
    prepareToLeave: resolvePendingChanges,
  }), [resolvePendingChanges]);

  const transition = useCallback((changeSelection: () => void): Promise<boolean> => {
    if (referenceOperationActive) {
      return Promise.resolve(false);
    }
    if (transitionOperation.current !== null) {
      return transitionOperation.current;
    }
    const operation = (async (): Promise<boolean> => {
      setTransitioning(true);
      if (!(await resolvePendingChanges())) {
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
      setTransitioning(false);
    });
    return operation;
  }, [referenceOperationActive, resolvePendingChanges]);

  const selectWork = useCallback((workId: string): Promise<boolean> => {
    if (workId === selectedWorkId) {
      return Promise.resolve(true);
    }
    return transition(() => {
      setSelectedWorkId(workId);
      applyEntity(null);
    });
  }, [applyEntity, selectedWorkId, transition]);

  const selectEntity = useCallback((entityId: string): Promise<boolean> => {
    if (entityId === selectedEntityId) {
      return Promise.resolve(true);
    }
    const entity = entities.find((candidate) => candidate.id === entityId);
    if (entity === undefined) {
      return Promise.resolve(false);
    }
    return transition(() => applyEntity(entity));
  }, [applyEntity, entities, selectedEntityId, transition]);

  const beginNewEntity = useCallback((): Promise<boolean> => transition(
    () => applyEntity(null),
  ), [applyEntity, transition]);

  const resetDraft = useCallback((): void => {
    setDraft(savedEntity === null ? emptyEntityDraft() : createEntityDraft(savedEntity));
    setSaveError(null);
    setSaveNotice(null);
  }, [savedEntity]);

  const operationActive = saving || transitioning || referenceOperationActive;
  const initialEntitiesError = entitiesQuery.isError
    && entitiesQuery.data === undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t(language, 'characters')}</Text>
      <Text style={styles.muted}>{t(language, 'characterHelp')}</Text>
      <StorySelectionSection
        emptyMessage={t(language, 'storyNoWorks')}
        error={worksQuery.isError}
        errorMessage={t(language, 'storyWorksError')}
        heading={t(language, 'works')}
        items={works.map((work) => ({ id: work.id, label: work.title }))}
        loading={worksQuery.isLoading}
        loadingMessage={t(language, 'storyWorksLoading')}
        onRetry={() => void worksQuery.refetch()}
        onSelect={(workId) => void selectWork(workId)}
        retryLabel={t(language, 'retry')}
        selectedId={selectedWorkId}
        selectSuffix={t(language, 'storySelectSuffix')}
      />

      {selectedWorkId === null ? null : (
        <View style={styles.section}>
          <StorySelectionSection
            emptyMessage={t(language, 'characterNoEntities')}
            error={initialEntitiesError}
            errorMessage={t(language, 'characterEntitiesError')}
            heading={t(language, 'characters')}
            items={entities.map((entity) => ({ id: entity.id, label: entity.name }))}
            loading={entitiesQuery.isLoading}
            loadingMessage={t(language, 'characterEntitiesLoading')}
            onRetry={() => void entitiesQuery.refetch()}
            onSelect={(entityId) => void selectEntity(entityId)}
            retryLabel={t(language, 'retry')}
            selectedId={selectedEntityId}
            selectSuffix={t(language, 'storySelectSuffix')}
          />
          {entitiesQuery.hasNextPage ? (
            <PrimaryButton
              disabled={entitiesQuery.isFetchingNextPage}
              label={t(language, 'characterLoadMore')}
              loading={entitiesQuery.isFetchingNextPage}
              onPress={() => void entitiesQuery.fetchNextPage()}
            />
          ) : null}
          {entitiesQuery.isFetchNextPageError ? (
            <Notice message={t(language, 'characterLoadMoreError')} tone="danger" />
          ) : null}

          <View style={styles.editor}>
            <Text style={styles.subheading}>
              {savedEntity === null
                ? t(language, 'characterNew')
                : savedEntity.name}
            </Text>
            <Text style={styles.label}>{t(language, 'characterType')}</Text>
            {savedEntity === null ? (
              <View style={styles.typeRow}>
                {entityTypeOptions.map((option) => (
                  <Pressable
                    accessibilityLabel={`${t(language, option.labelKey)}${language === 'ja' ? 'を種類として選択' : ' type'}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: draft.entityType === option.value }}
                    disabled={operationActive}
                    key={option.value}
                    onPress={() => setDraft((current) => ({
                      ...current,
                      entityType: option.value,
                    }))}
                    style={({ pressed }) => [
                      styles.typeButton,
                      draft.entityType === option.value && styles.typeButtonSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.typeText}>{t(language, option.labelKey)}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <>
                <Text style={styles.readOnlyValue}>
                  {t(language, entityTypeMessageKey(savedEntity.entity_type))}
                </Text>
                <Text style={styles.muted}>{t(language, 'characterTypeLocked')}</Text>
              </>
            )}

            <Text style={styles.label}>{t(language, 'characterName')}</Text>
            <TextInput
              accessibilityLabel={t(language, 'characterName')}
              editable={!operationActive}
              maxLength={101}
              onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
              style={styles.input}
              value={draft.name}
            />
            <Text style={styles.label}>{t(language, 'characterDescription')}</Text>
            <TextInput
              accessibilityLabel={t(language, 'characterDescription')}
              editable={!operationActive}
              maxLength={2_001}
              multiline
              onChangeText={(freeDescription) => setDraft((current) => ({
                ...current,
                freeDescription,
              }))}
              style={[styles.input, styles.descriptionInput]}
              textAlignVertical="top"
              value={draft.freeDescription}
            />

            <View style={styles.actionRow}>
              <PrimaryButton
                disabled={!dirty || operationActive}
                label={t(language, 'characterDraftReset')}
                onPress={resetDraft}
              />
              <PrimaryButton
                disabled={operationActive}
                label={t(language, 'characterNew')}
                onPress={() => void beginNewEntity()}
              />
            </View>
            {saveError === null ? null : <Notice message={saveError} tone="danger" />}
            {saveNotice === null ? null : <Notice message={saveNotice} />}
            <PrimaryButton
              disabled={!dirty || operationActive}
              label={t(
                language,
                savedEntity === null ? 'characterCreate' : 'save',
              )}
              loading={saving}
              onPress={() => void saveCurrentDraft()}
            />
            {savedEntity === null ? null : (
              <EntityReferenceSection
                api={api}
                apiBaseUrl={imageApiBaseUrl}
                authorizationHeader={imageAuthorizationHeader}
                confirmReferenceCandidate={confirmReferenceCandidate}
                entity={savedEntity}
                imagePicker={referenceImagePicker}
                key={`${sessionKey}:${organizationId ?? 'personal'}:${savedEntity.id}`}
                language={language}
                onOperationActiveChange={trackReferenceOperation}
                organizationId={organizationId}
                prepareEntityForGeneration={prepareEntityForGeneration}
                queryKeys={queryKeys}
                sessionKey={sessionKey}
              />
            )}
          </View>
        </View>
      )}
    </View>
  );
});

const entityTypeOptions: readonly {
  value: EntityType;
  labelKey: MessageKey;
}[] = [
  { value: 'character', labelKey: 'characterTypeCharacter' },
  { value: 'nonhuman', labelKey: 'characterTypeNonhuman' },
  { value: 'object', labelKey: 'characterTypeObject' },
];

function entityTypeMessageKey(entityType: EntityType): MessageKey {
  if (entityType === 'nonhuman') {
    return 'characterTypeNonhuman';
  }
  if (entityType === 'object') {
    return 'characterTypeObject';
  }
  return 'characterTypeCharacter';
}

function entityValidationMessage(
  language: UiLanguage,
  reason: EntityDraftValidationReason,
): string {
  if (reason === 'name_required') {
    return t(language, 'characterNameRequired');
  }
  if (reason === 'name_too_long') {
    return t(language, 'characterNameTooLong');
  }
  return t(language, 'characterDescriptionTooLong');
}

function deduplicateEntities(entities: readonly EntityRecord[]): EntityRecord[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) {
      return false;
    }
    seen.add(entity.id);
    return true;
  });
}

function upsertEntityInPages(
  current: InfiniteData<EntityPage, string | null> | undefined,
  entity: EntityRecord,
): InfiniteData<EntityPage, string | null> | undefined {
  if (current === undefined || current.pages.length === 0) {
    return {
      pages: [{ entities: [entity], next_cursor: null }],
      pageParams: [null],
    };
  }
  let found = false;
  const pages = current.pages.map((page) => ({
    ...page,
    entities: page.entities.map((candidate) => {
      if (candidate.id !== entity.id) {
        return candidate;
      }
      found = true;
      return entity;
    }),
  }));
  if (!found) {
    const firstPage = pages[0];
    if (firstPage !== undefined) {
      pages[0] = {
        ...firstPage,
        entities: [entity, ...firstPage.entities],
      };
    }
  }
  return { ...current, pages };
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  container: {
    gap: spacing.lg,
  },
  descriptionInput: {
    minHeight: 140,
  },
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
    fontSize: 24,
    fontWeight: '800',
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 48,
    padding: spacing.sm,
  },
  label: {
    color: colors.ink,
    fontSize: 14,
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
  readOnlyValue: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  section: {
    gap: spacing.md,
  },
  subheading: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  typeButton: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  typeButtonSelected: {
    borderColor: colors.accent,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  typeText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
});
