import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createAccountDeletionRecoveryRuntime,startAccountDeletionRecovery} from '../../../../src/infrastructure/account/AccountDeletionRuntime.js';
import {env} from '../../../../src/lib/env.js';
const stops: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('account deletion recovery in existing API runtime',()=>{
 it('default OFF neither reads private tables nor creates requests',()=>{const database={query:vi.fn(),transaction:vi.fn()};expect(createAccountDeletionRecoveryRuntime({...env,ACCOUNT_DELETION_ENABLED:false},database)).toBeNull();expect(database.query).not.toHaveBeenCalled();expect(database.transaction).not.toHaveBeenCalled();});
 it('only resumes existing requests, never overlaps, and honors shutdown',async()=>{let resolve!:(x:{attemptedCount:number;completedCount:number})=>void;const recoverPendingRequests=vi.fn(()=>new Promise<{attemptedCount:number;completedCount:number}>(r=>{resolve=r;}));const stop=startAccountDeletionRecovery({service:{recoverPendingRequests},batchSize:3,intervalMs:5000});stops.push(stop);await advance(15000);expect(recoverPendingRequests).toHaveBeenCalledTimes(1);expect(recoverPendingRequests).toHaveBeenCalledWith(3);resolve({attemptedCount:0,completedCount:0});await Promise.resolve();await advance(5000);expect(recoverPendingRequests).toHaveBeenCalledTimes(2);stop();resolve({attemptedCount:0,completedCount:0});await advance(15000);expect(recoverPendingRequests).toHaveBeenCalledTimes(2);});
 it('stop awaits active recovery and is idempotent',async()=>{let resolve!:(v:{attemptedCount:number;completedCount:number})=>void;const service={recoverPendingRequests:vi.fn(()=>new Promise<{attemptedCount:number;completedCount:number}>(r=>resolve=r))};const stop=startAccountDeletionRecovery({service,batchSize:1,intervalMs:5000});await advance(5000);const first=stop();const second=stop();let done=false;void first.then(()=>done=true);await Promise.resolve();expect(done).toBe(false);expect(service.recoverPendingRequests).toHaveBeenCalledTimes(1);resolve({attemptedCount:0,completedCount:0});await Promise.all([first,second]);expect(done).toBe(true);});
 it('does not expose provider identifiers or secret-bearing errors',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});const stop=startAccountDeletionRecovery({service:{recoverPendingRequests:vi.fn().mockRejectedValue(new Error('private-identity-secret'))},batchSize:1,intervalMs:5000});stops.push(stop);await Promise.resolve();stop();expect(JSON.stringify(log.mock.calls)).not.toContain('private-identity-secret');});
});

async function advance(milliseconds: number): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
  vi.advanceTimersByTime(milliseconds);
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
