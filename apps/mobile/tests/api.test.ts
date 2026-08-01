import { describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '../src/domain/auth';
import {
  ApiError,
  LyraMobileApiClient,
  type MobileAuthSessionPort,
  type PanelEntityAssignmentRecord,
} from '../src/lib/api';

describe('LyraMobileApiClient', () => {
  it('ID tokenで/api/meを取得しcanonical schemaで検証する', async () => {
    const auth = new FakeAuthSession();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(buildCurrentSession()),
    );
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.getCurrentSession()).resolves.toEqual(buildCurrentSession());
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer id-token',
        }),
      }),
    );
  });

  it('401ではrefreshを1回だけ行って再試行する', async () => {
    const auth = new FakeAuthSession();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse(buildCurrentSession()));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com/',
      auth,
      fetcher,
    });

    await expect(api.getCurrentSession()).resolves.toEqual(buildCurrentSession());
    expect(auth.refreshCalls).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer refreshed-id-token',
        }),
      }),
    );
  });

  it('不正payloadとserver bodyを安定した安全なerrorへ変換する', async () => {
    const auth = new FakeAuthSession();
    const invalidApi = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ user: null })),
    });
    const failedApi = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('provider secret stack', { status: 500 }),
      ),
    });

    await expect(invalidApi.getCurrentSession()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
    await expect(failedApi.getCurrentSession()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'SERVER_ERROR'
        && !error.message.includes('provider secret stack'),
    );
  });

  it('API通信を上限時間で中断する', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | null = null;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          receivedSignal = init?.signal ?? null;
          receivedSignal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
      requestTimeoutMs: 100,
    });

    const request = api.getCurrentSession();
    const rejection = expect(request).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('Story階層をcanonical schemaで取得しepisodeの最小更新を送る', async () => {
    const auth = new FakeAuthSession();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ works: [buildWork()], next_cursor: null }))
      .mockResolvedValueOnce(jsonResponse({ chapters: [buildChapter()] }))
      .mockResolvedValueOnce(jsonResponse({ episodes: [buildEpisode()] }))
      .mockResolvedValueOnce(jsonResponse({
        ...buildEpisode(),
        title: '更新後',
        story_full_draft: '更新後の本文',
      }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.getWorksPage({ limit: 50 })).resolves.toEqual({
      works: [buildWork()],
      next_cursor: null,
    });
    await expect(api.getChapters(buildWork().id)).resolves.toEqual({
      chapters: [buildChapter()],
    });
    await expect(api.getEpisodes(buildChapter().id)).resolves.toEqual({
      episodes: [buildEpisode()],
    });
    await expect(api.updateEpisode(buildEpisode().id, {
      title: '更新後',
      story_input_mode: 'full',
      story_full_draft: '更新後の本文',
      estimated_pages: 4,
    })).resolves.toMatchObject({
      title: '更新後',
      story_full_draft: '更新後の本文',
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.example.com/api/works?limit=50');
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `https://api.example.com/api/works/${buildWork().id}/chapters`,
    );
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      `https://api.example.com/api/chapters/${buildChapter().id}/episodes`,
    );
    expect(fetcher.mock.calls[3]).toEqual([
      `https://api.example.com/api/episodes/${buildEpisode().id}`,
      expect.objectContaining({
        body: JSON.stringify({
          title: '更新後',
          story_input_mode: 'full',
          story_full_draft: '更新後の本文',
          estimated_pages: 4,
        }),
        method: 'PUT',
      }),
    ]);
  });

  it('Story階層の作成・名称変更・移動を最小payloadで送る', async () => {
    const createdWork = { ...buildWork(), title: '新しい作品' };
    const createdChapter = { ...buildChapter(), title: '第二章', order: 2 };
    const createdEpisode = { ...buildEpisode(), title: '第二話', order: 2 };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createdWork))
      .mockResolvedValueOnce(jsonResponse(createdWork))
      .mockResolvedValueOnce(jsonResponse(createdChapter))
      .mockResolvedValueOnce(jsonResponse(createdChapter))
      .mockResolvedValueOnce(jsonResponse(createdChapter))
      .mockResolvedValueOnce(jsonResponse(createdEpisode))
      .mockResolvedValueOnce(jsonResponse(createdEpisode));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await api.createWork('新しい作品');
    await api.updateWork(buildWork().id, '新しい作品');
    await api.createChapter(buildWork().id, { order: 2, title: '第二章' });
    await api.updateChapter(buildChapter().id, '第二章');
    await api.moveChapter(buildChapter().id, 'down');
    await api.createEpisode(buildChapter().id, { order: 2, title: '第二話' });
    await api.moveEpisode(buildEpisode().id, 'down', true);

    expect(fetcher.mock.calls.map((call) => ({
      url: call[0],
      method: call[1]?.method,
      body: call[1]?.body,
    }))).toEqual([
      {
        url: 'https://api.example.com/api/works',
        method: 'POST',
        body: JSON.stringify({ title: '新しい作品' }),
      },
      {
        url: `https://api.example.com/api/works/${buildWork().id}`,
        method: 'PUT',
        body: JSON.stringify({ title: '新しい作品' }),
      },
      {
        url: `https://api.example.com/api/works/${buildWork().id}/chapters`,
        method: 'POST',
        body: JSON.stringify({ order: 2, title: '第二章' }),
      },
      {
        url: `https://api.example.com/api/chapters/${buildChapter().id}`,
        method: 'PUT',
        body: JSON.stringify({ title: '第二章' }),
      },
      {
        url: `https://api.example.com/api/chapters/${buildChapter().id}/move`,
        method: 'POST',
        body: JSON.stringify({ direction: 'down' }),
      },
      {
        url: `https://api.example.com/api/chapters/${buildChapter().id}/episodes`,
        method: 'POST',
        body: JSON.stringify({ order: 2, title: '第二話' }),
      },
      {
        url: `https://api.example.com/api/episodes/${buildEpisode().id}/move`,
        method: 'POST',
        body: JSON.stringify({ direction: 'down', cross_chapter: true }),
      },
    ]);
  });

  it('章と話の削除はorganization scopeをqueryで送り204だけを受理する', async () => {
    const organizationId = '99999999-9999-4999-8999-999999999999';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.deleteChapter(buildChapter().id, organizationId)).resolves.toBeUndefined();
    await expect(api.deleteEpisode(buildEpisode().id, organizationId)).resolves.toBeUndefined();

    expect(fetcher.mock.calls).toEqual([
      [
        `https://api.example.com/api/chapters/${buildChapter().id}?organization_id=${organizationId}`,
        expect.objectContaining({ body: undefined, method: 'DELETE' }),
      ],
      [
        `https://api.example.com/api/episodes/${buildEpisode().id}?organization_id=${organizationId}`,
        expect.objectContaining({ body: undefined, method: 'DELETE' }),
      ],
    ]);
  });

  it('削除APIの204以外のsuccess responseを契約違反として扱う', async () => {
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ deleted: true })),
    });

    await expect(api.deleteEpisode(buildEpisode().id)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('削除APIも401時にtokenを一度更新し、409 statusを保持する', async () => {
    const auth = new FakeAuthSession();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.deleteEpisode(buildEpisode().id)).resolves.toBeUndefined();
    await expect(api.deleteChapter(buildChapter().id)).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 409,
    });
    expect(auth.refreshCalls).toBe(1);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer id-token',
    });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer refreshed-id-token',
    });
  });

  it('organization作品作成だけorganization_idをbodyへ入れ、他のmutationはqueryへ入れる', async () => {
    const organizationId = '99999999-9999-4999-8999-999999999999';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ...buildWork(), organization_id: organizationId }))
      .mockResolvedValueOnce(jsonResponse(buildChapter()))
      .mockResolvedValueOnce(jsonResponse(buildEpisode()));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await api.createWork('法人作品', organizationId);
    await api.createChapter(buildWork().id, { order: 1, title: '第一章' }, organizationId);
    await api.createEpisode(buildChapter().id, { order: 1, title: '第一話' }, organizationId);

    expect(fetcher.mock.calls[0]).toEqual([
      'https://api.example.com/api/works',
      expect.objectContaining({
        body: JSON.stringify({ title: '法人作品', organization_id: organizationId }),
      }),
    ]);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `https://api.example.com/api/works/${buildWork().id}/chapters?organization_id=${organizationId}`,
    );
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      `https://api.example.com/api/chapters/${buildChapter().id}/episodes?organization_id=${organizationId}`,
    );
  });

  it('order競合の409 statusを呼び出し側へ保持する', async () => {
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"error":"conflict detail"}', { status: 409 }),
      ),
    });

    await expect(api.createChapter(buildWork().id, {
      order: 2,
      title: '第二章',
    })).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 409,
      message: 'The request could not be completed.',
    });
  });

  it('キャラ一覧をpaginationとorganization scope付きで取得する', async () => {
    const organizationId = '99999999-9999-4999-8999-999999999999';
    const entity = buildEntity();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ entities: [entity], next_cursor: 'next-page' }),
    );
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getEntitiesPage(
      buildWork().id,
      { limit: 50, cursor: 'cursor value' },
      organizationId,
    )).resolves.toEqual({ entities: [entity], next_cursor: 'next-page' });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://api.example.com/api/works/${buildWork().id}/entities?limit=50&cursor=cursor+value&organization_id=${organizationId}`,
    );
  });

  it('キャラ作成と更新はhidden fieldsや種類を含めない最小payloadを送る', async () => {
    const created = buildEntity();
    const updated = { ...created, name: 'シャーロック・ホームズ' };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(created, 201))
      .mockResolvedValueOnce(jsonResponse(updated));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.createEntity(buildWork().id, {
      entity_type: 'character',
      name: 'ホームズ',
      free_description: null,
    })).resolves.toEqual(created);
    await expect(api.updateEntity(created.id, {
      name: 'シャーロック・ホームズ',
    })).resolves.toEqual(updated);

    expect(fetcher.mock.calls.map((call) => ({
      url: call[0],
      method: call[1]?.method,
      body: call[1]?.body,
    }))).toEqual([
      {
        url: `https://api.example.com/api/works/${buildWork().id}/entities`,
        method: 'POST',
        body: JSON.stringify({
          entity_type: 'character',
          name: 'ホームズ',
          free_description: null,
        }),
      },
      {
        url: `https://api.example.com/api/entities/${created.id}`,
        method: 'PUT',
        body: JSON.stringify({ name: 'シャーロック・ホームズ' }),
      },
    ]);
  });

  it('別作品の一覧・作成responseと別IDの更新responseを採用しない', async () => {
    const differentWorkEntity = {
      ...buildEntity(),
      work_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const differentIdEntity = {
      ...buildEntity(),
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        entities: [differentWorkEntity],
        next_cursor: null,
      }))
      .mockResolvedValueOnce(jsonResponse(differentWorkEntity, 201))
      .mockResolvedValueOnce(jsonResponse(differentIdEntity));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getEntitiesPage(buildWork().id, { limit: 50 }))
      .rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 });
    await expect(api.createEntity(buildWork().id, {
      entity_type: 'character',
      name: 'ホームズ',
      free_description: null,
    })).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 });
    await expect(api.updateEntity(buildEntity().id, { name: '更新' }))
      .rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 });
  });

  it('キャラ一覧のlimitとcursorを送信前に検証する', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getEntitiesPage(buildWork().id, { limit: 101 }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    await expect(api.getEntitiesPage(buildWork().id, {
      limit: 50,
      cursor: 'x'.repeat(513),
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('Story階層の契約外success payloadを保存可能データとして返さない', async () => {
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ episodes: [{ id: buildEpisode().id }] }),
      ),
    });

    await expect(api.getEpisodes(buildChapter().id)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('organization Storyのread/writeで同じorganization scopeを送る', async () => {
    const organizationId = '99999999-9999-4999-8999-999999999999';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ works: [], next_cursor: null }))
      .mockResolvedValueOnce(jsonResponse({ chapters: [] }))
      .mockResolvedValueOnce(jsonResponse({ episodes: [] }))
      .mockResolvedValueOnce(jsonResponse(buildEpisode()));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await api.getWorksPage({ limit: 50 }, organizationId);
    await api.getChapters(buildWork().id, organizationId);
    await api.getEpisodes(buildChapter().id, organizationId);
    await api.updateEpisode(buildEpisode().id, {
      title: buildEpisode().title as string,
      estimated_pages: 4,
    }, organizationId);

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `https://api.example.com/api/works?limit=50&organization_id=${organizationId}`,
      `https://api.example.com/api/works/${buildWork().id}/chapters?organization_id=${organizationId}`,
      `https://api.example.com/api/chapters/${buildChapter().id}/episodes?organization_id=${organizationId}`,
      `https://api.example.com/api/episodes/${buildEpisode().id}?organization_id=${organizationId}`,
    ]);
  });

  it('Scene一覧・作成・更新をorganization scopeとcanonical contractで扱う', async () => {
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const scene = buildScene();
    const updatedScene = { ...scene, location: 'ベーカー街' };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ scenes: [scene] }))
      .mockResolvedValueOnce(jsonResponse(scene))
      .mockResolvedValueOnce(jsonResponse(updatedScene));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getScenes(buildEpisode().id, organizationId)).resolves.toEqual({
      scenes: [scene],
    });
    await expect(api.createScene(buildEpisode().id, {
      order: 1,
      location: null,
      time: null,
      atmosphere: null,
    }, organizationId)).resolves.toEqual(scene);
    await expect(api.updateScene(scene.id, {
      location: 'ベーカー街',
    }, organizationId)).resolves.toEqual(updatedScene);

    expect(fetcher.mock.calls).toEqual([
      [
        `https://api.example.com/api/episodes/${buildEpisode().id}/scenes?organization_id=${organizationId}`,
        expect.objectContaining({ method: 'GET' }),
      ],
      [
        `https://api.example.com/api/episodes/${buildEpisode().id}/scenes?organization_id=${organizationId}`,
        expect.objectContaining({
          body: JSON.stringify({
            order: 1,
            location: null,
            time: null,
            atmosphere: null,
          }),
          method: 'POST',
        }),
      ],
      [
        `https://api.example.com/api/scenes/${scene.id}?organization_id=${organizationId}`,
        expect.objectContaining({
          body: JSON.stringify({ location: 'ベーカー街' }),
          method: 'PUT',
        }),
      ],
    ]);
  });

  it('Sceneの契約外payloadをlocal stateへ入れない', async () => {
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ scenes: [{ ...buildScene(), order: 0 }] }),
      ),
    });

    await expect(api.getScenes(buildEpisode().id)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('Entity state一覧・作成・部分更新をorganization scopeとcanonical contractで扱う', async () => {
    const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const entity = buildEntity();
    const state = buildEntityState();
    const updated = { ...state, hair_note: '乾いた短髪' };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ entity_states: [state] }))
      .mockResolvedValueOnce(jsonResponse(state))
      .mockResolvedValueOnce(jsonResponse(updated));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getEntityStates(entity.id, organizationId)).resolves.toEqual({
      entity_states: [state],
    });
    await expect(api.createEntityState(entity.id, {
      scene_id: state.scene_id,
      costume_note: '黒い外套',
      condition_note: null,
      hair_note: null,
      expression_default: 'determined',
      extra_note: null,
    }, organizationId)).resolves.toEqual(state);
    await expect(api.updateEntityState(entity.id, state.id, {
      hair_note: '乾いた短髪',
    }, organizationId)).resolves.toEqual(updated);

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://api.example.com/api/entities/${entity.id}/states?organization_id=${organizationId}`,
    );
    expect(fetcher.mock.calls[1]).toEqual([
      `https://api.example.com/api/entities/${entity.id}/states?organization_id=${organizationId}`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          scene_id: state.scene_id,
          costume_note: '黒い外套',
          condition_note: null,
          hair_note: null,
          expression_default: 'determined',
          extra_note: null,
        }),
      }),
    ]);
    expect(fetcher.mock.calls[2]).toEqual([
      `https://api.example.com/api/entities/${entity.id}/states/${state.id}?organization_id=${organizationId}`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ hair_note: '乾いた短髪' }),
      }),
    ]);
  });

  it('Entity stateの別Entity・別state・要求field・意図しないcostume refを拒否する', async () => {
    const entity = buildEntity();
    const state = buildEntityState();
    const anotherEntityId = '77777777-7777-4777-8777-777777777777';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        entity_states: [{ ...state, entity_id: anotherEntityId }],
      }))
      .mockResolvedValueOnce(jsonResponse({ ...state, entity_id: anotherEntityId }))
      .mockResolvedValueOnce(jsonResponse({ ...state, costume_ref_id: 'unexpected-reference' }))
      .mockResolvedValueOnce(jsonResponse({ ...state, id: anotherEntityId }))
      .mockResolvedValueOnce(jsonResponse({ ...state, hair_note: 'remote value' }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getEntityStates(entity.id)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    });
    await expect(api.createEntityState(entity.id, {
      expression_default: 'determined',
    })).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
    await expect(api.createEntityState(entity.id, {
      expression_default: 'determined',
    })).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
    await expect(api.updateEntityState(entity.id, state.id, {
      hair_note: '乾いた短髪',
    })).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
    await expect(api.updateEntityState(entity.id, state.id, {
      hair_note: '乾いた短髪',
    })).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });

  it('Entity stateの空更新payloadをnetwork前に拒否する', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.updateEntityState(
      buildEntity().id,
      buildEntityState().id,
      {},
    )).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('Page一覧・初回骨格生成・job履歴を同じorganization scopeで扱う', async () => {
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const page = buildPage();
    const job = buildPageSkeletonJob();
    const queued = {
      job_id: job.id,
      queued: true as const,
      story_plan_applied: false,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ pages: [page] }))
      .mockResolvedValueOnce(jsonResponse(queued))
      .mockResolvedValueOnce(jsonResponse({ jobs: [job], next_cursor: null }))
      .mockResolvedValueOnce(jsonResponse(job));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getPages(buildEpisode().id, organizationId)).resolves.toEqual({
      pages: [page],
    });
    await expect(api.generatePageSkeleton(buildEpisode().id, {
      overwrite_existing: false,
      apply_story_plan: false,
      language: 'ja',
    }, organizationId)).resolves.toEqual(queued);
    await expect(api.getJobs({ limit: 50 }, organizationId)).resolves.toEqual({
      jobs: [job],
      next_cursor: null,
    });
    await expect(api.getJob(job.id, organizationId)).resolves.toEqual(job);

    expect(fetcher.mock.calls).toEqual([
      [
        `https://api.example.com/api/episodes/${buildEpisode().id}/pages?organization_id=${organizationId}`,
        expect.objectContaining({ method: 'GET' }),
      ],
      [
        `https://api.example.com/api/episodes/${buildEpisode().id}/generate-page-skeleton?organization_id=${organizationId}`,
        expect.objectContaining({
          body: JSON.stringify({
            overwrite_existing: false,
            apply_story_plan: false,
            language: 'ja',
          }),
          method: 'POST',
        }),
      ],
      [
        `https://api.example.com/api/jobs?limit=50&organization_id=${organizationId}`,
        expect.objectContaining({ method: 'GET' }),
      ],
      [
        `https://api.example.com/api/jobs/${job.id}?organization_id=${organizationId}`,
        expect.objectContaining({ method: 'GET' }),
      ],
    ]);
  });

  it('Page台詞設定の変更fieldだけを同じorganization scopeで保存する', async () => {
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const page = buildPage();
    const updated = { ...page, dialogue_mode: 'balloon_only' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(updated));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.updatePageSettings(page.id, {
      dialogue_mode: 'balloon_only',
    }, organizationId)).resolves.toEqual(updated);

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/api/pages/${page.id}?organization_id=${organizationId}`,
      expect.objectContaining({
        body: JSON.stringify({ dialogue_mode: 'balloon_only' }),
        method: 'PUT',
      }),
    );
  });

  it('Page styleとprovenance設定を既存endpointへ同じorganization scopeで保存する', async () => {
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const page = buildPage();
    const updated = {
      ...page,
      layout_config: {
        style_reference: {
          title: '水彩調',
          notes: '淡い背景',
          compiled_brief: 'server compiled',
        },
      },
      story_continuity_note: '傘を持たせる',
      story_page_purpose: '静かな転換を示す',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(updated));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.updatePageSettings(page.id, {
      story_continuity_note: '傘を持たせる',
      story_page_purpose: '静かな転換を示す',
      style_reference: {
        notes: '淡い背景',
        title: '水彩調',
      },
    }, organizationId)).resolves.toEqual(updated);

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/api/pages/${page.id}?organization_id=${organizationId}`,
      expect.objectContaining({
        body: JSON.stringify({
          story_continuity_note: '傘を持たせる',
          story_page_purpose: '静かな転換を示す',
          style_reference: {
            notes: '淡い背景',
            title: '水彩調',
          },
        }),
        method: 'PUT',
      }),
    );
  });

  it('Page台詞設定APIは別Pageのsuccess responseと空更新を採用しない', async () => {
    const page = buildPage();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      ...page,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.updatePageSettings(page.id, {
      page_dialogue_toggle: false,
    })).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 });
    await expect(api.updatePageSettings(page.id, {})).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 422,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('Story自動入力をlanguageだけのbodyと同じorganization scopeで開始する', async () => {
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const accepted = { job_id: buildPageSkeletonJob().id };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(accepted));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.autofillEpisodePagesFromStory(
      buildEpisode().id,
      'ja',
      organizationId,
    )).resolves.toEqual(accepted);

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/api/episodes/${buildEpisode().id}/autofill-pages-from-story?organization_id=${organizationId}`,
      expect.objectContaining({
        body: JSON.stringify({ language: 'ja' }),
        method: 'POST',
      }),
    );
  });

  it('Story自動入力の契約外success payloadを拒否する', async () => {
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        job_id: buildPageSkeletonJob().id,
        queued: true,
      })),
    });

    await expect(api.autofillEpisodePagesFromStory(
      buildEpisode().id,
      'en',
    )).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('Page骨格とjobの契約外success payloadを拒否する', async () => {
    const invalidPageApi = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ pages: [{ ...buildPage(), page_number: 0 }] }),
      ),
    });
    const invalidJobApi = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ jobs: [{ ...buildPageSkeletonJob(), credit_cost: -1 }], next_cursor: null }),
      ),
    });

    await expect(invalidPageApi.getPages(buildEpisode().id)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
    await expect(invalidJobApi.getJobs({ limit: 50 })).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('骨格生成responseと単一jobの契約外success payloadを拒否する', async () => {
    const invalidSkeletonApi = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        job_id: buildPageSkeletonJob().id,
        queued: false,
        story_plan_applied: false,
      })),
    });
    const invalidJobApi = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        ...buildPageSkeletonJob(),
        credit_cost: -1,
      })),
    });

    await expect(invalidSkeletonApi.generatePageSkeleton(buildEpisode().id, {
      overwrite_existing: false,
      apply_story_plan: false,
      language: 'ja',
    })).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
    await expect(invalidJobApi.getJob(buildPageSkeletonJob().id)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('単一job endpointが要求と異なるjob IDを返した場合は拒否する', async () => {
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        ...buildPageSkeletonJob(),
        id: '99999999-9999-4999-8999-999999999999',
      })),
    });

    await expect(api.getJob(buildPageSkeletonJob().id)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('Panel一覧と変更fieldだけの更新を同じorganization scopeで扱う', async () => {
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const panel = buildPanel();
    const updated = { ...panel, situation_text: 'ワトスが振り返る' };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ panels: [panel] }))
      .mockResolvedValueOnce(jsonResponse(updated));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getPanels(buildPage().id, organizationId)).resolves.toEqual({
      panels: [panel],
    });
    await expect(api.updatePanel(panel.id, {
      situation_text: 'ワトスが振り返る',
    }, organizationId)).resolves.toEqual(updated);

    expect(fetcher.mock.calls).toEqual([
      [
        `https://api.example.com/api/pages/${buildPage().id}/panels?organization_id=${organizationId}`,
        expect.objectContaining({ method: 'GET' }),
      ],
      [
        `https://api.example.com/api/panels/${panel.id}?organization_id=${organizationId}`,
        expect.objectContaining({
          body: JSON.stringify({ situation_text: 'ワトスが振り返る' }),
          method: 'PUT',
        }),
      ],
    ]);
  });

  it('Panel APIは別Page・別Panelのsuccess responseと空更新を採用しない', async () => {
    const panel = buildPanel();
    const differentPagePanel = {
      ...panel,
      page_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const differentPanel = {
      ...panel,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ panels: [differentPagePanel] }))
      .mockResolvedValueOnce(jsonResponse(differentPanel));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getPanels(buildPage().id)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
    await expect(api.updatePanel(panel.id, { panel_notes: '更新' })).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
    await expect(api.updatePanel(panel.id, {})).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 422,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('Panel assignmentをexpected snapshot付きで同じorganization scopeへ保存する', async () => {
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const panel = buildPanel();
    const expected = panel.entities as PanelEntityAssignmentRecord[];
    const entities = expected.map((assignment) => ({ ...assignment, role: 'secondary' }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ entities }),
    );
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.replacePanelEntityAssignments(
      panel.id,
      { entities, expected_entities: expected },
      organizationId,
    )).resolves.toEqual({ entities });

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/api/panels/${panel.id}/entities?organization_id=${organizationId}`,
      expect.objectContaining({
        body: JSON.stringify({ entities, expected_entities: expected }),
        method: 'PUT',
      }),
    );
  });

  it('Panel assignmentの契約外success responseを採用しない', async () => {
    const panel = buildPanel();
    const expected = panel.entities as PanelEntityAssignmentRecord[];
    const invalid = expected.map(({ role: _role, ...assignment }) => assignment);
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ entities: invalid })),
    });

    await expect(api.replacePanelEntityAssignments(
      panel.id,
      { entities: expected, expected_entities: expected },
    )).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('Entity reference setを同じorganization scopeで取得する', async () => {
    const entityId = '77777777-7777-4777-8777-777777777777';
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const referenceSet = buildEntityReferenceSet(entityId);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(referenceSet));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getEntityReferenceSet(entityId, organizationId)).resolves.toEqual(referenceSet);
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/api/entities/${entityId}/reference-set?organization_id=${organizationId}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('Entity reference setが別Entityまたは契約外payloadなら拒否する', async () => {
    const entityId = '77777777-7777-4777-8777-777777777777';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(buildEntityReferenceSet(
        '88888888-8888-4888-8888-888888888888',
      )))
      .mockResolvedValueOnce(jsonResponse({
        ...buildEntityReferenceSet(entityId),
        s3_key: 'private/key.png',
      }));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.getEntityReferenceSet(entityId)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
    await expect(api.getEntityReferenceSet(entityId)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
  });

  it('Entity画像importを保存済みEntityとorganizationへscopeしてstrict responseを返す', async () => {
    const entityId = '77777777-7777-4777-8777-777777777777';
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const response = {
      suggested_fields: { art_style: 'manga' },
      prompt_supplement: '黒髪、長身、鋭い目つき',
      tmp_image_token: 'opaque-candidate-token',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.importEntityReferenceImage(
      entityId,
      'character',
      'data:image/jpeg;base64,/9j/AA==',
      organizationId,
    )).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/api/entities/import-image?organization_id=${organizationId}`,
      expect.objectContaining({
        body: JSON.stringify({
          entity_type: 'character',
          entity_id: entityId,
          image_base64: 'data:image/jpeg;base64,/9j/AA==',
        }),
        method: 'POST',
      }),
    );
  });

  it('Entity画像importの契約外success payloadを候補として採用しない', async () => {
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        suggested_fields: {},
        prompt_supplement: '補足',
        tmp_image_token: '',
      })),
    });

    await expect(api.importEntityReferenceImage(
      '77777777-7777-4777-8777-777777777777',
      'character',
      'data:image/jpeg;base64,/9j/AA==',
    )).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 });
  });

  it('Entity画像importだけはAI解析のため60秒timeoutを使う', async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | null = null;
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_, init) => {
        capturedSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      });
      const api = new LyraMobileApiClient({
        apiBaseUrl: 'https://api.example.com',
        auth: new FakeAuthSession(),
        fetcher,
      });

      const operation = api.importEntityReferenceImage(
        '77777777-7777-4777-8777-777777777777',
        'character',
        'data:image/jpeg;base64,/9j/AA==',
      );
      const rejection = expect(operation).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(capturedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('Entity参照生成をsourceなし・source候補ありで既存202契約へ送る', async () => {
    const entityId = '77777777-7777-4777-8777-777777777777';
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-without-source' }, 202))
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-with-source' }, 202));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.generateEntityReference(entityId, null, organizationId))
      .resolves.toEqual({ job_id: 'job-without-source' });
    await expect(api.generateEntityReference(
      entityId,
      'opaque-source-candidate',
      organizationId,
    )).resolves.toEqual({ job_id: 'job-with-source' });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `https://api.example.com/api/entities/${entityId}/generate-reference?organization_id=${organizationId}`,
      expect.objectContaining({ method: 'POST', body: undefined }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `https://api.example.com/api/entities/${entityId}/generate-reference?organization_id=${organizationId}`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ source_candidate_token: 'opaque-source-candidate' }),
      }),
    );
  });

  it('Entity参照生成の契約外202 payloadをjobとして採用しない', async () => {
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ job_id: '' }, 202)),
    });

    await expect(api.generateEntityReference(
      '77777777-7777-4777-8777-777777777777',
    )).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 });
  });

  it('source生成前のprompt supplementだけをchanged-field-onlyで保存する', async () => {
    const entityId = '77777777-7777-4777-8777-777777777777';
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const updatedEntity = {
      ...buildEntity(),
      id: entityId,
      prompt_supplement: '黒髪、長身、鋭い目つき',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(updatedEntity));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });

    await expect(api.updateEntityGenerationContext(
      entityId,
      '黒髪、長身、鋭い目つき',
      organizationId,
    )).resolves.toEqual(updatedEntity);
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/api/entities/${entityId}?organization_id=${organizationId}`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ prompt_supplement: '黒髪、長身、鋭い目つき' }),
      }),
    );
  });

  it('候補tokenだけでEntity referenceを確定しresponseのEntity一致を検証する', async () => {
    const entityId = '77777777-7777-4777-8777-777777777777';
    const organizationId = '55555555-5555-4555-8555-555555555555';
    const referenceSet = buildEntityReferenceSet(entityId);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(referenceSet))
      .mockResolvedValueOnce(jsonResponse(buildEntityReferenceSet(
        '88888888-8888-4888-8888-888888888888',
      )));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
    });
    const body = {
      selected_candidate_tokens: ['opaque-candidate-token'],
      primary_candidate_token: 'opaque-candidate-token',
      prompt_supplement: '黒髪、長身、鋭い目つき',
    } as const;

    await expect(api.confirmEntityReference(entityId, body, organizationId))
      .resolves.toEqual(referenceSet);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `https://api.example.com/api/entities/${entityId}/reference/confirm?organization_id=${organizationId}`,
      expect.objectContaining({ body: JSON.stringify(body), method: 'POST' }),
    );
    await expect(api.confirmEntityReference(entityId, body, organizationId))
      .rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 });
  });

  it('画像用認証更新を同時実行してもrefreshは1回だけにする', async () => {
    let resolveRefresh: ((tokens: AuthTokens) => void) | undefined;
    const auth: MobileAuthSessionPort = {
      getTokens: vi.fn().mockResolvedValue(buildTokens('id-token')),
      refreshTokens: vi.fn().mockReturnValue(new Promise<AuthTokens>((resolve) => {
        resolveRefresh = resolve;
      })),
    };
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher: vi.fn<typeof fetch>(),
    });

    const first = api.refreshImageAuthorizationHeader();
    const second = api.refreshImageAuthorizationHeader();
    expect(auth.refreshTokens).toHaveBeenCalledOnce();
    resolveRefresh?.(buildTokens('refreshed-id-token'));

    await expect(Promise.all([first, second])).resolves.toEqual([
      'Bearer refreshed-id-token',
      'Bearer refreshed-id-token',
    ]);
  });
});

class FakeAuthSession implements MobileAuthSessionPort {
  public refreshCalls = 0;
  private tokens: AuthTokens = buildTokens('id-token');

  public async getTokens(): Promise<AuthTokens | null> {
    return this.tokens;
  }

  public async refreshTokens(): Promise<AuthTokens> {
    this.refreshCalls += 1;
    this.tokens = buildTokens('refreshed-id-token');
    return this.tokens;
  }
}

function buildTokens(idToken: string): AuthTokens {
  return {
    idToken,
    accessToken: null,
    refreshToken: 'refresh-token',
    expiresAt: 1_800_000_000_000,
    tokenType: 'Bearer',
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildCurrentSession(): Record<string, unknown> {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
      display_name: null,
      plan_code: 'free',
    },
    personal_credits: {
      monthly_credits: 10,
      purchased_credits: 2,
      total_credits: 12,
      monthly_expires_at: null,
    },
    organizations: [],
  };
}

function buildEntityReferenceSet(entityId: string): Record<string, unknown> {
  return {
    entity_id: entityId,
    primary_ref_id: 'reference-1',
    status: 'ready',
    updated_at: '2026-08-01T00:00:00.000Z',
    reference_images: [
      {
        ref_id: 'reference-1',
        cdn_url: 'https://cdn.example.com/reference.png?Signature=signed',
        source: 'generated',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ],
  };
}

function buildWork(): Record<string, unknown> & { id: string } {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    organization_id: null,
    title: '緋色の研究',
    genre: 'mystery',
    world_setting: null,
    theme: null,
    main_entity_ids: [],
    starting_point: null,
    ending_point: null,
    overall_flow: null,
    version: 1,
    status: 'draft',
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  };
}

function buildChapter(): Record<string, unknown> & { id: string } {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    work_id: buildWork().id,
    order: 1,
    title: '第一章',
    purpose: null,
    starting_state: null,
    ending_state: null,
    emotion_curve: null,
    entities_involved: [],
    key_beats: [],
    version: 1,
    status: 'draft',
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  };
}

function buildEpisode(): Record<string, unknown> & { id: string } {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    chapter_id: buildChapter().id,
    order: 1,
    title: 'ローリストン・ガーデン',
    purpose: null,
    story_input_mode: 'full',
    story_full_draft: 'ホームズとワトスが現場へ向かう。',
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    estimated_pages: 4,
    entities_involved: [],
    page_skeleton_generated: false,
    version: 1,
    status: 'draft',
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  };
}

function buildScene(): Record<string, unknown> & { id: string } {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    episode_id: buildEpisode().id,
    order: 1,
    location: null,
    time: null,
    atmosphere: null,
    involved_entity_ids: [],
    entity_states: [],
    status: 'draft',
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  };
}

function buildEntityState(): Record<string, unknown> & { id: string; scene_id: string } {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    entity_id: buildEntity().id,
    scene_id: buildScene().id,
    costume_note: '黒い外套',
    costume_ref_id: null,
    condition_note: null,
    hair_note: null,
    expression_default: 'determined',
    extra_note: null,
    created_at: '2026-08-01T00:00:00.000Z',
  };
}

function buildPage(): Record<string, unknown> & { id: string } {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    episode_id: buildEpisode().id,
    page_number: 1,
    layout_config: {},
    story_source_scene_ids: [],
    story_page_purpose: null,
    story_continuity_note: null,
    dialogue_mode: 'image_baked',
    page_dialogue_toggle: true,
    generation_mode: null,
    generated_image: null,
    status: 'designing',
    panel_count: 4,
    frame_count: 4,
    balloon_count: 0,
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  };
}

function buildEntity(): Record<string, unknown> & { id: string } {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    work_id: buildWork().id,
    entity_type: 'character',
    name: 'ホームズ',
    free_description: null,
    structured_fields: { age_range: '成人' },
    prompt_supplement: 'hidden prompt',
    speech_profile: { tone: 'calm' },
    status: 'ready',
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  };
}

function buildPanel(): Record<string, unknown> & { id: string } {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    page_id: buildPage().id,
    order: 1,
    panel_role: 'action',
    panel_size: 'standard',
    situation_text: 'ホームズが扉を指す',
    entities: [
      {
        entity_id: buildEntity().id,
        role: 'primary',
        expression: 'calm',
        custom_expression: null,
        action: 'standing_firm',
        custom_action: null,
        position: 'center',
        facing_direction: null,
        effect_note: null,
        state_id: null,
      },
    ],
    composition: {
      source: 'custom',
      gallery_item_id: null,
      composition_prompt: 'ホームズの上半身',
      shot_type: 'close_up',
      angle: 'front',
      custom_note: null,
    },
    dialogue_in_panel: true,
    dialogue: [
      {
        entity_id: buildEntity().id,
        text: 'ここを見てください。',
        type: 'speech',
        position: 'top',
      },
    ],
    sfx_text: null,
    background_note: null,
    panel_notes: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function buildPageSkeletonJob(): Record<string, unknown> & { id: string } {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    job_type: 'episode_page_skeleton',
    status: 'processing',
    params: {
      episode_id: buildEpisode().id,
      overwrite_existing: false,
      apply_story_plan: false,
      language: 'ja',
    },
    result: {
      progress_stage: 'compiling',
      progress_message: 'provider internal detail',
      progress_current_chunk: 1,
      progress_total_chunks: 4,
      progress_started_at: '2026-07-31T00:00:00.000Z',
      progress_updated_at: '2026-07-31T00:00:01.000Z',
    },
    generation_mode: null,
    credit_cost: 0,
    error_message: null,
    retry_count: 0,
    created_at: '2026-07-31T00:00:00.000Z',
    started_at: '2026-07-31T00:00:00.000Z',
    completed_at: null,
    expires_at: null,
    cancel_requested_at: null,
    cancelled_at: null,
    commit_started_at: null,
  };
}
