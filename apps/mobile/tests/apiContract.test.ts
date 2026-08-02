import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';

import type { AtomicSaveAndGeneratePayload } from '@/domain/pageAtomicGeneration';
import { LyraMobileApiClient } from '@/lib/api';
import { setOperationalEventSinks } from '@/lib/operationalEvents';
import { exportJobQueryKey } from '@/lib/queryKeys';

const exportJobResponse = {
  job_id: 'export-job-1',
  status: 'completed',
  progress: { stage: 'completed', percent: 100 },
  error: null,
  created_at: '2026-07-25T00:00:00.000Z',
  started_at: '2026-07-25T00:01:00.000Z',
  expires_at: '2026-07-25T01:00:00.000Z',
  completed_at: '2026-07-25T00:30:00.000Z',
  download_ready: true
} as const;

describe('LyraMobileApiClient API contract', () => {
  it('organization safety reportは認証付きの固定payloadを202で受領する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          report_id: '22222222-2222-4222-8222-222222222222',
          status: 'received'
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 202 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.submitOrganizationSafetyReport(
        '11111111-1111-4111-8111-111111111111',
        'workspace_content'
      )
    ).resolves.toEqual({
      report_id: '22222222-2222-4222-8222-222222222222',
      status: 'received'
    });

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toContain('/api/organization-safety-reports');
    expect(new Headers(request?.[1]?.headers).get('Authorization')).toBe('Bearer token');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      organization_id: '11111111-1111-4111-8111-111111111111',
      target_kind: 'workspace_content',
      reason: 'unsafe_or_inappropriate'
    });
  });

  it('organization safety reportは202以外の成功statusを受領として扱わない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            report_id: '22222222-2222-4222-8222-222222222222',
            status: 'received'
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 }
        )
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.submitOrganizationSafetyReport(
        '11111111-1111-4111-8111-111111111111',
        'member'
      )
    ).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });

  it('AI内容の通報は更新後のBearer tokenと固定payloadだけを送る', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            report_id: '11111111-1111-4111-8111-111111111111',
            status: 'received'
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 202 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockResolvedValue('refreshed-token');
    const client = new LyraMobileApiClient(() => 'expired-token', refresh);

    await expect(
      client.submitAiContentReport(
        'generated_image',
        '11111111-1111-4111-8111-111111111111'
      )
    ).resolves.toEqual({
      report_id: '11111111-1111-4111-8111-111111111111',
      status: 'received'
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedRequest = fetchMock.mock.calls[1];
    expect(retriedRequest?.[0]).toContain('/api/ai-content-reports');
    expect(retriedRequest?.[1]).toMatchObject({ method: 'POST' });
    expect(new Headers(retriedRequest?.[1]?.headers).get('Authorization')).toBe('Bearer refreshed-token');
    expect(JSON.parse(String(retriedRequest?.[1]?.body))).toEqual({
      content_kind: 'generated_image',
      content_id: '11111111-1111-4111-8111-111111111111',
      reason: 'unsafe_or_inappropriate'
    });
  });

  it('AI内容の通報で不正な応答を成功として扱わない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            report_id: 'not-a-uuid',
            status: 'accepted'
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 202 }
        )
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.submitAiContentReport('story_proposal')).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });

  it('AI内容の通報は202以外の成功statusを受領として扱わない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            report_id: '11111111-1111-4111-8111-111111111111',
            status: 'received'
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 }
        )
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.submitAiContentReport('story_proposal')).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });

  it('429のRetry-After秒数を復旧用ApiErrorへ保持する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: 'raw backend detail'
            }
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '42'
            },
            status: 429
          }
        )
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getCurrentSession()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 42,
      status: 429
    });
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    setOperationalEventSinks(null);
    vi.unstubAllGlobals();
  });

  it('オフラインの書き込みは送信せずユーザー再試行が必要なエラーにする', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onlineManager.setOnline(false);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.deleteScene('scene-1')).rejects.toMatchObject({
      code: 'NETWORK_OFFLINE',
      status: 0
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('作品一覧の応答形式が壊れている場合に安全な契約エラーになる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ works: [{ id: 42 }] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getWorks()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });

  it('API errorはBackendのopaque request IDをsupport情報として保持する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'FORBIDDEN',
              message: 'Operation is not permitted'
            }
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': '11111111-1111-4111-8111-111111111111'
            },
            status: 403
          }
        )
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getWorks()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      requestId: '11111111-1111-4111-8111-111111111111',
      status: 403
    });
  });

  it('refresh後も401の場合だけPIIなしのauth failure metricを記録する', async () => {
    const metric = vi.fn();
    setOperationalEventSinks({
      exception: vi.fn(),
      metric
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required'
            }
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': '11111111-1111-4111-8111-111111111111'
            },
            status: 401
          }
        )
      )
    );
    const refresh = vi.fn().mockResolvedValue('refreshed-token');
    const client = new LyraMobileApiClient(() => 'expired-token', refresh);

    await expect(client.getWorks()).rejects.toMatchObject({ status: 401 });
    expect(refresh).toHaveBeenCalledOnce();
    expect(metric).toHaveBeenCalledOnce();
    expect(metric).toHaveBeenCalledWith({
      name: 'auth_failure',
      requestId: '11111111-1111-4111-8111-111111111111',
      status: 401
    });
  });

  it('ページ骨格のqueue応答でStoryAI適用状態を保持する', async () => {
    const responseBody = {
      job_id: 'job-1',
      queued: true,
      story_plan_applied: true
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          headers: { 'Content-Type': 'application/json' },
          status: 202
        })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.generatePageSkeleton('episode-1', {
        overwrite_existing: true,
        apply_story_plan: true,
        language: 'ja'
      })
    ).resolves.toEqual(responseBody);
  });

  it('ページ骨格の同期応答で置換とStoryAI job情報を保持する', async () => {
    const responseBody = {
      pages_created: 8,
      panels_created: 32,
      replaced_existing: true,
      story_plan_applied: true,
      story_plan_job_id: 'job-2'
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          headers: { 'Content-Type': 'application/json' },
          status: 201
        })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.generatePageSkeleton('episode-1', {
        overwrite_existing: true,
        apply_story_plan: true,
        language: 'ja'
      })
    ).resolves.toEqual(responseBody);
  });

  it('StoryAI SSEの不正なdone envelopeを契約エラーにする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          [
            'event: chunk',
            'data: {"text":"first"}',
            '',
            'event: done',
            'data: {"unexpected":true}',
            '',
            ''
          ].join('\n'),
          {
            headers: { 'Content-Type': 'text/event-stream' },
            status: 200
          }
        )
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.streamStoryCollaboration(
        {
          layer: 'episode',
          target_id: 'episode-1',
          instruction: 'Improve',
          language: 'en',
          context: {}
        },
        { onMessage: vi.fn() }
      )
    ).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });

  it('StoryAI相談は選択言語と法人スコープをSSE requestに送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('event: done\ndata: {}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await client.streamStoryCollaboration(
      {
        layer: 'episode',
        target_id: 'episode-1',
        instruction: 'Keep the pacing concise.',
        language: 'en',
        context: {
          current_draft: 'Current draft',
          focus_points: [],
          constraints: []
        }
      },
      { onMessage: vi.fn() },
      'organization-1'
    );

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/story/collaborate?organization_id=organization-1');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      language: 'en',
      layer: 'episode',
      target_id: 'episode-1'
    });
  });

  it('401の場合はトークン更新を待って新しいトークンで一度だけ再送する', async () => {
    let token = 'expired-token';
    const refresh = vi.fn(async () => {
      token = 'fresh-token';
      return token;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ works: [] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => token, refresh);

    await expect(client.getWorks()).resolves.toEqual({ works: [] });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer expired-token');
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer fresh-token');
  });

  it('401の再送後も失敗する場合は再更新しない', async () => {
    const refresh = vi.fn().mockResolvedValue('fresh-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'expired-token', refresh);

    await expect(client.getWorks()).rejects.toMatchObject({ status: 401 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('シーン削除は法人スコープを付けたDELETEを送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.deleteScene('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/api/scenes/11111111-1111-4111-8111-111111111111?organization_id=22222222-2222-4222-8222-222222222222'
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('push token登録・削除は秘密値をresponseへ残さない認証APIを使う', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'registered',
            installation_id: '11111111-1111-4111-8111-111111111111',
            platform: 'ios'
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.registerPushToken({
        installation_id: '11111111-1111-4111-8111-111111111111',
        platform: 'ios',
        device_token: 'native-device-token-1234567890'
      })
    ).resolves.toEqual({
      status: 'registered',
      installation_id: '11111111-1111-4111-8111-111111111111',
      platform: 'ios'
    });
    await expect(
      client.removePushToken('11111111-1111-4111-8111-111111111111')
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/push-tokens');
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      '/api/push-tokens/11111111-1111-4111-8111-111111111111'
    );
  });

  it('entity state一覧は法人スコープ付きの検証済みGETを送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entity_states: [
            {
              id: 'state-1',
              entity_id: 'entity-1',
              scene_id: null,
              costume_note: 'uniform',
              costume_ref_id: null,
              condition_note: null,
              hair_note: null,
              expression_default: 'neutral',
              extra_note: null,
              created_at: '2026-07-24T00:00:00.000Z'
            }
          ]
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getEntityStates('entity-1', 'organization-1')).resolves.toMatchObject({
      entity_states: [{ id: 'state-1', entity_id: 'entity-1' }]
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/entities/entity-1/states?organization_id=organization-1');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: undefined });
  });

  it('ページ生成readinessは法人スコープ付きでstable blockerを検証する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ready: false,
          blockers: [
            {
              code: 'CHARACTER_REFERENCE_REQUIRED',
              entity_id: 'entity-1',
              field: 'entities',
              action: 'open_characters',
              message_key: 'page.blocker.characterReference'
            }
          ],
          warnings: [],
          estimated_credit_cost: 3,
          page_revision: '2026-07-24T00:00:00.000Z'
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.getPageGenerationReadiness('page-1', 'organization-1')
    ).resolves.toMatchObject({
      ready: false,
      blockers: [{ code: 'CHARACTER_REFERENCE_REQUIRED', action: 'open_characters' }],
      estimated_credit_cost: 3
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/api/pages/page-1/generation-readiness?organization_id=organization-1'
    );
  });

  it('シーンからのページ反映は選択言語と法人スコープを付け、検証済みの結果だけを返す', async () => {
    const responseBody = {
      updated_panel_count: 2,
      filled_field_count: 7,
      compiler_used: true,
      compiler_provider: 'openai',
      compiler_model: 'gpt-5.4-mini',
      compiler_prompt_version: 'page-autofill-v1',
      compiler_error: null
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.autofillPageFromScenes('page-1', 'en', 'organization-1')
    ).resolves.toEqual(responseBody);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/api/pages/page-1/autofill-from-scenes?organization_id=organization-1'
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ language: 'en' });
  });

  it('保存して生成は全入力を単一POSTと冪等キーで送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          job_id: 'job-1',
          page_revision: '2026-07-24T00:01:00.000Z'
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 202 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');
    const payload: AtomicSaveAndGeneratePayload = {
      expected_updated_at: '2026-07-24T00:00:00.000Z',
      page: {
        dialogue_mode: 'image_baked',
        page_dialogue_toggle: true,
        story_source_scene_ids: [],
        story_page_purpose: null,
        story_continuity_note: null
      },
      panels: [
        {
          id: 'panel-1',
          order: 1,
          panel_role: 'action',
          panel_size: 'standard',
          situation_text: null,
          entities: [],
          composition: {
            source: 'ai_auto',
            gallery_item_id: null,
            composition_prompt: null,
            shot_type: null,
            angle: null,
            custom_note: null
          },
          dialogue_in_panel: true,
          dialogue: [],
          sfx_text: null,
          background_note: null,
          panel_notes: null
        }
      ],
      frames: [
        {
          panel_id: 'panel-1',
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
          ],
          border_style: 'solid',
          border_width: 3,
          border_color: '#000000',
          z_index: 1,
          reading_order: 1
        }
      ],
      generation: { language: 'ja' }
    };

    await expect(
      client.saveAndGeneratePage(
        'page-1',
        payload,
        'mobile-page-20260724-000001',
        'organization-1'
      )
    ).resolves.toEqual({
      job_id: 'job-1',
      page_revision: '2026-07-24T00:01:00.000Z'
    });

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toContain(
      '/api/pages/page-1/save-and-generate?organization_id=organization-1'
    );
    expect(request?.[1]).toMatchObject({ method: 'POST' });
    expect(new Headers(request?.[1]?.headers).get('Idempotency-Key')).toBe(
      'mobile-page-20260724-000001'
    );
    expect(JSON.parse(String(request?.[1]?.body))).toEqual(payload);
  });

  it('共通コマ割りテンプレートのgeometryをruntime検証する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          templates: [
            {
              id: 'standard_4',
              label_key: 'page.layoutTemplate.standard_4',
              panel_count: 4,
              reading_direction: 'right_to_left_top_to_bottom',
              preview_aspect_ratio: 0.7,
              supported_page_sizes: ['normalized_portrait'],
              frames: [
                {
                  vertices: [
                    { x: 0.5, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 0.5 },
                    { x: 0.5, y: 0.5 }
                  ],
                  border_style: 'solid',
                  border_width: 3,
                  border_color: '#000000',
                  z_index: 1,
                  reading_order: 1
                }
              ]
            }
          ]
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getPageLayoutTemplates()).resolves.toMatchObject({
      templates: [{ id: 'standard_4', panel_count: 4 }]
    });
  });

  it('参照画像のpresignとtoken解析をorganization scope付きで実行する', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            upload_url: 'https://uploads.example.test/entity-reference?signature=opaque',
            upload_token: 'opaque-upload-token',
            expires_at: '2026-07-25T00:05:00.000Z',
            upload_headers: {
              'Content-Type': 'image/png',
              'x-amz-server-side-encryption': 'AES256'
            }
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            suggested_fields: {},
            prompt_supplement: '',
            tmp_image_token: 'candidate-token'
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.createEntityReferenceUpload(
        { entity_id: 'entity-1', mime_type: 'image/png', size_bytes: 1024 },
        'organization-1'
      )
    ).resolves.toMatchObject({ upload_token: 'opaque-upload-token' });
    await expect(
      client.importEntityImage(
        { entity_id: 'entity-1', entity_type: 'character', upload_token: 'opaque-upload-token' },
        'organization-1'
      )
    ).resolves.toMatchObject({ tmp_image_token: 'candidate-token' });

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/api/uploads/entity-reference/presign?organization_id=organization-1'
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      entity_id: 'entity-1',
      mime_type: 'image/png',
      size_bytes: 1024
    });
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      '/api/entities/import-image?organization_id=organization-1'
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      entity_id: 'entity-1',
      entity_type: 'character',
      upload_token: 'opaque-upload-token'
    });
  });

  it('episode export sends organization scope and Idempotency-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ job_id: 'export-job-1', status: 'queued' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 202
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.createEpisodeExport(
        'episode-1',
        { format: 'pdf', page_ids: ['page-1', 'page-2'], filename: 'chapter-one.pdf' },
        'export-20260725-000001',
        'organization-1'
      )
    ).resolves.toEqual({ job_id: 'export-job-1', status: 'queued' });

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toContain('/api/episodes/episode-1/exports?organization_id=organization-1');
    expect(request?.[1]).toMatchObject({ method: 'POST' });
    expect(new Headers(request?.[1]?.headers).get('Idempotency-Key')).toBe('export-20260725-000001');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      format: 'pdf',
      page_ids: ['page-1', 'page-2'],
      filename: 'chapter-one.pdf'
    });
  });

  it('export status accepts the canonical download-ready response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(exportJobResponse), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getExportJob('export-job-1', 'organization-1')).resolves.toEqual(exportJobResponse);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/exports/export-job-1?organization_id=organization-1');

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...exportJobResponse,
          status: 'processing',
          progress: { stage: 'building', percent: 50 },
          completed_at: null,
          download_ready: false
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    );
    await expect(client.getExportJob('export-job-1')).resolves.toMatchObject({
      status: 'processing',
      progress: { stage: 'building', percent: 50 },
      download_ready: false
    });
  });

  it('export status strips raw provider errors and separates personal and organization cache keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...exportJobResponse,
          status: 'failed',
          progress: { stage: 'failed', percent: 0 },
          completed_at: null,
          download_ready: false,
          error: { code: 'EXPORT_FAILED', message: 'Export failed.' },
          error_message: 'provider credential secret must not reach the UI'
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getExportJob('export-job-1')).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
    expect(exportJobQueryKey('session-a', 'export-job-1', null)).not.toEqual(
      exportJobQueryKey('session-a', 'export-job-1', 'organization-1')
    );
  });
});
