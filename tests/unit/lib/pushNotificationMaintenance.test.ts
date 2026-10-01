import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {startPushNotificationMaintenance} from '../../../src/lib/pushNotificationMaintenance.js';
const stops: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('bounded push maintenance',()=>{
 it('disabled runtime schedules no provider work',()=>{startPushNotificationMaintenance(null)();expect(vi.getTimerCount()).toBe(0);});
 it('never overlaps a slow dispatch and stops future work',async()=>{let resolve!:(x:{claimed:number;sent:number;retried:number;dead:number;stale:number})=>void;const dispatchPending=vi.fn(()=>new Promise<{claimed:number;sent:number;retried:number;dead:number;stale:number}>(r=>{resolve=r;}));const stop=startPushNotificationMaintenance({deliveryService:{dispatchPending},intervalMs:5000});stops.push(stop);await advance(15000);expect(dispatchPending).toHaveBeenCalledTimes(1);resolve({claimed:0,sent:0,retried:0,dead:0,stale:0});await Promise.resolve();await advance(5000);expect(dispatchPending).toHaveBeenCalledTimes(2);stop();resolve({claimed:0,sent:0,retried:0,dead:0,stale:0});await advance(15000);expect(dispatchPending).toHaveBeenCalledTimes(2);});
 it('does not log raw provider failures and can retry on the next interval',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});const dispatchPending=vi.fn().mockRejectedValue(new Error('private-device-token'));const stop=startPushNotificationMaintenance({deliveryService:{dispatchPending},intervalMs:5000});stops.push(stop);await Promise.resolve();await advance(5000);stop();expect(dispatchPending).toHaveBeenCalledTimes(2);expect(JSON.stringify(log.mock.calls)).not.toContain('private-device-token');});
});

async function advance(milliseconds: number): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
  vi.advanceTimersByTime(milliseconds);
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
