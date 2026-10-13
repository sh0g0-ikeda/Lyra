import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEpisodePlanAuditCompiler } from '../../../../src/infrastructure/openai/OpenAIEpisodePlanAuditCompiler.js';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_PAGE_ID = '22222222-2222-4222-8222-222222222222';

type JsonRecord = Record<string, unknown>;

function buildAcceptedAudit(overrides: JsonRecord = {}): JsonRecord {
  return {
    accepted: true,
    issues: [],
    page_repairs: [],
    panel_repairs: [],
    ...overrides,
  };
}

function buildEmptyPanelPatch(overrides: JsonRecord = {}): JsonRecord {
  return {
    panel_role: null,
    panel_size: null,
    situation_text: null,
    composition: null,
    dialogue_in_panel: null,
    dialogue: null,
    sfx_text: null,
    background_note: null,
    panel_notes: null,
    entities: null,
    ...overrides,
  };
}

function readObject(value: unknown): JsonRecord {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as JsonRecord;
}

function readArray(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

describe('OpenAIEpisodePlanAuditCompiler', () => {
  it('通常監査は4項目だけのsource-owned応答を1回で受理する', async () => {
    const requests: JsonRecord[] = [];
    const client = {
      postJson: async (_path: string, payload: JsonRecord) => {
        requests.push(payload);
        return { body: { status: 'completed', output_text: JSON.stringify(buildAcceptedAudit()) } };
      },
    } as unknown as OpenAIClient;

    const result = await new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: '[COMPLETE ORIGINAL SOURCE WITH PAGE OWNERSHIP]\n[COMPILED EPISODE DRAFT]',
      language: 'ja',
      pageIds: [PAGE_ID],
      sourceOwnedPageContext: true,
    });

    expect(requests).toHaveLength(1);
    const schema = readObject(readObject(readObject(requests[0]?.text).format).schema);
    expect(readArray(schema.required)).toEqual([
      'accepted', 'issues', 'page_repairs', 'panel_repairs',
    ]);
    expect(Object.keys(readObject(schema.properties))).toEqual([
      'accepted', 'issues', 'page_repairs', 'panel_repairs',
    ]);
    expect(JSON.stringify(requests[0]?.input)).not.toContain('source_coverage');
    expect(JSON.stringify(requests[0]?.input)).not.toContain('issue_grounding');
    expect(JSON.stringify(requests[0]?.input)).not.toContain('source_unit_review');
    expect(result.audit).toEqual({
      accepted: true,
      issues: [],
      pageRepairs: [],
      panelRepairs: [],
    });
  });

  it('source-owned promptはcanonical原文を権威として扱いlegacy modeは従来の全文sourceを参照する', async () => {
    const requests: JsonRecord[] = [];
    const client = {
      postJson: async (_path: string, payload: JsonRecord) => {
        requests.push(payload);
        return { body: { status: 'completed', output_text: JSON.stringify(buildAcceptedAudit()) } };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIEpisodePlanAuditCompiler(client);

    await compiler.auditPlan({
      compilerBrief: 'source-owned', language: 'ja', pageIds: [PAGE_ID], sourceOwnedPageContext: true,
    });
    await compiler.auditPlan({
      compilerBrief: 'legacy', language: 'ja', pageIds: [PAGE_ID], sourceOwnedPageContext: false,
    });

    const sourceOwnedPrompt = JSON.stringify(requests[0]?.input);
    const legacyPrompt = JSON.stringify(requests[1]?.input);
    expect(sourceOwnedPrompt).toContain('COMPLETE ORIGINAL SOURCE WITH PAGE OWNERSHIP');
    expect(sourceOwnedPrompt).toContain('exact page-local original source is authoritative');
    expect(legacyPrompt).toContain('FULL STORY DRAFT - SOURCE DATA');
    expect(legacyPrompt).not.toContain('exact page-local original source is authoritative');
  });

  it('strict JSON schemaは既知page IDと監査上限を固定する', async () => {
    let request: JsonRecord | undefined;
    const client = {
      postJson: async (_path: string, payload: JsonRecord) => {
        request = payload;
        return { body: { status: 'completed', output_text: JSON.stringify(buildAcceptedAudit()) } };
      },
    } as unknown as OpenAIClient;

    await new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture', language: 'ja', pageIds: [PAGE_ID, SECOND_PAGE_ID],
    });

    const schema = readObject(readObject(readObject(request?.text).format).schema);
    const properties = readObject(schema.properties);
    const issues = readObject(properties.issues);
    const issueItem = readObject(issues.items);
    const issueProperties = readObject(issueItem.properties);
    const pageIds = readObject(issueProperties.page_ids);
    expect(readObject(pageIds.items).enum).toEqual([PAGE_ID, SECOND_PAGE_ID]);

    const panelRepairs = readObject(properties.panel_repairs);
    const panelRepairProperties = readObject(readObject(panelRepairs.items).properties);
    expect(readObject(panelRepairProperties.page_id).enum).toEqual([PAGE_ID, SECOND_PAGE_ID]);
    expect(panelRepairs.maxItems).toBeTypeOf('number');
    expect(issues.maxItems).toBeTypeOf('number');
  });

  it('field-level repairを型変換しchanged field以外を監査結果へ混ぜない', async () => {
    const client = {
      postJson: async () => ({
        body: {
          status: 'completed',
          output_text: JSON.stringify(buildAcceptedAudit({
            accepted: false,
            issues: [{
              code: 'dialogue_misplacement',
              severity: 'error',
              page_ids: [PAGE_ID],
              message: '台詞位置が早い。',
              repair_instruction: '後のコマへ移す。',
            }],
            panel_repairs: [{
              page_id: PAGE_ID,
              panel_order: 1,
              changed_fields: ['dialogue'],
              patch: buildEmptyPanelPatch({ dialogue: [] }),
            }],
          })),
        },
      }),
    } as unknown as OpenAIClient;

    const result = await new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture', language: 'ja', pageIds: [PAGE_ID],
    });

    expect(result.audit.panelRepairs).toEqual([{
      pageId: PAGE_ID,
      panelOrder: 1,
      changedFields: ['dialogue'],
      patch: { dialogue: [] },
    }]);
  });

  it('JSONまたは構造が壊れた場合だけ一度再試行する', async () => {
    const responses = ['not-json', JSON.stringify(buildAcceptedAudit())];
    let requestCount = 0;
    let beforeRetryCount = 0;
    const client = {
      postJson: async () => ({
        body: { status: 'completed', output_text: responses[requestCount++] },
      }),
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture',
      language: 'ja',
      pageIds: [PAGE_ID],
      beforeRetry: async () => { beforeRetryCount += 1; },
    })).resolves.toEqual(expect.objectContaining({ audit: expect.any(Object) }));
    expect(requestCount).toBe(2);
    expect(beforeRetryCount).toBe(1);
  });

  it('監査再試行前に停止された場合は二回目の外部APIを呼ばない', async () => {
    let requestCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return { body: { status: 'completed', output_text: 'not-json' } };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture',
      language: 'ja',
      pageIds: [PAGE_ID],
      beforeRetry: async () => { throw new Error('cancelled'); },
    })).rejects.toThrow('cancelled');
    expect(requestCount).toBe(1);
  });

  it('出力上限によるincompleteだけは完全な監査を一度再試行する', async () => {
    let requestCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return requestCount === 1
          ? { body: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }
          : { body: { status: 'completed', output_text: JSON.stringify(buildAcceptedAudit()) } };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture', language: 'ja', pageIds: [PAGE_ID],
    })).resolves.toEqual(expect.objectContaining({ audit: expect.any(Object) }));
    expect(requestCount).toBe(2);
  });

  it('refusalは再試行しない', async () => {
    let requestCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return {
          body: {
            status: 'completed',
            output: [{ content: [{ type: 'refusal', refusal: 'cannot comply' }] }],
          },
        };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture', language: 'ja', pageIds: [PAGE_ID],
    })).rejects.toThrow('refused');
    expect(requestCount).toBe(1);
  });

  it.each([
    {
      label: 'changed_fields重複',
      invalid: buildAcceptedAudit({
        panel_repairs: [{
          page_id: PAGE_ID,
          panel_order: 1,
          changed_fields: ['dialogue', 'dialogue'],
          patch: buildEmptyPanelPatch({ dialogue: [] }),
        }],
      }),
    },
    {
      label: 'changed field値欠落',
      invalid: buildAcceptedAudit({
        panel_repairs: [{
          page_id: PAGE_ID,
          panel_order: 1,
          changed_fields: ['dialogue'],
          patch: buildEmptyPanelPatch(),
        }],
      }),
    },
  ])('$labelはhard errorとして一度だけ再試行する', async ({ invalid }) => {
    let requestCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return {
          body: {
            status: 'completed',
            output_text: JSON.stringify(requestCount === 1 ? invalid : buildAcceptedAudit()),
          },
        };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture', language: 'ja', pageIds: [PAGE_ID],
    })).resolves.toEqual(expect.objectContaining({ audit: expect.any(Object) }));
    expect(requestCount).toBe(2);
  });

  it('構造不正が二回続いた場合は部分結果を返さず停止する', async () => {
    let requestCount = 0;
    const invalid = buildAcceptedAudit({
      panel_repairs: [{
        page_id: PAGE_ID,
        panel_order: 1,
        changed_fields: ['dialogue'],
        patch: buildEmptyPanelPatch(),
      }],
    });
    const client = {
      postJson: async () => {
        requestCount += 1;
        return { body: { status: 'completed', output_text: JSON.stringify(invalid) } };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture', language: 'ja', pageIds: [PAGE_ID],
    })).rejects.toThrow('invalid payload');
    expect(requestCount).toBe(2);
  });

  it('未知page IDはprovider enumに依存せずserver-side hard errorとして再試行する', async () => {
    const unknownPageId = '99999999-9999-4999-8999-999999999999';
    let requestCount = 0;
    const invalid = buildAcceptedAudit({
      accepted: false,
      issues: [{
        code: 'timeline_discontinuity',
        severity: 'error',
        page_ids: [unknownPageId],
        message: '未知ページ。',
        repair_instruction: '未知ページを修正。',
      }],
    });
    const client = {
      postJson: async () => {
        requestCount += 1;
        return {
          body: {
            status: 'completed',
            output_text: JSON.stringify(requestCount === 1 ? invalid : buildAcceptedAudit()),
          },
        };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture', language: 'ja', pageIds: [PAGE_ID],
    })).resolves.toEqual(expect.objectContaining({ audit: expect.any(Object) }));
    expect(requestCount).toBe(2);
  });

  it('旧proof項目を含む応答は4項目契約違反として受理しない', async () => {
    let requestCount = 0;
    const invalid = buildAcceptedAudit({ source_coverage: [] });
    const client = {
      postJson: async () => {
        requestCount += 1;
        return { body: { status: 'completed', output_text: JSON.stringify(invalid) } };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodePlanAuditCompiler(client).auditPlan({
      compilerBrief: 'fixture', language: 'ja', pageIds: [PAGE_ID],
    })).rejects.toThrow('Unrecognized key');
    expect(requestCount).toBe(2);
  });
});
