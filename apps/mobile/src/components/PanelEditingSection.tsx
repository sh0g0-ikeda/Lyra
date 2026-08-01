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
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import {
  buildPanelEntityAssignmentReplacement,
  createPanelEntityAssignmentDraft,
  isPanelEntityAssignmentDraftDirty,
  samePanelEntityAssignments,
  type PanelEntityAssignmentDraft,
  type PanelEntityAssignmentValidationReason,
} from '../domain/panelEntityAssignmentDraft';
import {
  buildPanelUpdate,
  createPanelDraft,
  isPanelDraftDirty,
  type PanelDraft,
  type PanelDraftValidationReason,
} from '../domain/panelDraft';
import {
  ApiError,
  type ApplyPagePanelStructureInput,
  type EntityRecord,
  type EntityStateRecord,
  type ListEntitiesPageInput,
  type PageRecord,
  type PagePanelStructureResponse,
  type PanelEntityAssignmentRecord,
  type PanelRecord,
  type ReplacePanelEntityAssignmentsInput,
  type UpdatePanelInput,
} from '../lib/api';
import { showDirtyStoryPrompt, type DirtyStoryAction } from '../lib/dirtyStoryPrompt';
import { t, type UiLanguage } from '../lib/i18n';
import { showPanelDeletionPrompt } from '../lib/panelStructurePrompt';
import { storyQueryKeys } from '../lib/storyQueryKeys';
import { colors, spacing } from '../constants/theme';
import { PanelEditor } from './PanelEditor';
import { Notice } from './Notice';
import {
  PanelEntityAssignmentEditor,
  type PanelAssignmentStateCatalog,
} from './PanelEntityAssignmentEditor';
import { StorySelectionSection } from './StorySelectionSection';
import { PrimaryButton } from './PrimaryButton';

const ENTITY_PAGE_LIMIT = 50;

type PanelStructureOperation = ApplyPagePanelStructureInput['operation'];

interface PendingPanelStructureReconciliation {
  acceptedCreatedPanelId: string | null;
  acceptedFrameCount: number | null;
  acceptedPanelIds: string[] | null;
  expectedPanelIds: string[];
  operationScope: string;
  operation: PanelStructureOperation;
  organizationId: string | null;
  pageId: string;
  episodeId: string;
  previousSelectedPanelId: string | null;
  requestFailure: 'ambiguous' | 'conflict' | 'definitive' | null;
}

export interface PanelEditingSectionHandle {
  prepareToLeave(): Promise<boolean>;
}

export interface PanelEditingApiPort {
  applyPagePanelStructure(
    pageId: string,
    body: ApplyPagePanelStructureInput,
    organizationId?: string | null,
  ): Promise<PagePanelStructureResponse>;
  getEntitiesPage(
    workId: string,
    input: ListEntitiesPageInput,
    organizationId?: string | null,
  ): Promise<{ entities: EntityRecord[]; next_cursor: string | null }>;
  getEntityStates(
    entityId: string,
    organizationId?: string | null,
  ): Promise<{ entity_states: EntityStateRecord[] }>;
  getPanels(
    pageId: string,
    organizationId?: string | null,
  ): Promise<{ panels: PanelRecord[] }>;
  replacePanelEntityAssignments(
    panelId: string,
    body: ReplacePanelEntityAssignmentsInput,
    organizationId?: string | null,
  ): Promise<{ entities: PanelEntityAssignmentRecord[] }>;
  updatePanel(
    panelId: string,
    body: UpdatePanelInput,
    organizationId?: string | null,
  ): Promise<PanelRecord>;
}

interface PanelEditingSectionProps {
  api: PanelEditingApiPort;
  generationActive: boolean;
  generationPreparationActive?: boolean;
  language: UiLanguage;
  organizationId: string | null;
  onStructureActiveChange(active: boolean): void;
  pageListReady: boolean;
  pages: readonly PageRecord[];
  preparePageSettings: () => Promise<boolean>;
  refreshPages: () => Promise<readonly PageRecord[]>;
  resolvePanelDeleteConfirmation?: (panelOrder: number) => Promise<boolean>;
  resolveDirtyAction?: () => Promise<DirtyStoryAction>;
  sessionKey: string;
  workId: string;
}

export const PanelEditingSection = forwardRef<
  PanelEditingSectionHandle,
  PanelEditingSectionProps
>(function PanelEditingSection({
  api,
  generationActive,
  generationPreparationActive = false,
  language,
  organizationId,
  onStructureActiveChange,
  pageListReady,
  pages,
  preparePageSettings,
  refreshPages,
  resolvePanelDeleteConfirmation = (panelOrder) => showPanelDeletionPrompt(language, panelOrder),
  resolveDirtyAction,
  sessionKey,
  workId,
}, ref): React.JSX.Element {
  const queryClient = useQueryClient();
  const queryKeys = useMemo(
    () => storyQueryKeys(sessionKey, organizationId),
    [organizationId, sessionKey],
  );
  const resourceScope = [
    sessionKey,
    organizationId ?? 'personal',
    workId,
  ].join(':');
  const resourceScopeRef = useRef(resourceScope);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [savedPanel, setSavedPanel] = useState<PanelRecord | null>(null);
  const [savedDraft, setSavedDraft] = useState<PanelDraft | null>(null);
  const [draft, setDraft] = useState<PanelDraft | null>(null);
  const [savedAssignments, setSavedAssignments] = useState<PanelEntityAssignmentDraft[] | null>(null);
  const [assignmentDraft, setAssignmentDraft] = useState<PanelEntityAssignmentDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [validationReason, setValidationReason] = useState<PanelDraftValidationReason | null>(null);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentErrorMessage, setAssignmentErrorMessage] = useState<string | null>(null);
  const [assignmentNoticeMessage, setAssignmentNoticeMessage] = useState<string | null>(null);
  const [assignmentValidationReason, setAssignmentValidationReason] =
    useState<PanelEntityAssignmentValidationReason | null>(null);
  const [assignmentReconcileRequired, setAssignmentReconcileRequired] = useState(false);
  const [assignmentConflict, setAssignmentConflict] = useState(false);
  const [structureBusy, setStructureBusy] = useState(false);
  const [structureErrorMessage, setStructureErrorMessage] = useState<string | null>(null);
  const [structureNoticeMessage, setStructureNoticeMessage] = useState<string | null>(null);
  const [structureReconcileRequired, setStructureReconcileRequired] = useState(false);
  const saveOperation = useRef<Promise<boolean> | null>(null);
  const assignmentSaveOperation = useRef<Promise<boolean> | null>(null);
  const structureOperation = useRef<Promise<boolean> | null>(null);
  const pendingStructureReconciliation = useRef<PendingPanelStructureReconciliation | null>(null);
  const transitionOperation = useRef<Promise<boolean> | null>(null);
  const currentScopeRef = useRef('');

  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const entitiesQuery = useInfiniteQuery({
    enabled: workId.length > 0,
    queryKey: queryKeys.entities(workId),
    queryFn: ({ pageParam }) => api.getEntitiesPage(
      workId,
      { limit: ENTITY_PAGE_LIMIT, cursor: pageParam },
      organizationId,
    ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });
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
  const assignmentDirty = savedAssignments !== null
    && assignmentDraft !== null
    && isPanelEntityAssignmentDraftDirty(savedAssignments, assignmentDraft);
  const anyDirty = panelDirty || assignmentDirty;
  const entities = useMemo(
    () => deduplicateEntities(
      entitiesQuery.data?.pages.flatMap((page) => page.entities) ?? [],
    ),
    [entitiesQuery.data?.pages],
  );
  const stateQueries = useQueries({
    queries: (assignmentDraft ?? []).map((assignment) => ({
      enabled: selectedPanelId !== null,
      queryKey: queryKeys.entityStates(assignment.entity_id),
      queryFn: () => api.getEntityStates(assignment.entity_id, organizationId),
    })),
  });
  const stateCatalogs: Record<string, PanelAssignmentStateCatalog> = {};
  (assignmentDraft ?? []).forEach((assignment, index) => {
    const stateQuery = stateQueries[index];
    if (stateQuery !== undefined) {
      stateCatalogs[assignment.entity_id] = {
        error: stateQuery.isError,
        loading: stateQuery.isLoading,
        retry: () => {
          void stateQuery.refetch();
        },
        states: stateQuery.data?.entity_states ?? [],
      };
    }
  });
  const currentServerPanel = panels.find((panel) => panel.id === selectedPanelId);
  const remoteChanged = panelDirty
    && savedPanel !== null
    && panelsQuery.data !== undefined
    && (
      currentServerPanel === undefined
      || currentServerPanel.updated_at !== savedPanel.updated_at
    );
  const assignmentRemoteChanged = assignmentDirty
    && savedAssignments !== null
    && panelsQuery.data !== undefined
    && (
      currentServerPanel === undefined
      || !samePanelEntityAssignments(currentServerPanel.entities, savedAssignments)
    );
  const requiredSpeakerEntityIds = useMemo(
    () => panelSpeakerEntityIds(draft?.dialogue ?? []),
    [draft?.dialogue],
  );
  const writeBlocked = selectedPage === null
    || selectedPage.status === 'confirmed'
    || selectedPage.status === 'generating'
    || generationActive;
  const readOnly = writeBlocked || generationPreparationActive;
  const selectionLockActive = generationActive || generationPreparationActive;
  const pageSelectionBlocked = selectionLockActive && selectedPageId !== null;
  const panelSelectionBlocked = selectionLockActive && selectedPanelId !== null;
  const editorReadOnly = readOnly || structureBusy || structureReconcileRequired;
  const currentScope = [
    sessionKey,
    organizationId ?? 'personal',
    workId,
    selectedPageId ?? 'no-page',
    selectedPanelId ?? 'no-panel',
  ].join(':');
  currentScopeRef.current = currentScope;

  const applySelectedPanel = useCallback((panel: PanelRecord | null): void => {
    setSelectedPanelId(panel?.id ?? null);
    setSavedPanel(panel);
    const nextDraft = panel === null ? null : createPanelDraft(panel);
    setSavedDraft(nextDraft);
    setDraft(nextDraft);
    const nextAssignments = panel === null
      ? null
      : createPanelEntityAssignmentDraft(panel.entities);
    setSavedAssignments(nextAssignments);
    setAssignmentDraft(nextAssignments);
  }, []);

  useEffect(() => {
    if (resourceScopeRef.current === resourceScope) {
      return;
    }
    resourceScopeRef.current = resourceScope;
    setSelectedPageId(null);
    applySelectedPanel(null);
    setBusy(false);
    setErrorMessage(null);
    setNoticeMessage(null);
    setValidationReason(null);
    setAssignmentBusy(false);
    setAssignmentErrorMessage(null);
    setAssignmentNoticeMessage(null);
    setAssignmentValidationReason(null);
    setAssignmentReconcileRequired(false);
    setAssignmentConflict(false);
    setStructureErrorMessage(null);
    setStructureNoticeMessage(null);
    setStructureReconcileRequired(false);
    pendingStructureReconciliation.current = null;
  }, [applySelectedPanel, resourceScope]);

  useEffect(() => {
    if (selectedPageId !== null && selectedPage === null && !anyDirty) {
      setSelectedPageId(null);
      applySelectedPanel(null);
    }
  }, [anyDirty, applySelectedPanel, selectedPage, selectedPageId]);

  useEffect(() => {
    if (selectedPage === null || panelsQuery.isLoading || anyDirty) {
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
    anyDirty,
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
    if (
      writeBlocked
      || panelsQuery.isFetching
      || panelsQuery.isError
      || assignmentDirty
      || assignmentReconcileRequired
      || assignmentConflict
      || structureBusy
      || structureReconcileRequired
    ) {
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
      (assignmentDraft ?? savedPanel.entities).map((assignment) => assignment.entity_id),
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
    const capturedScope = currentScope;
    let operation: Promise<boolean> | null = null;
    operation = (async (): Promise<boolean> => {
      try {
        const updated = await api.updatePanel(
          selectedPanelId,
          update.payload,
          organizationId,
        );
        if (currentScopeRef.current !== capturedScope) {
          return false;
        }
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
        if (currentScopeRef.current === capturedScope) {
          setErrorMessage(t(language, 'panelSaveError'));
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
    applySelectedPanel,
    assignmentConflict,
    assignmentDraft,
    assignmentDirty,
    assignmentReconcileRequired,
    currentScope,
    draft,
    language,
    organizationId,
    panelDirty,
    panelsQuery.isError,
    panelsQuery.isFetching,
    queryClient,
    queryKeys,
    remoteChanged,
    savedDraft,
    savedPanel,
    selectedPage,
    selectedPanelId,
    structureBusy,
    structureReconcileRequired,
    writeBlocked,
  ]);

  const saveCurrentAssignments = useCallback((): Promise<boolean> => {
    if (assignmentSaveOperation.current !== null) {
      return assignmentSaveOperation.current;
    }
    if (!assignmentDirty) {
      return Promise.resolve(true);
    }
    if (
      selectedPage === null
      || selectedPanelId === null
      || savedAssignments === null
      || assignmentDraft === null
      || draft === null
    ) {
      setAssignmentNoticeMessage(null);
      setAssignmentErrorMessage(t(language, 'panelSaveTargetMissing'));
      return Promise.resolve(false);
    }
    if (
      writeBlocked
      || panelDirty
      || panelsQuery.isFetching
      || panelsQuery.isError
      || entitiesQuery.data === undefined
      || assignmentReconcileRequired
      || structureBusy
      || structureReconcileRequired
    ) {
      setAssignmentNoticeMessage(null);
      setAssignmentErrorMessage(t(language, 'panelAssignmentSaveBlocked'));
      return Promise.resolve(false);
    }
    if (assignmentRemoteChanged || assignmentConflict) {
      setAssignmentNoticeMessage(null);
      setAssignmentErrorMessage(t(language, 'panelAssignmentRemoteChanged'));
      return Promise.resolve(false);
    }

    const replacement = buildPanelEntityAssignmentReplacement(
      savedAssignments,
      assignmentDraft,
      requiredSpeakerEntityIds,
    );
    if (!replacement.ok) {
      setAssignmentNoticeMessage(null);
      setAssignmentErrorMessage(null);
      setAssignmentValidationReason(replacement.reason);
      return Promise.resolve(false);
    }

    const capturedScope = currentScope;
    const capturedPageId = selectedPage.id;
    const capturedPanelId = selectedPanelId;
    const capturedOrganizationId = organizationId;
    setAssignmentBusy(true);
    setAssignmentErrorMessage(null);
    setAssignmentNoticeMessage(null);
    setAssignmentValidationReason(null);
    setAssignmentConflict(false);
    let operation: Promise<boolean> | null = null;
    operation = (async (): Promise<boolean> => {
      try {
        await api.replacePanelEntityAssignments(
          capturedPanelId,
          replacement.body,
          capturedOrganizationId,
        );
        if (currentScopeRef.current !== capturedScope) {
          return false;
        }

        let refreshed: { panels: PanelRecord[] };
        try {
          refreshed = await api.getPanels(capturedPageId, capturedOrganizationId);
        } catch {
          if (currentScopeRef.current === capturedScope) {
            setAssignmentReconcileRequired(true);
            setAssignmentErrorMessage(t(language, 'panelAssignmentSaveResultUnknown'));
          }
          return false;
        }
        if (currentScopeRef.current !== capturedScope) {
          return false;
        }
        const sorted = sortPanels(refreshed.panels);
        const authoritativePanel = sorted.find((panel) => panel.id === capturedPanelId);
        if (
          authoritativePanel === undefined
          || !samePanelEntityAssignments(
            authoritativePanel.entities,
            replacement.body.entities,
          )
        ) {
          setAssignmentReconcileRequired(false);
          setAssignmentConflict(true);
          setAssignmentErrorMessage(t(language, 'panelAssignmentRemoteChanged'));
          return false;
        }

        queryClient.setQueryData<{ panels: PanelRecord[] }>(
          queryKeys.panels(capturedPageId),
          { panels: sorted },
        );
        applySelectedPanel(authoritativePanel);
        setAssignmentReconcileRequired(false);
        setAssignmentConflict(false);
        setAssignmentNoticeMessage(t(language, 'panelAssignmentSaved'));
        return true;
      } catch (error) {
        if (currentScopeRef.current !== capturedScope) {
          return false;
        }
        setAssignmentNoticeMessage(null);
        if (error instanceof ApiError && error.status === 409) {
          setAssignmentConflict(true);
          setAssignmentReconcileRequired(true);
          setAssignmentErrorMessage(t(language, 'panelAssignmentRemoteChanged'));
          return false;
        }
        if (isAmbiguousAssignmentFailure(error)) {
          setAssignmentReconcileRequired(true);
          setAssignmentErrorMessage(t(language, 'panelAssignmentSaveResultUnknown'));
          return false;
        }
        setAssignmentErrorMessage(t(language, 'panelAssignmentSaveError'));
        return false;
      } finally {
        setAssignmentBusy(false);
        if (assignmentSaveOperation.current === operation) {
          assignmentSaveOperation.current = null;
        }
      }
    })();
    assignmentSaveOperation.current = operation;
    return operation;
  }, [
    api,
    applySelectedPanel,
    assignmentConflict,
    assignmentDirty,
    assignmentDraft,
    assignmentReconcileRequired,
    assignmentRemoteChanged,
    currentScope,
    draft,
    entitiesQuery.data,
    language,
    organizationId,
    panelDirty,
    panelsQuery.isError,
    panelsQuery.isFetching,
    queryClient,
    queryKeys,
    requiredSpeakerEntityIds,
    savedAssignments,
    selectedPage,
    selectedPanelId,
    structureBusy,
    structureReconcileRequired,
    writeBlocked,
  ]);

  const reconcileAssignments = useCallback((): Promise<boolean> => {
    if (assignmentSaveOperation.current !== null) {
      return assignmentSaveOperation.current;
    }
    if (
      selectedPage === null
      || selectedPanelId === null
      || savedAssignments === null
      || assignmentDraft === null
    ) {
      return Promise.resolve(false);
    }
    const replacement = buildPanelEntityAssignmentReplacement(
      savedAssignments,
      assignmentDraft,
      requiredSpeakerEntityIds,
    );
    if (!replacement.ok) {
      setAssignmentValidationReason(replacement.reason);
      return Promise.resolve(false);
    }

    const capturedScope = currentScope;
    const capturedPageId = selectedPage.id;
    const capturedPanelId = selectedPanelId;
    const capturedOrganizationId = organizationId;
    setAssignmentBusy(true);
    setAssignmentErrorMessage(null);
    setAssignmentNoticeMessage(null);
    let operation: Promise<boolean> | null = null;
    operation = (async (): Promise<boolean> => {
      try {
        const refreshed = await api.getPanels(capturedPageId, capturedOrganizationId);
        if (currentScopeRef.current !== capturedScope) {
          return false;
        }
        const sorted = sortPanels(refreshed.panels);
        const authoritativePanel = sorted.find((panel) => panel.id === capturedPanelId);
        if (authoritativePanel === undefined) {
          setAssignmentReconcileRequired(false);
          setAssignmentConflict(true);
          setAssignmentErrorMessage(t(language, 'panelAssignmentRemoteChanged'));
          return false;
        }
        if (samePanelEntityAssignments(
          authoritativePanel.entities,
          replacement.body.entities,
        )) {
          queryClient.setQueryData<{ panels: PanelRecord[] }>(
            queryKeys.panels(capturedPageId),
            { panels: sorted },
          );
          applySelectedPanel(authoritativePanel);
          setAssignmentReconcileRequired(false);
          setAssignmentConflict(false);
          setAssignmentNoticeMessage(t(language, 'panelAssignmentSaved'));
          return true;
        }
        if (samePanelEntityAssignments(
          authoritativePanel.entities,
          replacement.body.expected_entities,
        )) {
          setAssignmentReconcileRequired(false);
          setAssignmentConflict(false);
          setAssignmentErrorMessage(t(language, 'panelAssignmentSaveError'));
          return false;
        }
        setAssignmentReconcileRequired(false);
        setAssignmentConflict(true);
        setAssignmentErrorMessage(t(language, 'panelAssignmentRemoteChanged'));
        return false;
      } catch {
        if (currentScopeRef.current === capturedScope) {
          setAssignmentReconcileRequired(true);
          setAssignmentErrorMessage(t(language, 'panelAssignmentSaveResultUnknown'));
        }
        return false;
      } finally {
        setAssignmentBusy(false);
        if (assignmentSaveOperation.current === operation) {
          assignmentSaveOperation.current = null;
        }
      }
    })();
    assignmentSaveOperation.current = operation;
    return operation;
  }, [
    api,
    applySelectedPanel,
    assignmentDraft,
    currentScope,
    language,
    organizationId,
    queryClient,
    queryKeys,
    requiredSpeakerEntityIds,
    savedAssignments,
    selectedPage,
    selectedPanelId,
  ]);

  const resolvePendingPanelDrafts = useCallback(async (): Promise<boolean> => {
    if (saveOperation.current !== null) {
      return saveOperation.current;
    }
    if (assignmentSaveOperation.current !== null) {
      return assignmentSaveOperation.current;
    }
    if (panelDirty && assignmentDirty) {
      setAssignmentErrorMessage(t(language, 'panelAssignmentBothDirty'));
      return false;
    }
    if (!panelDirty && !assignmentDirty) {
      return true;
    }
    const action = resolveDirtyAction === undefined
      ? await showDirtyStoryPrompt(language)
      : await resolveDirtyAction();
    if (action === 'cancel') {
      return false;
    }
    if (action === 'discard') {
      if (panelDirty) {
        setDraft(savedDraft);
        setErrorMessage(null);
        setNoticeMessage(null);
        setValidationReason(null);
      } else {
        setAssignmentDraft(savedAssignments);
        setAssignmentErrorMessage(null);
        setAssignmentNoticeMessage(null);
        setAssignmentValidationReason(null);
        setAssignmentReconcileRequired(false);
        setAssignmentConflict(false);
      }
      return true;
    }
    return panelDirty ? saveCurrentPanel() : saveCurrentAssignments();
  }, [
    assignmentDirty,
    language,
    panelDirty,
    resolveDirtyAction,
    saveCurrentAssignments,
    saveCurrentPanel,
    savedAssignments,
    savedDraft,
  ]);

  const reconcilePanelStructure = useCallback(async (
    pending: PendingPanelStructureReconciliation,
  ): Promise<boolean> => {
    const refreshedPages = await refreshPages();
    if (currentScopeRef.current !== pending.operationScope) {
      return false;
    }
    const refreshedPage = refreshedPages.find((page) => page.id === pending.pageId);
    if (refreshedPage === undefined || refreshedPage.episode_id !== pending.episodeId) {
      pendingStructureReconciliation.current = null;
      setStructureReconcileRequired(false);
      setStructureNoticeMessage(null);
      setStructureErrorMessage(t(language, 'panelStructureConflict'));
      applySelectedPanel(null);
      return false;
    }

    const refreshed = await api.getPanels(pending.pageId, pending.organizationId);
    if (currentScopeRef.current !== pending.operationScope) {
      return false;
    }
    const authoritativePanels = sortPanels(refreshed.panels);
    const authoritativePanelIds = authoritativePanels.map((panel) => panel.id);
    if (
      refreshedPage.panel_count !== authoritativePanelIds.length
      || refreshedPage.frame_count !== authoritativePanelIds.length
      || (
        pending.acceptedFrameCount !== null
        && pending.acceptedPanelIds !== null
        && orderedIdsEqual(authoritativePanelIds, pending.acceptedPanelIds)
        && refreshedPage.frame_count !== pending.acceptedFrameCount
      )
    ) {
      throw new Error('PANEL_STRUCTURE_METADATA_MISMATCH');
    }

    const outcome = classifyPanelStructureSnapshot(pending, authoritativePanelIds);
    queryClient.setQueryData<{ panels: PanelRecord[] }>(
      queryKeys.panels(pending.pageId),
      { panels: authoritativePanels },
    );
    const nextSelectedId = resolvePanelSelectionAfterStructure(
      pending,
      authoritativePanelIds,
      outcome,
    );
    applySelectedPanel(
      authoritativePanels.find((panel) => panel.id === nextSelectedId) ?? null,
    );
    pendingStructureReconciliation.current = null;
    setStructureReconcileRequired(false);
    setStructureNoticeMessage(null);

    if (pending.requestFailure === 'conflict') {
      setStructureErrorMessage(t(language, 'panelStructureConflict'));
      return false;
    }
    if (pending.requestFailure === 'definitive') {
      setStructureErrorMessage(t(language, 'panelStructureError'));
      return false;
    }
    if (outcome === 'applied') {
      setStructureErrorMessage(null);
      setStructureNoticeMessage(t(language, structureSuccessMessageKey(pending.operation)));
      return true;
    }
    if (outcome === 'unchanged') {
      setStructureErrorMessage(t(
        language,
        'panelStructureNotApplied',
      ));
      return false;
    }
    setStructureErrorMessage(t(language, 'panelStructureConflict'));
    return false;
  }, [api, applySelectedPanel, language, queryClient, queryKeys, refreshPages]);

  const reconcilePendingPanelStructure = useCallback((): Promise<boolean> => {
    if (structureOperation.current !== null) {
      return structureOperation.current;
    }
    const pending = pendingStructureReconciliation.current;
    if (pending === null || currentScopeRef.current !== pending.operationScope) {
      return Promise.resolve(false);
    }
    setStructureBusy(true);
    onStructureActiveChange(true);
    setStructureErrorMessage(null);
    setStructureNoticeMessage(null);
    let operation: Promise<boolean> | null = null;
    operation = (async (): Promise<boolean> => {
      try {
        return await reconcilePanelStructure(pending);
      } catch {
        if (currentScopeRef.current === pending.operationScope) {
          setStructureReconcileRequired(true);
          setStructureErrorMessage(t(language, 'panelStructureOutcomeUnknown'));
        }
        return false;
      } finally {
        setStructureBusy(false);
        onStructureActiveChange(false);
        if (structureOperation.current === operation) {
          structureOperation.current = null;
        }
      }
    })();
    structureOperation.current = operation;
    return operation;
  }, [language, onStructureActiveChange, reconcilePanelStructure]);

  const runPanelStructureOperation = useCallback((
    requestedOperation: PanelStructureOperation,
  ): Promise<boolean> => {
    if (structureOperation.current !== null) {
      return structureOperation.current;
    }
    if (
      selectedPage === null
      || readOnly
      || panelsQuery.isLoading
      || panelsQuery.isFetching
      || panelsQuery.isError
      || structureReconcileRequired
      || assignmentReconcileRequired
      || assignmentConflict
    ) {
      setStructureNoticeMessage(null);
      setStructureErrorMessage(t(language, 'panelStructureBlocked'));
      return Promise.resolve(false);
    }

    const expectedPanelIds = panels.map((panel) => panel.id);
    const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) ?? null;
    if (requestedOperation.type === 'append' && expectedPanelIds.length >= 8) {
      setStructureNoticeMessage(null);
      setStructureErrorMessage(t(language, 'panelStructureAppendLimit'));
      return Promise.resolve(false);
    }
    if (requestedOperation.type === 'delete') {
      if (expectedPanelIds.length <= 1) {
        setStructureNoticeMessage(null);
        setStructureErrorMessage(t(language, 'panelStructureDeleteLast'));
        return Promise.resolve(false);
      }
      if (selectedPanel === null || requestedOperation.panel_id !== selectedPanel.id) {
        setStructureNoticeMessage(null);
        setStructureErrorMessage(t(language, 'panelStructureBlocked'));
        return Promise.resolve(false);
      }
    }
    if (
      requestedOperation.type === 'reorder'
      && !samePanelIdSet(expectedPanelIds, requestedOperation.panel_ids)
    ) {
      setStructureNoticeMessage(null);
      setStructureErrorMessage(t(language, 'panelStructureBlocked'));
      return Promise.resolve(false);
    }

    setStructureBusy(true);
    onStructureActiveChange(true);
    setStructureErrorMessage(null);
    setStructureNoticeMessage(null);

    const pending: PendingPanelStructureReconciliation = {
      acceptedCreatedPanelId: null,
      acceptedFrameCount: null,
      acceptedPanelIds: null,
      episodeId: selectedPage.episode_id,
      expectedPanelIds,
      operation: clonePanelStructureOperation(requestedOperation),
      operationScope: currentScope,
      organizationId,
      pageId: selectedPage.id,
      previousSelectedPanelId: selectedPanelId,
      requestFailure: null,
    };
    let operation: Promise<boolean> | null = null;
    operation = (async (): Promise<boolean> => {
      try {
        if (
          pending.operation.type === 'delete'
          && selectedPanel !== null
          && !(await resolvePanelDeleteConfirmation(selectedPanel.order))
        ) {
          return false;
        }
        if (currentScopeRef.current !== pending.operationScope) {
          return false;
        }
        if (!(await preparePageSettings())) {
          return false;
        }
        if (
          currentScopeRef.current !== pending.operationScope
          || !(await resolvePendingPanelDrafts())
          || currentScopeRef.current !== pending.operationScope
        ) {
          return false;
        }

        let response: PagePanelStructureResponse;
        try {
          response = await api.applyPagePanelStructure(
            pending.pageId,
            {
              expected_panel_ids: [...pending.expectedPanelIds],
              operation: clonePanelStructureOperation(pending.operation),
            },
            pending.organizationId,
          );
        } catch (error) {
          if (currentScopeRef.current !== pending.operationScope) {
            return false;
          }
          pending.requestFailure = classifyPanelStructureRequestFailure(error);
          pendingStructureReconciliation.current = pending;
          try {
            return await reconcilePanelStructure(pending);
          } catch {
            if (currentScopeRef.current === pending.operationScope) {
              setStructureReconcileRequired(true);
              setStructureErrorMessage(t(language, 'panelStructureOutcomeUnknown'));
            }
            return false;
          }
        }

        if (currentScopeRef.current !== pending.operationScope) {
          return false;
        }
        pending.acceptedCreatedPanelId = response.created_panel_id;
        pending.acceptedFrameCount = response.frames.length;
        pending.acceptedPanelIds = [...response.panel_ids];
        pendingStructureReconciliation.current = pending;
        try {
          return await reconcilePanelStructure(pending);
        } catch {
          if (currentScopeRef.current === pending.operationScope) {
            setStructureReconcileRequired(true);
            setStructureErrorMessage(t(language, 'panelStructureOutcomeUnknown'));
          }
          return false;
        }
      } finally {
        setStructureBusy(false);
        onStructureActiveChange(false);
        if (structureOperation.current === operation) {
          structureOperation.current = null;
        }
      }
    })();
    structureOperation.current = operation;
    return operation;
  }, [
    api,
    assignmentConflict,
    assignmentReconcileRequired,
    currentScope,
    language,
    organizationId,
    onStructureActiveChange,
    panels,
    panelsQuery.isError,
    panelsQuery.isFetching,
    panelsQuery.isLoading,
    preparePageSettings,
    readOnly,
    reconcilePanelStructure,
    resolvePanelDeleteConfirmation,
    resolvePendingPanelDrafts,
    selectedPage,
    selectedPanelId,
    structureReconcileRequired,
  ]);

  const resolvePendingPanel = useCallback(async (): Promise<boolean> => {
    if (structureOperation.current !== null) {
      return structureOperation.current;
    }
    if (structureReconcileRequired) {
      return false;
    }
    return resolvePendingPanelDrafts();
  }, [resolvePendingPanelDrafts, structureReconcileRequired]);

  useImperativeHandle(ref, () => ({
    prepareToLeave: resolvePendingPanel,
  }), [resolvePendingPanel]);

  const transition = useCallback((changeSelection: () => void): Promise<boolean> => {
    if (structureOperation.current !== null || structureReconcileRequired) {
      return Promise.resolve(false);
    }
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
  }, [resolvePendingPanel, structureReconcileRequired]);

  const selectedPanelIndex = panels.findIndex((panel) => panel.id === selectedPanelId);
  const structureControlsUnavailable = readOnly
    || panelsQuery.isLoading
    || panelsQuery.isFetching
    || panelsQuery.isError
    || structureBusy
    || structureReconcileRequired
    || assignmentReconcileRequired
    || assignmentConflict;
  const moveSelectedPanel = (offset: -1 | 1): void => {
    if (selectedPanelIndex < 0) {
      return;
    }
    const targetIndex = selectedPanelIndex + offset;
    if (targetIndex < 0 || targetIndex >= panels.length) {
      return;
    }
    const reorderedPanelIds = panels.map((panel) => panel.id);
    const selectedId = reorderedPanelIds[selectedPanelIndex];
    const targetId = reorderedPanelIds[targetIndex];
    if (selectedId === undefined || targetId === undefined) {
      return;
    }
    reorderedPanelIds[selectedPanelIndex] = targetId;
    reorderedPanelIds[targetIndex] = selectedId;
    void runPanelStructureOperation({ type: 'reorder', panel_ids: reorderedPanelIds });
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{t(language, 'panelEditing')}</Text>
      <Text style={styles.muted}>{t(language, 'panelEditingHelp')}</Text>
      {pageListReady ? (
        <StorySelectionSection
          disabled={pageSelectionBlocked}
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
            if (!pageSelectionBlocked && pageId !== selectedPageId) {
              void transition(() => {
                setSelectedPageId(pageId);
                applySelectedPanel(null);
                setErrorMessage(null);
                setNoticeMessage(null);
                setValidationReason(null);
                setAssignmentErrorMessage(null);
                setAssignmentNoticeMessage(null);
                setAssignmentValidationReason(null);
                setAssignmentReconcileRequired(false);
                setAssignmentConflict(false);
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
          disabled={panelSelectionBlocked}
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
            if (
              !panelSelectionBlocked
              && panel !== undefined
              && panel.id !== selectedPanelId
            ) {
              void transition(() => {
                applySelectedPanel(panel);
                setErrorMessage(null);
                setNoticeMessage(null);
                setValidationReason(null);
                setAssignmentErrorMessage(null);
                setAssignmentNoticeMessage(null);
                setAssignmentValidationReason(null);
                setAssignmentReconcileRequired(false);
                setAssignmentConflict(false);
              });
            }
          }}
          retryLabel={t(language, 'panelRetry')}
          selectedId={selectedPanelId}
          selectSuffix={t(language, 'storySelectSuffix')}
        />
      )}
      {selectedPage === null ? null : (
        <View style={styles.structureControls}>
          <Text style={styles.subheading}>{t(language, 'panelStructureControls')}</Text>
          <Text style={styles.muted}>{t(language, 'panelStructureHelp')}</Text>
          {structureErrorMessage === null ? null : (
            <Notice message={structureErrorMessage} tone="danger" />
          )}
          {structureNoticeMessage === null ? null : (
            <Notice message={structureNoticeMessage} />
          )}
          <PrimaryButton
            disabled={structureControlsUnavailable || panels.length >= 8}
            label={t(language, 'panelStructureAppend')}
            onPress={() => void runPanelStructureOperation({ type: 'append' })}
          />
          <View style={styles.structureMoveControls}>
            <View style={styles.structureMoveControl}>
              <PrimaryButton
                disabled={structureControlsUnavailable || selectedPanelIndex <= 0}
                label={t(language, 'panelStructureMoveEarlier')}
                onPress={() => moveSelectedPanel(-1)}
              />
            </View>
            <View style={styles.structureMoveControl}>
              <PrimaryButton
                disabled={
                  structureControlsUnavailable
                  || selectedPanelIndex < 0
                  || selectedPanelIndex >= panels.length - 1
                }
                label={t(language, 'panelStructureMoveLater')}
                onPress={() => moveSelectedPanel(1)}
              />
            </View>
          </View>
          <PrimaryButton
            disabled={
              structureControlsUnavailable
              || selectedPanelIndex < 0
              || panels.length <= 1
            }
            label={t(language, 'panelStructureDelete')}
            onPress={() => {
              const selectedPanel = panels[selectedPanelIndex];
              if (selectedPanel !== undefined) {
                void runPanelStructureOperation({
                  type: 'delete',
                  panel_id: selectedPanel.id,
                });
              }
            }}
            tone="danger"
          />
          {structureReconcileRequired ? (
            <PrimaryButton
              disabled={structureBusy}
              label={t(language, 'panelStructureReconcile')}
              onPress={() => void reconcilePendingPanelStructure()}
            />
          ) : null}
          {panels.length >= 8 ? (
            <Text style={styles.muted}>{t(language, 'panelStructureAppendLimit')}</Text>
          ) : null}
          {panels.length === 1 ? (
            <Text style={styles.muted}>{t(language, 'panelStructureDeleteLast')}</Text>
          ) : null}
        </View>
      )}
      {draft === null || savedPanel === null ? null : (
        <PanelEditor
          assignedEntityIds={(assignmentDraft ?? savedPanel.entities)
            .map((assignment) => assignment.entity_id)}
          busy={busy || structureBusy}
          dirty={panelDirty}
          draft={draft}
          draftBlocked={assignmentDirty || assignmentReconcileRequired || assignmentConflict}
          errorMessage={errorMessage}
          language={language}
          noticeMessage={noticeMessage}
          onChange={(nextDraft) => {
            if (editorReadOnly) {
              return;
            }
            setDraft(nextDraft);
            setErrorMessage(null);
            setNoticeMessage(null);
            setValidationReason(null);
          }}
          onSave={() => void saveCurrentPanel()}
          readOnly={editorReadOnly}
          remoteChanged={remoteChanged}
          validationReason={validationReason}
        />
      )}
      {assignmentDraft === null || savedPanel === null ? null : (
        <PanelEntityAssignmentEditor
          assignments={assignmentDraft}
          blockedByContentDraft={panelDirty}
          busy={assignmentBusy || structureBusy}
          canLoadMoreEntities={entitiesQuery.hasNextPage === true}
          dirty={assignmentDirty}
          entities={entities}
          entityListError={entitiesQuery.isError && entitiesQuery.data === undefined}
          entityListLoading={entitiesQuery.isLoading}
          errorMessage={assignmentErrorMessage}
          language={language}
          loadingMoreEntities={entitiesQuery.isFetchingNextPage}
          noticeMessage={assignmentNoticeMessage}
          onChange={(nextAssignments) => {
            if (
              panelDirty
              || editorReadOnly
              || assignmentReconcileRequired
              || assignmentConflict
            ) {
              return;
            }
            setAssignmentDraft(nextAssignments);
            setAssignmentErrorMessage(null);
            setAssignmentNoticeMessage(null);
            setAssignmentValidationReason(null);
          }}
          onLoadMoreEntities={() => void entitiesQuery.fetchNextPage()}
          onReconcile={() => void reconcileAssignments()}
          onRetryEntities={() => void entitiesQuery.refetch()}
          onSave={() => void saveCurrentAssignments()}
          readOnly={editorReadOnly}
          reconcileRequired={assignmentReconcileRequired}
          remoteChanged={assignmentRemoteChanged || assignmentConflict}
          requiredSpeakerEntityIds={requiredSpeakerEntityIds}
          stateCatalogs={stateCatalogs}
          validationReason={assignmentValidationReason}
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

function panelSpeakerEntityIds(
  dialogue: readonly PanelDraft['dialogue'][number][],
): string[] {
  const speakerEntityIds = new Set<string>();
  for (const line of dialogue) {
    if (
      (line.type === 'speech'
        || line.type === 'thought'
        || line.type === 'shout'
        || line.type === 'whisper')
      && line.entityId !== null
    ) {
      speakerEntityIds.add(line.entityId);
    }
  }
  return [...speakerEntityIds];
}

function classifyPanelStructureSnapshot(
  pending: PendingPanelStructureReconciliation,
  currentPanelIds: string[],
): 'applied' | 'conflict' | 'unchanged' {
  if (pending.acceptedPanelIds !== null) {
    return orderedIdsEqual(currentPanelIds, pending.acceptedPanelIds)
      ? 'applied'
      : 'conflict';
  }
  if (orderedIdsEqual(currentPanelIds, pending.expectedPanelIds)) {
    return 'unchanged';
  }
  if (pending.operation.type === 'append') {
    return currentPanelIds.length === pending.expectedPanelIds.length + 1
      && pending.expectedPanelIds.every((panelId, index) => currentPanelIds[index] === panelId)
      ? 'applied'
      : 'conflict';
  }
  if (pending.operation.type === 'delete') {
    const deletedPanelId = pending.operation.panel_id;
    return orderedIdsEqual(
      currentPanelIds,
      pending.expectedPanelIds.filter((panelId) => panelId !== deletedPanelId),
    ) ? 'applied' : 'conflict';
  }
  return orderedIdsEqual(currentPanelIds, pending.operation.panel_ids)
    ? 'applied'
    : 'conflict';
}

function resolvePanelSelectionAfterStructure(
  pending: PendingPanelStructureReconciliation,
  currentPanelIds: string[],
  outcome: 'applied' | 'conflict' | 'unchanged',
): string | null {
  if (outcome === 'applied' && pending.operation.type === 'append') {
    return pending.acceptedCreatedPanelId
      ?? currentPanelIds.find((panelId) => !pending.expectedPanelIds.includes(panelId))
      ?? null;
  }
  if (
    outcome === 'applied'
    && pending.operation.type === 'delete'
    && pending.previousSelectedPanelId === pending.operation.panel_id
  ) {
    const deletedIndex = pending.expectedPanelIds.indexOf(pending.operation.panel_id);
    return currentPanelIds[Math.min(deletedIndex, currentPanelIds.length - 1)] ?? null;
  }
  if (
    pending.previousSelectedPanelId !== null
    && currentPanelIds.includes(pending.previousSelectedPanelId)
  ) {
    return pending.previousSelectedPanelId;
  }
  const previousIndex = pending.previousSelectedPanelId === null
    ? -1
    : pending.expectedPanelIds.indexOf(pending.previousSelectedPanelId);
  return previousIndex < 0
    ? null
    : currentPanelIds[Math.min(previousIndex, currentPanelIds.length - 1)] ?? null;
}

function classifyPanelStructureRequestFailure(
  error: unknown,
): PendingPanelStructureReconciliation['requestFailure'] {
  if (!(error instanceof ApiError)) {
    return 'ambiguous';
  }
  if (error.status === 409) {
    return 'conflict';
  }
  if (error.code === 'INVALID_API_RESPONSE' || error.status === 0 || error.status >= 500) {
    return 'ambiguous';
  }
  return 'definitive';
}

function structureSuccessMessageKey(
  operation: PanelStructureOperation,
): 'panelStructureAppended' | 'panelStructureDeleted' | 'panelStructureMoved' {
  if (operation.type === 'append') {
    return 'panelStructureAppended';
  }
  return operation.type === 'delete' ? 'panelStructureDeleted' : 'panelStructureMoved';
}

function clonePanelStructureOperation(operation: PanelStructureOperation): PanelStructureOperation {
  if (operation.type === 'reorder') {
    return { type: 'reorder', panel_ids: [...operation.panel_ids] };
  }
  return { ...operation };
}

function samePanelIdSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && right.every((panelId) => left.includes(panelId));
}

function orderedIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((panelId, index) => panelId === right[index]);
}

function isAmbiguousAssignmentFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return true;
  }
  return error.code === 'INVALID_API_RESPONSE' || error.status >= 500;
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
  structureControls: {
    gap: spacing.sm,
  },
  structureMoveControl: {
    flex: 1,
  },
  structureMoveControls: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  subheading: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  section: {
    gap: spacing.md,
  },
});
