import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { PageStaleError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';
import type { AtomicSaveAndGenerateInput } from '../../../src/services/page/PageSaveAndGenerate.js';

class TransactionCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public valueHistory: Array<readonly unknown[] | undefined> = [];
  public committed = false;
  public rolledBack = false;
  public stale = false;
  public idempotent = false;

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    try {
      const result = await work(this);
      this.committed = true;
      return result;
    } catch (error) {
      this.rolledBack = true;
      throw error;
    }
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valueHistory.push(values);
    const rows: QueryResultRow[] = [];
    if (text.includes('SELECT pages.id')) {
      rows.push({
        id: '11111111-1111-4111-8111-111111111111',
        work_id: '22222222-2222-4222-8222-222222222222',
        organization_id: null,
        status: 'designing',
        generation_mode: null,
        generated_image: null,
        updated_at: new Date(this.stale ? '2026-07-24T00:00:01.000Z' : '2026-07-24T00:00:00.000Z'),
      });
    } else if (text.includes('SELECT id, params') && text.includes('save_and_generate_request_id')) {
      if (this.idempotent) {
        rows.push({
          id: '44444444-4444-4444-8444-444444444444',
          params: { page_revision: '2026-07-24T00:00:02.000Z' },
        });
      }
    } else if (text.includes('SELECT id FROM panels')) {
      rows.push({ id: '33333333-3333-4333-8333-333333333333' });
    } else if (text.includes('COUNT(*)::text AS count')) {
      rows.push({ count: '0' });
    } else if (text.includes('UPDATE pages') && text.includes("status = 'generating'")) {
      rows.push({ updated_at: new Date('2026-07-24T00:00:00.000Z') });
    } else if (text.includes('INSERT INTO generation_jobs')) {
      rows.push({ id: '44444444-4444-4444-8444-444444444444' });
    } else if (text.includes('SELECT monthly_credits')) {
      rows.push({ monthly_credits: 0, purchased_credits: 10, monthly_expires_at: null });
    }
    return {
      command: 'SELECT',
      rowCount: rows.length === 0 ? 1 : rows.length,
      oid: 0,
      fields: [],
      rows: rows as T[],
    };
  }
}

describe('PostgresPageRepository save and generate', () => {
  it('stale revision の場合は transaction を rollback し page/panel/job/credit を変更しない', async () => {
    const client = new TransactionCapturingClient();
    client.stale = true;
    const repository = new PostgresPageRepository(client);

    await expect(repository.saveAndCreateGenerationJob(buildInput())).rejects.toBeInstanceOf(PageStaleError);

    expect(client.rolledBack).toBe(true);
    expect(client.committed).toBe(false);
    expect(client.queries).toHaveLength(2);
    expect(client.queries.join('\n')).not.toContain('UPDATE panels');
    expect(client.queries.join('\n')).not.toContain('INSERT INTO generation_jobs');
    expect(client.queries.join('\n')).not.toContain('credit_ledger');
  });

  it('current revision の場合は page/panels/frames/job/credit ledger を一つの transaction に保存する', async () => {
    const client = new TransactionCapturingClient();
    const repository = new PostgresPageRepository(client);

    const result = await repository.saveAndCreateGenerationJob(buildInput());

    expect(result).toEqual({
      jobId: '44444444-4444-4444-8444-444444444444',
      pageRevision: '2026-07-24T00:00:00.000Z',
      created: true,
    });
    expect(client.committed).toBe(true);
    const sql = client.queries.join('\n');
    expect(sql).toContain('UPDATE panels SET "order" = -"order"');
    expect(sql).toContain('DELETE FROM panel_frames');
    expect(sql).toContain("status = 'generating'");
    expect(sql).toContain('INSERT INTO generation_jobs');
    expect(sql).toContain('INSERT INTO credit_ledger');
    const pageUpdateIndex = client.queries.findIndex((query) => query.includes("status = 'generating'"));
    expect(client.queries[pageUpdateIndex]).toContain('story_source_scene_ids');
    expect(client.valueHistory[pageUpdateIndex]).toEqual(expect.arrayContaining([
      true,
      ['scene-1'],
      true,
      'Saved purpose',
      true,
      'Saved continuity',
    ]));
  });

  it('同じ page revision と request id の再試行では保存と課金を繰り返さない', async () => {
    const client = new TransactionCapturingClient();
    client.idempotent = true;
    const repository = new PostgresPageRepository(client);

    await expect(repository.saveAndCreateGenerationJob(buildInput())).resolves.toEqual({
      jobId: '44444444-4444-4444-8444-444444444444',
      pageRevision: '2026-07-24T00:00:02.000Z',
      created: false,
    });

    expect(client.committed).toBe(true);
    const sql = client.queries.join('\n');
    expect(sql).not.toContain('UPDATE panels');
    expect(sql).not.toContain('INSERT INTO generation_jobs');
    expect(sql).not.toContain('INSERT INTO credit_ledger');
  });
});

function buildInput(): AtomicSaveAndGenerateInput {
  return {
    pageId: '11111111-1111-4111-8111-111111111111',
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organizationId: null,
    expectedUpdatedAt: '2026-07-24T00:00:00.000Z',
    page: {
      storySourceSceneIds: ['scene-1'],
      storyPagePurpose: 'Saved purpose',
      storyContinuityNote: 'Saved continuity',
    },
    panels: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        order: 1,
        panelRole: 'action',
        panelSize: 'standard',
        situationText: null,
        composition: {
          source: 'custom',
          galleryItemId: null,
          compositionPrompt: null,
          shotType: null,
          angle: null,
          customNote: null,
        },
        dialogueInPanel: true,
        dialogue: [],
        sfxText: null,
        backgroundNote: null,
        panelNotes: null,
        entities: [],
      },
    ],
    frames: [
      {
        panelId: '33333333-3333-4333-8333-333333333333',
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        borderStyle: 'solid',
        borderWidth: 3,
        borderColor: '#000000',
        zIndex: 1,
        readingOrder: 1,
      },
    ],
    language: 'ja',
    requestId: 'mobile-request-001',
    layoutConfig: { type: 'custom', panel_count: 1 },
    selection: {
      requestKind: 'initial',
      mode: 'standard',
      quality: 'medium',
      creditCost: 3,
      billableReferenceCount: 0,
      requiresPlanner: false,
    },
    inputSnapshot: {
      pageId: '11111111-1111-4111-8111-111111111111',
      requestKind: 'initial',
      generationMode: 'standard',
      panelCount: 1,
      panels: [],
    },
    capacityLimits: { perUser: 2, global: 10 },
  };
}
