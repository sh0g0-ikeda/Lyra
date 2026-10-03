import { ACTIVE_START_AT } from './stage-lifecycle-guard-core.mjs';

export function shouldCollectDatabaseDrainProof({action,nowUtc,state,inventory}) {
  const safe=state.workersStoppedAt ?? state.apiStoppedAt;
  return action==='wait-db-drain'
    && state.databaseContractCleanupObservedAt===null
    && Number.isFinite(Date.parse(nowUtc)) && Date.parse(nowUtc)>=Date.parse(ACTIVE_START_AT)
    && typeof safe==='string' && Number.isFinite(Date.parse(safe)) && Date.parse(safe)<=Date.parse(nowUtc)
    && inventory.database.exists===true && inventory.database.owned===true && inventory.database.status==='available'
    && inventory.proofExecutorStack.exists===true && inventory.proofExecutorStack.owned===true
    && ['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(inventory.proofExecutorStack.status);
}

export async function performLifecycleDecision({decision,now,writeState,perform}) {
  if(!decision.mutates) return;
  // StopDB may succeed even if the subsequent S3 write fails. Persist the sealed
  // proof and intent first so the next invocation can safely resume cleanup.
  if(decision.action==='stop-database') {
    if(
      decision.nextState.databaseStopRequested!==true
      || typeof decision.nextState.databaseDrainProofObservedAt!=='string'
      || typeof decision.nextState.databaseContractCleanupObservedAt!=='string'
    ) throw Error('DATABASE_STOP_INTENT_INVALID');
    await writeState({...decision.nextState,lastAction:decision.action,lastCheckedAt:now});
  }
  await perform(decision.action);
}
