import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  attest:vi.fn(),capabilities:vi.fn(),dependencies:vi.fn(),
  proof:Object.freeze({descriptor:'production44_expanded_pg18_v1',repositoryProfile:'production44_expanded_pg18_v1',capabilities:Object.freeze({entityStateMonotonicRevision:true})}),
  closeDatabase: vi.fn(), query: vi.fn(), pageRecovery: vi.fn(), entityRecovery: vi.fn(),
  cancelledRun: vi.fn(), cancelledStop: vi.fn(), runtimeFactory: vi.fn(),
  terminalRun:vi.fn(),terminalStop:vi.fn(),terminalFactory:vi.fn(),
  poll: vi.fn(), stopPoll: vi.fn(),
}));
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
vi.mock('../../../worker/dependencies.js',()=>({resolveWorkerDependencies:state.dependencies}));
vi.mock('../../../worker/sqsPoller.js',()=>({GenerationQueuePoller:class{run=state.poll;stop=state.stopPoll;}}));
vi.mock('../../../src/services/page/PageGenerationRecoveryService.js',()=>({PageGenerationRecoveryService:class{recoverAllStaleJobs=state.pageRecovery;}}));
vi.mock('../../../src/services/entity/EntityGenerationRecoveryService.js',()=>({EntityGenerationRecoveryService:class{recoverAllStaleJobs=state.entityRecovery;}}));
vi.mock('@aws-sdk/client-sqs',()=>({SQSClient:class{}}));

beforeEach(()=>{vi.resetModules();vi.clearAllMocks();state.attest.mockResolvedValue(state.proof);state.capabilities.mockReset();state.dependencies.mockReturnValue({});});
it.each(['schema','capability'])('workerは%s拒否時にrecovery・provider・pollを開始しない',async failure=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 if(failure==='schema')state.attest.mockRejectedValueOnce(new Error('Artificial unsupported catalog'));
 else state.capabilities.mockImplementationOnce(()=>{throw new Error('048 required');});
 await import('../../../scripts/runGenerationWorker.js');await flush();
 expect(state.runtimeFactory).not.toHaveBeenCalled();expect(state.terminalFactory).not.toHaveBeenCalled();expect(state.dependencies).not.toHaveBeenCalled();expect(state.poll).not.toHaveBeenCalled();expect(state.closeDatabase).toHaveBeenCalledOnce();
});
afterEach(()=>{process.exitCode=0;vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});

it('実worker入口で既存recovery失敗と新周期を分離しSIGTERM後はactive cycleを待ってDBを閉じる',async()=>{
  vi.useFakeTimers();vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
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
  await import('../../../scripts/runGenerationWorker.js');
  await flush();expect(state.poll).toHaveBeenCalledOnce();expect(state.cancelledRun).toHaveBeenCalledTimes(1);
  expect(state.terminalRun).toHaveBeenCalledTimes(1);
  expect(state.dependencies.mock.calls[0]![1]).toBe(state.proof);
  expect(state.runtimeFactory.mock.calls[0]![1]).toBe(state.proof.repositoryProfile);
  expect(state.terminalFactory.mock.calls[0]![1]).toBe(state.proof.repositoryProfile);
  await vi.advanceTimersByTimeAsync(5*60*1000);
  expect(state.cancelledRun).toHaveBeenCalledTimes(2);expect(state.pageRecovery).toHaveBeenCalledTimes(2);expect(state.runtimeFactory).toHaveBeenCalledOnce();
  expect(state.terminalRun).toHaveBeenCalledTimes(2);expect(state.terminalFactory).toHaveBeenCalledOnce();
  signals.get('SIGTERM')!();await flush();expect(state.closeDatabase).not.toHaveBeenCalled();
  finishPage(0);await flush();expect(state.closeDatabase).toHaveBeenCalledOnce();
  expect(state.terminalStop).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10*60*1000);expect(state.cancelledRun).toHaveBeenCalledTimes(2);expect(state.stopPoll).toHaveBeenCalledOnce();
});

async function flush():Promise<void>{for(let count=0;count<40;count++)await Promise.resolve();}
