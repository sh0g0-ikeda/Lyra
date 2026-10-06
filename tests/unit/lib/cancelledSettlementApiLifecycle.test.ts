import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const state=vi.hoisted(()=>({
  prepare:vi.fn(),capabilities:vi.fn(),app:vi.fn(),
  proof:Object.freeze({descriptor:'production44_expanded_pg18_v1',repositoryProfile:'production44_expanded_pg18_v1',capabilities:Object.freeze({entityStateMonotonicRevision:true})}),
  closeDatabase:vi.fn(),query:vi.fn(),serve:vi.fn(),closeHttp:vi.fn(),
  cancelledFactory:vi.fn(),cancelledMaintenance:vi.fn(),stopCancelled:vi.fn(),
  stopPush:vi.fn(),stopAccount:vi.fn(),stopExport:vi.fn(),
  terminalFactory:vi.fn(),terminalMaintenance:vi.fn(),stopTerminal:vi.fn(),
}));
vi.mock('../../../src/lib/env.js',()=>({env:{AUTO_RUN_MIGRATIONS:false,PORT:0}}));
vi.mock('../../../src/lib/db.js',()=>({db:{query:state.query},closeDatabasePool:state.closeDatabase}));
vi.mock('../../../src/lib/runtimeGuards.js',()=>({assertProductionRuntimeConfig:vi.fn(),assertAttestedRuntimeCapabilities:state.capabilities}));
vi.mock('../../../src/lib/runtimeSchemaAttestation.js',()=>({
  prepareAttestedRuntimeSchema:state.prepare,
  startAttestedRuntime:async(input:{attest:()=>Promise<unknown>;start:(runtime:{descriptor:string;repositoryProfile:string})=>Promise<void>})=>{
    await input.start(await input.attest() as typeof state.proof);
  },
}));
vi.mock('../../../src/lib/cancelledGenerationSettlementRecoveryRuntime.js',()=>({
  createCancelledGenerationSettlementRecoveryRuntime:state.cancelledFactory,
  startCancelledGenerationSettlementRecoveryMaintenance:state.cancelledMaintenance,
}));
vi.mock('../../../src/lib/terminalGenerationNotificationRecoveryRuntime.js',()=>({
  createTerminalGenerationNotificationRecoveryRuntime:state.terminalFactory,
  startTerminalGenerationNotificationRecoveryMaintenance:state.terminalMaintenance,
}));
vi.mock('../../../src/infrastructure/state/FencedStateReferenceRuntime.js',()=>({createFencedStateReferenceRuntime:()=>null}));
vi.mock('../../../src/infrastructure/push/PushNotificationRuntime.js',()=>({createPushNotificationDeliveryRuntime:()=>null}));
vi.mock('../../../src/lib/pushNotificationMaintenance.js',()=>({startPushNotificationMaintenance:()=>state.stopPush}));
vi.mock('../../../src/infrastructure/account/AccountDeletionRuntime.js',()=>({createAccountDeletionRecoveryRuntime:()=>null,startAccountDeletionRecovery:()=>state.stopAccount}));
vi.mock('../../../src/lib/episodeExportMaintenanceRuntime.js',()=>({createEpisodeExportMaintenanceRuntime:()=>null}));
vi.mock('../../../src/lib/episodeExportMaintenance.js',()=>({startEpisodeExportMaintenance:()=>state.stopExport}));
vi.mock('../../../src/services/page/PageGenerationRecoveryService.js',()=>({PageGenerationRecoveryService:class{async recoverAllStaleJobs():Promise<number>{return 0;}}}));
vi.mock('../../../src/services/entity/EntityGenerationRecoveryService.js',()=>({EntityGenerationRecoveryService:class{async recoverAllStaleJobs():Promise<number>{return 0;}}}));
vi.mock('../../../src/app.js',()=>({createApp:state.app}));
vi.mock('@hono/node-server',()=>({serve:state.serve}));

beforeEach(()=>{vi.resetModules();vi.clearAllMocks();state.prepare.mockResolvedValue({runtime:state.proof,appliedMigrations:[]});state.capabilities.mockReset();state.app.mockReturnValue({fetch:vi.fn()});});
afterEach(()=>{vi.restoreAllMocks();process.exitCode=0;});
it.each(['schema','capability'])('APIは%s拒否時にfactory・timer・listenerを始めずDBを閉じる',async failure=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});vi.spyOn(console,'warn').mockImplementation(()=>{});
  if(failure==='schema')state.prepare.mockRejectedValueOnce(new Error('Artificial unsupported catalog'));
  else state.capabilities.mockImplementationOnce(()=>{throw new Error('048 required');});
  await import('../../../src/index.js');await flush();
  expect(state.terminalFactory).not.toHaveBeenCalled();expect(state.cancelledFactory).not.toHaveBeenCalled();
  expect(state.serve).not.toHaveBeenCalled();expect(state.app).not.toHaveBeenCalled();expect(state.closeDatabase).toHaveBeenCalledOnce();
});

it('実API入口は全maintenanceとHTTP drain完了前にDBを閉じず重複signalも一度だけ停止する',async()=>{
  vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
  const signals=new Map<string,()=>void>();const originalOnce=process.once.bind(process);
  vi.spyOn(process,'once').mockImplementation((event,listener)=>{
    if(event==='SIGINT'||event==='SIGTERM'){signals.set(event,listener as ()=>void);return process;}
    return originalOnce(event,listener);
  });
  const finish:Array<()=>void>=[];
  for(const stop of [state.stopCancelled,state.stopPush,state.stopAccount,state.stopExport,state.stopTerminal]){
    stop.mockReturnValue(new Promise<void>(resolve=>finish.push(resolve)));
  }
  let finishHttp!:()=>void;state.closeHttp.mockImplementation((done:()=>void)=>{finishHttp=done;});
  state.serve.mockReturnValue({close:state.closeHttp});state.cancelledFactory.mockResolvedValue(null);state.cancelledMaintenance.mockResolvedValue(state.stopCancelled);
  state.terminalFactory.mockResolvedValue(null);state.terminalMaintenance.mockResolvedValue(state.stopTerminal);
  await import('../../../src/index.js');await flush();expect(state.serve).toHaveBeenCalledOnce();
  signals.get('SIGTERM')!();signals.get('SIGINT')!();
  try{
    for(const stop of [state.stopCancelled,state.stopPush,state.stopAccount,state.stopExport,state.stopTerminal])expect(stop).toHaveBeenCalledOnce();
    finish[0]!();finish[1]!();finishHttp();await flush();expect(state.closeDatabase).not.toHaveBeenCalled();
    finish[2]!();await flush();expect(state.closeDatabase).not.toHaveBeenCalled();
    finish[3]!();await flush();expect(state.closeDatabase).not.toHaveBeenCalled();
    finish[4]!();await flush();expect(state.closeDatabase).toHaveBeenCalledOnce();
    expect(state.cancelledFactory).toHaveBeenCalledOnce();expect(state.cancelledMaintenance).toHaveBeenCalledOnce();
    expect(state.query).not.toHaveBeenCalled();
    expect(state.app.mock.calls[0]![0].attestedRuntime).toBe(state.proof);
    expect(state.cancelledFactory.mock.calls[0]![1]).toBe(state.proof.repositoryProfile);
    expect(state.terminalFactory.mock.calls[0]![1]).toBe(state.proof.repositoryProfile);
  }finally{for(const resolve of finish)resolve();await flush();}
});

async function flush():Promise<void>{for(let count=0;count<40;count++)await Promise.resolve();}
