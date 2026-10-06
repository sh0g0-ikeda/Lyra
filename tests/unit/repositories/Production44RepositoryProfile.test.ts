import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEntityRepository } from '../../../src/repositories/EntityRepository.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';
import { PostgresSceneRepository } from '../../../src/repositories/SceneRepository.js';
import { PostgresStoryRepository } from '../../../src/repositories/StoryRepository.js';
import { PostgresBillingRepository } from '../../../src/repositories/BillingRepository.js';
import { enqueueTerminalGenerationJobNotificationAfterRegistryLock } from '../../../src/repositories/PushNotificationOutboxRepository.js';
import { ConfigurationError } from '../../../src/domain/errors/index.js';

const profile = 'production44_pg18_v1';
const id = '11111111-1111-4111-8111-111111111111';
class Client implements DatabaseClient, TransactionRunner {
  readonly queries: string[] = [];
  async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> { return work(this); }
  async query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
    this.queries.push(sql); return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
  }
}
describe('実44の物理構造と処理所有を別々に選択する', () => {
  it('expanded52は物理page metadataと新state/starting列を同時に選択する', async () => {
    const client = new Client();
    const expanded = 'production44_expanded_pg18_v1';
    await new PostgresPageRepository(client, expanded).findPageByIdAndUserId(id, id);
    expect(client.queries.pop()).toContain('pages.story_page_purpose');
    await new PostgresPageRepository(client, expanded).findEpisodePlanningContextByIdAndUserId(id, id);
    expect(client.queries.join('\n')).toContain('episodes.starting_entity_states');
    expect(client.queries.join('\n')).toContain('entity_states.name');
    client.queries.length = 0;
    await new PostgresSceneRepository(client, expanded).findEntityStatesByEntityIdAndUserId(id, id);
    expect(client.queries.join('\n')).toContain('entity_states.reference_image');
    await expect(new PostgresStoryRepository(client,client,expanded).updateEpisode(id,id,{startingEntityStates:[]})).resolves.toBeNull();
    expect(client.queries.at(-1)).toContain('FOR UPDATE OF episodes');
    await enqueueTerminalGenerationJobNotificationAfterRegistryLock(client, { id, user_id:id, organization_id:null, cancel_requested_at:null, cancelled_at:null, retry_count:1 },'completed',expanded);
    expect(client.queries.join('\n')).toContain('INSERT INTO mobile_push_notification_outbox');
    await new PostgresBillingRepository(client,client,expanded).findBillingUserProfile(id);
    expect(client.queries.at(-1)).toContain('account_deletion_started_at');
  });
  it('pageは物理story metadataを読みentity/stateは存在しないvariant列を参照しない', async () => {
    const client = new Client();
    await new PostgresPageRepository(client, profile).findPageByIdAndUserId(id, id);
    expect(client.queries.pop()).toContain('pages.story_page_purpose');
    await new PostgresPageRepository(client, profile).findEpisodePlanningContextByIdAndUserId(id, id);
    expect(client.queries.join('\n')).not.toMatch(/episodes\.starting_entity_states|entity_states\.(name|description|reference_image)/u);
    client.queries.length = 0;
    await new PostgresEntityRepository(client, profile).findResolvedReferenceImagesByAssignmentsAndUserId([{ entityId: id, stateId: id }], id, id);
    await new PostgresSceneRepository(client, profile).findEntityStatesByEntityIdAndUserId(id, id);
    expect(client.queries.join('\n')).not.toMatch(/entity_states\.(name|description|reference_image)|state_reference_copy_attempts/u);
  });
  it('starting statesの変更と検証はSQL前に拒否する', async () => {
    const client = new Client();
    const repository = new PostgresStoryRepository(client, client, profile);
    await expect(repository.updateEpisode(id, id, { startingEntityStates: [] })).rejects.toBeInstanceOf(ConfigurationError);
    await expect(repository.validateEpisodeStartingEntityStates(id, id, [])).resolves.toBe(false);
    expect(client.queries).toHaveLength(0);
  });
  it('pushのapplication挿入と接続済み削除timestampを使い旧38所有枝に入らない', async () => {
    const client = new Client();
    await enqueueTerminalGenerationJobNotificationAfterRegistryLock(client, { id, user_id: id, organization_id: null, cancel_requested_at: null, cancelled_at: null, retry_count: 1 }, 'completed', profile);
    expect(client.queries[0]).toContain('INSERT INTO mobile_push_notification_outbox');
    expect(client.queries[0]).toContain('generation_retry_count');
    await new PostgresBillingRepository(client, client, profile).findBillingUserProfile(id);
    expect(client.queries.at(-1)).toContain('account_deletion_started_at');
    expect(client.queries.at(-1)).not.toContain('NULL::timestamptz');
  });
});
