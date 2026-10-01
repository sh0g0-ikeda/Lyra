import { describe, expect, it } from 'vitest';
import type { CurrentSessionRecord } from '@/domain/types';
import { canRegisterPushNotifications } from '@/domain/pushCapability';
const session: CurrentSessionRecord = {user:{id:'user',email:'user@example.invalid',display_name:null,plan_code:'free'},personal_credits:null,organizations:[]};
describe('push runtime capability', () => {
  it('旧レスポンスや無効能力では通知許可を新たに要求しない', () => {
    expect(canRegisterPushNotifications(undefined)).toBe(false);
    expect(canRegisterPushNotifications(session)).toBe(false);
    expect(canRegisterPushNotifications({...session,capabilities:{entity_state_reference_generation:false,episode_state_autofill_v1:false,push_notifications:false}})).toBe(false);
  });
  it('登録runtimeが有効な時は既存の通知と端末許可フローを利用できる', () => {
    expect(canRegisterPushNotifications({...session,capabilities:{entity_state_reference_generation:false,episode_state_autofill_v1:false,push_notifications:true}})).toBe(true);
  });
});
