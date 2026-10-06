import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { buildPanelInsertionPayload, canSelectInsertedPanel, panelInsertionBlocker, type PanelInsertionBlocker, type InsertPanelAfterPayload } from '@/domain/panelInsertion';
import type { PageRecord, PanelRecord } from '@/domain/types';
import type { LyraMobileApiClient } from '@/lib/api';
import { balloonsQueryKey, framesQueryKey, pageDetailQueryKey, pageGenerationReadinessQueryKey, pagesQueryKey, panelsQueryKey } from '@/lib/queryKeys';

type InsertionApi = Pick<LyraMobileApiClient, 'insertPanelAfter' | 'getPanels' | 'getFrames'>;
interface Input {
  api: InsertionApi; sessionKey: string; organizationId: string | null;
  workId: string | null; episodeId: string | null; pageId: string | null;
  selectedPanelId: string | null; panels: readonly PanelRecord[] | undefined;
  canEdit: boolean; dirty: boolean; busy: boolean; status: PageRecord['status'] | undefined;
  onSelect: (panelId: string) => void;
}
interface Request {
  api: InsertionApi; scope: string; sessionKey: string; organizationId: string | null;
  episodeId: string | null; pageId: string; selectedPanelId: string; payload: InsertPanelAfterPayload;
  createdPanelId: string | null;
}
type Notice = 'refresh' | 'checking' | 'refreshFailed' | 'failed';
interface Operation {
  request: Request;
  phase: 'pending' | 'refreshing' | 'refreshFailed' | 'failed';
}
interface Result {
  blocker: PanelInsertionBlocker | null;
  operationActive: boolean;
  notice: Notice | null;
  insertAfter: () => Promise<void>;
  reload: () => Promise<void>;
}

// One write has one expected-order snapshot. A failed/unknown receipt can only be
// refreshed, never automatically repeated. All reads stay in the captured scope.
export function usePanelInsertion(input: Input): Result {
  const queryClient = useQueryClient();
  const [operation, setOperation] = useState<Operation | null>(null);
  const lockRef = useRef(false);
  const operationRef = useRef<Operation | null>(null);
  const mountedRef = useRef(true);
  const scope = JSON.stringify([input.sessionKey, input.organizationId, input.workId, input.episodeId, input.pageId]);
  const currentRef = useRef({ input, scope });
  useLayoutEffect(() => {
    currentRef.current = { input, scope };
  }, [input, scope]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const operationActive = operation?.phase === 'pending' || operation?.phase === 'refreshing';
  const currentOperation = operation?.request.scope === scope ? operation : null;
  const blocker = panelInsertionBlocker({ ...input, busy: input.busy || operationActive || currentOperation !== null });
  const notice = currentOperation === null || currentOperation.phase === 'pending' ? null
    : currentOperation.phase === 'refreshing'
      ? currentOperation.request.createdPanelId === null ? 'checking' : 'refresh'
      : currentOperation.phase;
  const setPhase = (request: Request, phase: Operation['phase']): void => {
    operationRef.current = { request, phase };
    if (mountedRef.current) setOperation({ request, phase });
  };

  const refresh = async (request: Request): Promise<void> => {
    const panelKey = panelsQueryKey(request.sessionKey, request.pageId, request.organizationId);
    const frameKey = framesQueryKey(request.sessionKey, request.pageId, request.organizationId);
    await Promise.all([queryClient.cancelQueries({ queryKey: panelKey }), queryClient.cancelQueries({ queryKey: frameKey })]);
    await Promise.all([
      panelKey, frameKey,
      balloonsQueryKey(request.sessionKey, request.pageId, request.organizationId),
      pagesQueryKey(request.sessionKey, request.episodeId, request.organizationId),
      pageDetailQueryKey(request.sessionKey, request.pageId, request.organizationId),
      pageGenerationReadinessQueryKey(request.sessionKey, request.pageId, request.organizationId)
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey, refetchType: 'none' })));
    const [fresh] = await Promise.all([
      queryClient.fetchQuery({ queryKey: panelKey, queryFn: () => request.api.getPanels(request.pageId, request.organizationId), staleTime: 0 }),
      queryClient.fetchQuery({ queryKey: frameKey, queryFn: () => request.api.getFrames(request.pageId, request.organizationId), staleTime: 0 }),
      queryClient.invalidateQueries({ queryKey: pagesQueryKey(request.sessionKey, request.episodeId, request.organizationId) }),
      queryClient.invalidateQueries({ queryKey: pageDetailQueryKey(request.sessionKey, request.pageId, request.organizationId) }),
      queryClient.invalidateQueries({ queryKey: pageGenerationReadinessQueryKey(request.sessionKey, request.pageId, request.organizationId) })
    ]);
    const current = currentRef.current;
    if (mountedRef.current && !current.input.dirty && request.createdPanelId !== null && canSelectInsertedPanel({
      currentScope: current.scope, requestScope: request.scope,
      currentPanelId: current.input.selectedPanelId, selectedPanelId: request.selectedPanelId,
      createdPanelId: request.createdPanelId, panels: fresh.panels
    })) current.input.onSelect(request.createdPanelId);
  };

  const insertAfter = async (): Promise<void> => {
    const latest = currentRef.current;
    if (lockRef.current || operationRef.current?.request.scope === scope || blocker !== null || latest.scope !== scope ||
        latest.input.selectedPanelId !== input.selectedPanelId ||
        panelInsertionBlocker(latest.input) !== null || input.pageId === null ||
        input.selectedPanelId === null || input.panels === undefined) return;
    const payload = buildPanelInsertionPayload(input.panels, input.selectedPanelId);
    const latestPayload = buildPanelInsertionPayload(latest.input.panels ?? [], input.selectedPanelId);
    if (JSON.stringify(payload) !== JSON.stringify(latestPayload)) return;
    const request: Request = {
      api: input.api, scope, sessionKey: input.sessionKey, organizationId: input.organizationId,
      episodeId: input.episodeId, pageId: input.pageId, selectedPanelId: input.selectedPanelId,
      payload, createdPanelId: null
    };
    lockRef.current = true;
    setPhase(request, 'pending');
    try {
      const result = await request.api.insertPanelAfter(request.pageId, request.payload, request.organizationId);
      const selectedIndex = result.panel_ids.indexOf(request.selectedPanelId);
      if (result.created_panel_id === null || selectedIndex < 0 || result.panel_ids[selectedIndex + 1] !== result.created_panel_id) {
        throw new Error('Unconfirmed panel insertion result');
      }
      request.createdPanelId = result.created_panel_id;
      setPhase(request, 'refreshing');
      await refresh(request);
      operationRef.current = null;
      if (mountedRef.current) setOperation(null);
    } catch {
      setPhase(request, request.createdPanelId === null ? 'failed' : 'refreshFailed');
    } finally {
      lockRef.current = false;
    }
  };

  const reload = async (): Promise<void> => {
    if (lockRef.current || currentOperation === null || currentRef.current.scope !== scope) return;
    lockRef.current = true;
    const request = currentOperation.request;
    setPhase(request, 'refreshing');
    try {
      await refresh(request);
      operationRef.current = null;
      if (mountedRef.current) setOperation(null);
    } catch {
      setPhase(request, request.createdPanelId === null ? 'failed' : 'refreshFailed');
    } finally {
      lockRef.current = false;
    }
  };
  return { blocker, operationActive, notice, insertAfter, reload };
}
