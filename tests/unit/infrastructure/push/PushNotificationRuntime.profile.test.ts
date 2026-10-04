import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../../src/lib/db.js';
import {
  createPushNotificationDeliveryRuntime,
  type PushNotificationEnvironment,
} from '../../../../src/infrastructure/push/PushNotificationRuntime.js';

const TEST_EC_PKCS8_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg5sFjtjMQ5QFZXvn2',
  'DA5Ji8QrQnBa5fkZYTDBTsE416WhRANCAARR5KuilPZbZbo0V4jG92Xiz1dguqLx',
  'XBo/ds016aZiXlNmrDsEYd8iq+vgqrcz/39H23yh/DaRkgNUJ/rbEZkN',
  '-----END PRIVATE KEY-----',
].join('\n');

class CapturingDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
  }
}

describe('createPushNotificationDeliveryRuntime persistence profile', () => {
  it('profile omitted runtime は canonical outbox authorization query を実行する', async () => {
    const database = new CapturingDatabase();
    const runtime = createPushNotificationDeliveryRuntime(pushEnvironment(), database);

    await runtime?.deliveryService.dispatchPending();

    const queries = database.queries.join('\n');
    expect(queries).toContain('users.account_deletion_started_at IS NULL');
    expect(queries).toContain('jobs.retry_count=outbox.generation_retry_count');
    expect(queries).not.toContain('account_deletion_requests deletion_requests');
  });

  it('legacy profile runtime は旧 outbox authorization query を実行する', async () => {
    const database = new CapturingDatabase();
    const runtime = createPushNotificationDeliveryRuntime(
      { ...pushEnvironment(), LYRA_PERSISTENCE_PROFILE: 'legacy_2debe_v1' },
      database,
    );

    await runtime?.deliveryService.dispatchPending();

    const queries = database.queries.join('\n');
    expect(queries).toContain('account_deletion_requests deletion_requests');
    expect(queries).not.toContain('users.account_deletion_started_at IS NULL');
    expect(queries).not.toContain('jobs.retry_count=outbox.generation_retry_count');
  });
});

function pushEnvironment(): PushNotificationEnvironment {
  return {
    PUSH_NOTIFICATIONS_ENABLED: true,
    PUSH_TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    PUSH_TOKEN_HASH_KEY_BASE64: Buffer.alloc(32, 11).toString('base64'),
    PUSH_TOKEN_ENCRYPTION_KEY_ID: 'push-key-v1',
    PUSH_APNS_TEAM_ID: 'TEAM123456',
    PUSH_APNS_KEY_ID: 'KEY1234567',
    PUSH_APNS_PRIVATE_KEY_BASE64: Buffer.from(TEST_EC_PKCS8_PRIVATE_KEY, 'utf8').toString('base64'),
    PUSH_APNS_BUNDLE_ID: 'jp.lyra.mobile',
    PUSH_APNS_ENVIRONMENT: 'production' as const,
    PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({
      project_id: 'lyra-production',
      client_email: 'firebase-admin@lyra-production.iam.gserviceaccount.com',
      private_key: TEST_EC_PKCS8_PRIVATE_KEY,
    })).toString('base64'),
  };
}
