import { afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';

const state = ({
  attest:vi.fn(),capabilities:vi.fn(),dependencies:vi.fn(),
  proof:Object.freeze({descriptor:'production44_expanded_pg18_v1',repositoryProfile:'production44_expanded_pg18_v1',capabilities:Object.freeze({entityStateMonotonicRevision:true})}),
  closeDatabase: vi.fn(), query: vi.fn(), pageRecovery: vi.fn(), entityRecovery: vi.fn(),
  cancelledRun: vi.fn(), cancelledStop: vi.fn(), runtimeFactory: vi.fn(),
  terminalRun:vi.fn(),terminalStop:vi.fn(),terminalFactory:vi.fn(),
  poll: vi.fn(), stopPoll: vi.fn(), warmResolve: vi.fn(), warmProtectionAssert: vi.fn(),
});
vi.mock('../../../src/lib/env.js', () => ({env:{SQS_QUEUE_URL_GENERATION:'https://example.invalid/queue'}}));
vi.mock('../../../src/lib/db.js', () => ({db:{query:state.query},closeDatabasePool:state.closeDatabase}));
vi.mock('../../../src/lib/runtimeGuards.js', () => ({assertProductionRuntimeConfig:vi.fn(),assertAttestedRuntimeCapabilities:state.capabilities}));
vi.mock('../../../src/lib/runtimeSchemaAttestation.js', () => ({
  attestRuntimeSchema:state.attest,
  startAttestedRuntime:async(input:{attest:()=>Promise<unknown>;start:(runtime:{descriptor:string;repositoryProfile:string})=>Promise<void>})=>{
    await input.start(await input.attest() as typeof state.proof);
  },
}));
vi.mock('../../../src/lib/cancelledGenerationSettlementRecoveryRuntime.js',()=>({createCancelledGenerationSettlementRecoveryRuntime:state.runtimeFactory}));
vi.mock('../../../src/lib/terminalGenerationNotificationRecoveryRuntime.js',()=>({createTerminalGenerationNotificationRecoveryRuntime:state.terminalFactory}));
vi.mock('../../../src/infrastructure/aws/GenerationWorkerWarmRuntime.js',()=>({resolveGenerationWorkerWarmService:state.warmResolve}));
vi.mock('../../../worker/dependencies.js',()=>({resolveWorkerDependencies:state.dependencies}));
vi.mock('../../../worker/sqsPoller.js',()=>({
  assertWarmWorkerProtectionEnabled:state.warmProtectionAssert,
  GenerationQueuePoller:class{run=state.poll;stop=state.stopPoll;},
}));
vi.mock('@aws-sdk/client-sqs',()=>({
  SQSClient:class{},SendMessageCommand:class{},ReceiveMessageCommand:class{},
  DeleteMessageBatchCommand:class{},ChangeMessageVisibilityBatchCommand:class{},
}));

beforeEach(()=>{if(typeof vi.resetModules==='function')vi.resetModules();vi.useFakeTimers();vi.clearAllMocks();state.attest.mockResolvedValue(state.proof);state.capabilities.mockReset();state.dependencies.mockReturnValue({});state.warmResolve.mockReturnValue(null);(globalThis as {__lyraWorkerAttestationHook?: (...values:unknown[])=>unknown}).__lyraWorkerAttestationHook=state.attest;});
it.each(['schema','capability'])('workerは%s拒否時にrecovery・provider・pollを開始しない',async failure=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 if(failure==='schema')state.attest.mockRejectedValueOnce(new Error('Artificial unsupported catalog'));
 else state.capabilities.mockImplementationOnce(()=>{throw new Error('048 required');});
 await importWorkerEntry(failure);await flush();
 expect(state.runtimeFactory).not.toHaveBeenCalled();expect(state.terminalFactory).not.toHaveBeenCalled();expect(state.dependencies).not.toHaveBeenCalled();expect(state.warmResolve).not.toHaveBeenCalled();expect(state.poll).not.toHaveBeenCalled();expect(state.closeDatabase).toHaveBeenCalledOnce();
});
afterEach(()=>{process.exitCode=0;vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});
afterAll(restoreBunModuleMocks);

it('実worker入口で既存recovery失敗と新周期を分離しSIGTERM後はactive cycleを待ってDBを閉じる',async()=>{
  vi.useFakeTimers();vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
  const [{PageGenerationRecoveryService},{EntityGenerationRecoveryService}]=await Promise.all([
    import('../../../src/services/page/PageGenerationRecoveryService.js'),
    import('../../../src/services/entity/EntityGenerationRecoveryService.js'),
  ]);
  vi.spyOn(PageGenerationRecoveryService.prototype,'recoverAllStaleJobs').mockImplementation(()=>state.pageRecovery());
  vi.spyOn(EntityGenerationRecoveryService.prototype,'recoverAllStaleJobs').mockImplementation(()=>state.entityRecovery());
  const signals=new Map<string,()=>void>();const originalOnce=process.once.bind(process);
  vi.spyOn(process,'once').mockImplementation((event,listener)=>{
    if(event==='SIGINT'||event==='SIGTERM'){signals.set(event,listener as ()=>void);return process;}
    return originalOnce(event,listener);
  });
  let finishPoll!:()=>void;state.poll.mockReturnValue(new Promise<void>(resolve=>{finishPoll=resolve;}));state.stopPoll.mockImplementation(()=>finishPoll());
  let finishPage!:(count:number)=>void;
  state.pageRecovery.mockRejectedValueOnce(new Error('existing recovery failure')).mockImplementation(()=>new Promise<number>(resolve=>{finishPage=resolve;}));
  state.entityRecovery.mockResolvedValue(0);state.query.mockResolvedValue({rows:[{available:false}]});
  state.cancelledRun.mockResolvedValue(undefined);state.cancelledStop.mockResolvedValue(undefined);
  state.runtimeFactory.mockResolvedValue({run:state.cancelledRun,stop:state.cancelledStop});
  state.terminalRun.mockResolvedValue(undefined);state.terminalStop.mockResolvedValue(undefined);
  state.terminalFactory.mockResolvedValue({run:state.terminalRun,stop:state.terminalStop});
  await import(/* @vite-ignore */ ['../../../scripts/runGenerationWorker.js','?cancelled-worker-drain'].join(''));
  await flush();expect(state.poll).toHaveBeenCalledOnce();expect(state.cancelledRun).toHaveBeenCalledTimes(1);
  expect(state.warmResolve).toHaveBeenCalledOnce();expect(state.warmProtectionAssert).toHaveBeenCalledWith(false,process.env);
  expect(state.terminalRun).toHaveBeenCalledTimes(1);
  expect(state.dependencies.mock.calls[0]![1]).toBe(state.proof);
  expect(state.runtimeFactory.mock.calls[0]![1]).toBe(state.proof.repositoryProfile);
  expect(state.terminalFactory.mock.calls[0]![1]).toBe(state.proof.repositoryProfile);
  vi.advanceTimersByTime(5*60*1000);await flush();
  expect(state.cancelledRun).toHaveBeenCalledTimes(2);expect(state.pageRecovery).toHaveBeenCalledTimes(2);expect(state.runtimeFactory).toHaveBeenCalledOnce();
  expect(state.terminalRun).toHaveBeenCalledTimes(2);expect(state.terminalFactory).toHaveBeenCalledOnce();
  signals.get('SIGTERM')!();await flush();expect(state.closeDatabase).not.toHaveBeenCalled();
  finishPage(0);await flush();expect(state.closeDatabase).toHaveBeenCalledOnce();
  expect(state.terminalStop).toHaveBeenCalled();
  vi.advanceTimersByTime(10*60*1000);await flush();expect(state.cancelledRun).toHaveBeenCalledTimes(2);expect(state.stopPoll).toHaveBeenCalledOnce();
});

async function flush():Promise<void>{for(let count=0;count<40;count++)await Promise.resolve();}
async function importWorkerEntry(failure:string):Promise<void>{
  if(failure==='schema'){await import(/* @vite-ignore */ ['../../../scripts/runGenerationWorker.js','?cancelled-worker-schema'].join(''));return;}
  await import(/* @vite-ignore */ ['../../../scripts/runGenerationWorker.js','?cancelled-worker-capability'].join(''));
}
async function restoreBunModuleMocks():Promise<void>{delete (globalThis as {__lyraWorkerAttestationHook?: (...values:unknown[])=>unknown}).__lyraWorkerAttestationHook;if(!('Bun' in globalThis))return;const bunTest=await import(/* @vite-ignore */ ['bun','test'].join(':')) as {mock:{restore():void}};bunTest.mock.restore();}
