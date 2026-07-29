import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('push notification maintenance wiring', () => {
  it('API processは有効設定からdelivery serviceを起動し定期dispatchする', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'index.ts'), 'utf8');

    expect(source).toContain('createPushNotificationDeliveryRuntime');
    expect(source).toContain('startPushNotificationMaintenance');
    expect(source).toContain('dispatchPending');
    expect(source).toContain('PUSH_DELIVERY_INTERVAL_MS');
    expect(source).toContain('sanitizePersistedErrorMessage');
  });
});
