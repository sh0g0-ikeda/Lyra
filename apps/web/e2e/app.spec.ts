import { expect, test, type Page, type Route } from '@playwright/test';

const manualTokenStorageKey = 'lyra:web:manual-token';
const uiLanguageStorageKey = 'lyra:web:ui-language';
const legacyTrackedJobsStorageKey = 'lyra:web:tracked-jobs:email:session';
const personalTrackedJobsStorageKey = `${legacyTrackedJobsStorageKey}:workspace:personal`;
const cancellableStoryJobId = '77777777-7777-4777-8777-777777777777';

const work = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-1',
  title: 'Moonlit Regiment',
  genre: 'fantasy',
  world_setting: 'Empire under eclipse.',
  theme: 'duty versus desire',
  main_entity_ids: ['entity-1'],
  starting_point: 'A border garrison.',
  ending_point: 'A shattered capital.',
  overall_flow: 'Escalation to coup.',
  version: 1,
  edit_history: [],
  status: 'draft',
  created_at: '2026-04-26T00:00:00.000Z',
  updated_at: '2026-04-26T00:00:00.000Z',
};

const chapter = {
  id: 'chapter-1',
  work_id: work.id,
  order: 1,
  title: 'First movement',
  purpose: 'Set the political baseline.',
  starting_state: null,
  ending_state: null,
  emotion_curve: null,
  entities_involved: ['entity-1'],
  key_beats: ['Arrival'],
  version: 1,
  edit_history: [],
  status: 'draft',
  created_at: '2026-04-26T00:00:00.000Z',
  updated_at: '2026-04-26T00:00:00.000Z',
};

const episode = {
  id: 'episode-1',
  chapter_id: chapter.id,
  order: 1,
  title: 'Arrival',
  purpose: 'Introduce the assignment.',
  introduction: 'Arrival at the fort.',
  middle: 'A suspicious briefing.',
  climax: 'A duel in the rain.',
  ending_hook: 'An unseen observer.',
  estimated_pages: 8,
  entities_involved: ['entity-1'],
  page_skeleton_generated: true,
  version: 1,
  edit_history: [],
  status: 'draft',
  created_at: '2026-04-26T00:00:00.000Z',
  updated_at: '2026-04-26T00:00:00.000Z',
};

const entity = {
  id: 'entity-1',
  work_id: work.id,
  user_id: 'user-1',
  entity_type: 'character',
  name: 'Mizuki',
  free_description: 'Black long hair swordswoman',
  structured_fields: { art_style: 'anime' },
  prompt_supplement: 'anime swordswoman',
  speech_profile: {},
  status: 'draft',
  created_at: '2026-04-26T00:00:00.000Z',
  updated_at: '2026-04-26T00:00:00.000Z',
};

const pageRecord = {
  id: 'page-1',
  episode_id: episode.id,
  page_number: 1,
  layout_config: { type: 'template', template_id: '3-panel-standard' },
  story_source_scene_ids: [],
  story_page_purpose: null,
  story_continuity_note: null,
  dialogue_mode: 'mixed',
  page_dialogue_toggle: true,
  generation_mode: 'standard',
  generated_image: {
    s3_key: 'session/user-1/pages/page-1/job-1.png',
    cdn_url: 'https://cdn.example.test/page-1.png',
    generation_mode: 'standard',
    generated_at: '2026-04-26T00:00:00.000Z',
  },
  status: 'generated',
  panel_count: 1,
  frame_count: 1,
  balloon_count: 1,
  created_at: '2026-04-26T00:00:00.000Z',
  updated_at: '2026-04-26T00:00:00.000Z',
};

const frame = {
  id: 'frame-1',
  page_id: pageRecord.id,
  panel_id: 'panel-1',
  vertices: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  border_style: 'solid',
  border_width: 2,
  border_color: '#111111',
  z_index: 1,
  reading_order: 1,
};

const panel = {
  id: 'panel-1',
  page_id: pageRecord.id,
  order: 1,
  panel_role: 'setup',
  panel_size: 'medium',
  situation_text: 'Mizuki enters the fort.',
  entities: [],
  composition: {
    source: 'ai_auto',
    gallery_item_id: null,
    composition_prompt: null,
    shot_type: null,
    angle: null,
    custom_note: null,
  },
  dialogue_in_panel: true,
  dialogue: [],
  sfx_text: null,
  background_note: null,
  panel_notes: null,
  created_at: '2026-04-26T00:00:00.000Z',
  updated_at: '2026-04-26T00:00:00.000Z',
};

const balloon = {
  id: 'balloon-1',
  page_id: pageRecord.id,
  speaker_entity_id: entity.id,
  balloon_type: 'speech',
  writing_mode: 'horizontal',
  text: 'We are late.',
  position: { x: 12, y: 14, width: 24, height: 18 },
  tail: null,
  font_size: 18,
  font_family: 'Noto Sans JP',
  panel_order_reference: 1,
  z_index: 1,
};

const composition = {
  id: 'composition-1',
  name: 'Heroic medium',
  category: 'character',
  entity_count: 1,
  preview_s3_key: null,
  preview_cdn_url: null,
  composition_prompt: 'heroic medium shot',
  shot_type: 'medium',
  angle: 'eye_level',
  tags: ['hero'],
  created_at: '2026-04-26T00:00:00.000Z',
};

async function mockApi(
  route: Route,
  options: { legacyBilling?: boolean; legacyJobCancellationFields?: boolean } = {},
): Promise<void> {
  const url = new URL(route.request().url());
  const { pathname } = url;

  const json = (body: unknown): Promise<void> =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  if (pathname === '/api/works') {
    if (route.request().method() === 'GET') {
      return json({ works: [work] });
    }
    if (route.request().method() === 'POST') {
      return json(work);
    }
  }

  if (pathname === `/api/works/${work.id}/chapters`) {
    if (route.request().method() === 'GET') {
      return json({ chapters: [chapter] });
    }
    if (route.request().method() === 'POST') {
      return json(chapter);
    }
  }

  if (pathname === `/api/chapters/${chapter.id}` && route.request().method() === 'PUT') {
    return json(chapter);
  }

  if (pathname === `/api/chapters/${chapter.id}` && route.request().method() === 'DELETE') {
    return route.fulfill({ status: 204 });
  }

  if (pathname === `/api/chapters/${chapter.id}/episodes`) {
    if (route.request().method() === 'GET') {
      return json({ episodes: [episode] });
    }
    if (route.request().method() === 'POST') {
      return json(episode);
    }
  }

  if (pathname === `/api/episodes/${episode.id}` && route.request().method() === 'PUT') {
    return json(episode);
  }

  if (pathname === `/api/episodes/${episode.id}/generate-page-skeleton`) {
    return json({ pages_created: 1, panels_created: 3 });
  }

  if (pathname === `/api/episodes/${episode.id}/scenes`) {
    return json({ scenes: [] });
  }

  if (pathname === `/api/episodes/${episode.id}/pages`) {
    return json({ pages: [pageRecord] });
  }

  if (pathname === `/api/works/${work.id}/entities`) {
    if (route.request().method() === 'GET') {
      return json({ entities: [entity] });
    }
    if (route.request().method() === 'POST') {
      return json(entity);
    }
  }

  if (pathname === `/api/entities/${entity.id}/reference-set`) {
    return json({
      entity_id: entity.id,
      primary_ref_id: 'ref-1',
      status: 'ready',
      updated_at: '2026-04-26T00:00:00.000Z',
      reference_images: [
        {
          ref_id: 'ref-1',
          s3_key: 'saved/user-1/entities/entity-1/ref-1.png',
          cdn_url: 'https://cdn.example.test/ref-1.png',
          source: 'generated',
          created_at: '2026-04-26T00:00:00.000Z',
        },
      ],
    });
  }

  if (pathname === `/api/pages/${pageRecord.id}/panels`) {
    return json({ panels: [panel] });
  }

  if (pathname === `/api/pages/${pageRecord.id}/frames`) {
    return json({ frames: [frame] });
  }

  if (pathname === `/api/pages/${pageRecord.id}/balloons`) {
    return json({ balloons: [balloon] });
  }

  if (pathname === '/api/compositions') {
    return json({ compositions: [composition] });
  }

  if (pathname === '/api/billing/balance') {
    return json({
      monthly_credits: 100,
      purchased_credits: 40,
      total_credits: 140,
      monthly_expires_at: null,
      ...(options.legacyBilling
        ? {}
        : {
            plan_code: 'free',
            subscription_plans: [],
          }),
    });
  }

  if (pathname === `/api/jobs/${cancellableStoryJobId}/cancel` && route.request().method() === 'POST') {
    return json({
      id: cancellableStoryJobId,
      job_type: 'episode_story_autofill',
      status: 'cancelled',
      generation_mode: null,
      credit_cost: 0,
      params: { episode_id: episode.id, language: 'en' },
      result: {
        progress_stage: 'cancelled',
        progress_message: 'Story plan autofill was stopped.',
      },
      error_message: null,
      retry_count: 0,
      created_at: '2026-04-26T00:00:00.000Z',
      started_at: null,
      completed_at: '2026-04-26T00:00:02.000Z',
      expires_at: null,
      cancel_requested_at: '2026-04-26T00:00:02.000Z',
      cancelled_at: '2026-04-26T00:00:02.000Z',
      commit_started_at: null,
    });
  }

  if (pathname === `/api/jobs/${cancellableStoryJobId}`) {
    return json({
      id: cancellableStoryJobId,
      job_type: 'episode_story_autofill',
      status: 'queued',
      generation_mode: null,
      credit_cost: 0,
      params: { episode_id: episode.id, language: 'en' },
      result: {
        progress_stage: 'queued',
        progress_message: 'Queued. This process can take around 20 minutes.',
      },
      error_message: null,
      retry_count: 0,
      created_at: '2026-04-26T00:00:00.000Z',
      started_at: null,
      completed_at: null,
      expires_at: null,
      ...(options.legacyJobCancellationFields
        ? {}
        : {
            cancel_requested_at: null,
            cancelled_at: null,
            commit_started_at: null,
          }),
    });
  }

  if (pathname.startsWith('/api/jobs/')) {
    return json({
      id: 'job-1',
      job_type: 'page_generate',
      status: 'completed',
      generation_mode: 'standard',
      credit_cost: 10,
      params: { page_id: pageRecord.id },
      result: {},
      error_message: null,
      retry_count: 0,
      created_at: '2026-04-26T00:00:00.000Z',
      started_at: '2026-04-26T00:00:01.000Z',
      completed_at: '2026-04-26T00:00:02.000Z',
      expires_at: null,
      cancel_requested_at: null,
      cancelled_at: null,
      commit_started_at: null,
    });
  }

  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  });
}

async function seedAuthenticatedSession(page: Page): Promise<void> {
  await page.addInitScript((storageKey) => {
    window.sessionStorage.setItem(storageKey, 'header.payload.signature');
  }, manualTokenStorageKey);
}

async function seedEnglishUi(page: Page): Promise<void> {
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, 'en');
  }, uiLanguageStorageKey);
}

async function seedTrackedJobs(
  page: Page,
  jobIds: string[],
  storageKey = personalTrackedJobsStorageKey,
): Promise<void> {
  await page.addInitScript(({ storageKey, values }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(values));
  }, { storageKey, values: jobIds });
}

test('shows auth screen without token', async ({ page }) => {
  await seedEnglishUi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lyra Japan' })).toBeVisible();
  await expect(page.getByText('Lyra AI manga editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use token' })).toBeVisible();
});

test('renders the console with mocked api responses', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', mockApi);

  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Moonlit Regiment', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 First movement', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 Arrival', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse work', exact: true }).click();
  await expect(page.getByRole('button', { name: '1 First movement', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand work', exact: true }).click();
  await expect(page.getByRole('button', { name: '1 First movement', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Story', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entities', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pages', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.getByText('Mizuki')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate full-body preview' })).toBeVisible();

  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Situation' })).toHaveValue('Mizuki enters the fort.');
});

test('話を保存すると表示中レコードの更新時刻を送る', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  let updateBody: Record<string, unknown> | null = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/episodes/${episode.id}` && request.method() === 'PUT') {
      updateBody = request.postDataJSON() as Record<string, unknown>;
    }
    await mockApi(route);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => updateBody).toMatchObject({
    expected_updated_at: episode.updated_at,
    title: episode.title,
  });
});

test('話の保存後の再取得が失敗しても次回保存は返却された更新時刻を使う', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  const savedEpisode = {
    ...episode,
    story_input_mode: 'full',
    story_full_draft: 'Saved story',
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    updated_at: '2026-04-26T00:00:01.000Z',
    version: 2,
  };
  const updateBodies: Array<Record<string, unknown>> = [];
  let rejectEpisodeRefresh = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/chapters/${chapter.id}/episodes` && request.method() === 'GET') {
      if (rejectEpisodeRefresh) {
        await route.fulfill({
          body: JSON.stringify({ code: 'TEMPORARY_FAILURE', message: 'refresh failed' }),
          contentType: 'application/json',
          status: 500,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({ episodes: [episode] }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname === `/api/episodes/${episode.id}` && request.method() === 'PUT') {
      updateBodies.push(request.postDataJSON() as Record<string, unknown>);
      rejectEpisodeRefresh = true;
      await route.fulfill({
        body: JSON.stringify({
          ...savedEpisode,
          updated_at: updateBodies.length === 1 ? savedEpisode.updated_at : '2026-04-26T00:00:02.000Z',
          version: updateBodies.length + 1,
        }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await mockApi(route);
  });

  await page.goto('/');
  const saveButton = page.getByRole('button', { name: 'Save', exact: true });
  await saveButton.click();
  await expect.poll(() => updateBodies.length).toBe(1);
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => updateBodies.length).toBe(2);
  expect(updateBodies[1]).toMatchObject({ expected_updated_at: savedEpisode.updated_at });
});

test('話保存後のシーン保存が失敗しても次回保存は返却された更新時刻を使う', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  const selectedScene = {
    id: 'scene-1',
    episode_id: episode.id,
    order: 1,
    location: 'Border fort',
    time: 'Night',
    atmosphere: 'Tense',
    involved_entity_ids: [entity.id],
    entity_states: [],
    status: 'draft',
    created_at: episode.created_at,
    updated_at: episode.updated_at,
  };
  const savedEpisode = {
    ...episode,
    story_input_mode: 'full',
    story_full_draft: 'Saved before Story AI',
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    updated_at: '2026-04-26T00:00:01.000Z',
    version: 2,
  };
  const updateBodies: Array<Record<string, unknown>> = [];
  let failedSceneSave = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/episodes/${episode.id}/scenes` && request.method() === 'GET') {
      await route.fulfill({
        body: JSON.stringify({ scenes: [selectedScene] }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname === `/api/episodes/${episode.id}` && request.method() === 'PUT') {
      updateBodies.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        body: JSON.stringify({
          ...savedEpisode,
          updated_at: updateBodies.length === 1 ? savedEpisode.updated_at : '2026-04-26T00:00:02.000Z',
          version: updateBodies.length + 1,
        }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname === `/api/scenes/${selectedScene.id}` && request.method() === 'PUT') {
      failedSceneSave = true;
      await route.fulfill({
        body: JSON.stringify({ code: 'TEMPORARY_FAILURE', message: 'scene save failed' }),
        contentType: 'application/json',
        status: 500,
      });
      return;
    }
    await mockApi(route);
  });

  await page.goto('/');
  const instruction = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await instruction.fill('Improve the pacing');
  await page.getByRole('button', { name: 'Improve draft', exact: true }).click();

  await expect.poll(() => failedSceneSave).toBe(true);
  await expect.poll(() => updateBodies.length).toBe(1);
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => updateBodies.length).toBe(2);
  expect(updateBodies[1]).toMatchObject({ expected_updated_at: savedEpisode.updated_at });
});

test('作品名保存後の再取得が失敗しても次回保存は返却された更新時刻を使う', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  const savedWork = {
    ...work,
    title: 'Moonlit Regiment revised',
    updated_at: '2026-04-26T00:00:01.000Z',
    version: 2,
  };
  const updateBodies: Array<Record<string, unknown>> = [];
  let rejectWorkRefresh = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/works' && request.method() === 'GET') {
      if (rejectWorkRefresh) {
        await route.fulfill({
          body: JSON.stringify({ code: 'TEMPORARY_FAILURE', message: 'refresh failed' }),
          contentType: 'application/json',
          status: 500,
        });
        return;
      }
      await route.fulfill({ body: JSON.stringify({ works: [work] }), contentType: 'application/json', status: 200 });
      return;
    }
    if (pathname === `/api/works/${work.id}` && request.method() === 'PUT') {
      updateBodies.push(request.postDataJSON() as Record<string, unknown>);
      rejectWorkRefresh = true;
      await route.fulfill({
        body: JSON.stringify({
          ...savedWork,
          title: String(updateBodies.at(-1)?.title ?? savedWork.title),
          updated_at: updateBodies.length === 1 ? savedWork.updated_at : '2026-04-26T00:00:02.000Z',
          version: updateBodies.length + 1,
        }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await mockApi(route);
  });

  await page.goto('/');
  const renameWork = async (title: string, expectedSaveCount: number): Promise<void> => {
    const trigger = page.getByRole('button', { name: /Actions for work/ });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Rename work', exact: true }).click();
    const titleInput = page.getByRole('textbox', { name: 'Work title', exact: true });
    await titleInput.fill(title);
    await titleInput.press('Enter');
    await expect.poll(() => updateBodies.length).toBe(expectedSaveCount);
    await expect(titleInput).toHaveCount(0);
  };

  await renameWork(savedWork.title, 1);
  await renameWork('Moonlit Regiment final', 2);

  expect(updateBodies[1]).toMatchObject({ expected_updated_at: savedWork.updated_at });
});

test('章名保存後の再取得が失敗しても次回保存は返却された更新時刻を使う', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  const savedChapter = {
    ...chapter,
    title: 'First movement revised',
    updated_at: '2026-04-26T00:00:01.000Z',
    version: 2,
  };
  const updateBodies: Array<Record<string, unknown>> = [];
  let rejectChapterRefresh = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/works/${work.id}/chapters` && request.method() === 'GET') {
      if (rejectChapterRefresh) {
        await route.fulfill({
          body: JSON.stringify({ code: 'TEMPORARY_FAILURE', message: 'refresh failed' }),
          contentType: 'application/json',
          status: 500,
        });
        return;
      }
      await route.fulfill({ body: JSON.stringify({ chapters: [chapter] }), contentType: 'application/json', status: 200 });
      return;
    }
    if (pathname === `/api/chapters/${chapter.id}` && request.method() === 'PUT') {
      updateBodies.push(request.postDataJSON() as Record<string, unknown>);
      rejectChapterRefresh = true;
      await route.fulfill({
        body: JSON.stringify({
          ...savedChapter,
          title: String(updateBodies.at(-1)?.title ?? savedChapter.title),
          updated_at: updateBodies.length === 1 ? savedChapter.updated_at : '2026-04-26T00:00:02.000Z',
          version: updateBodies.length + 1,
        }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await mockApi(route);
  });

  await page.goto('/');
  const renameChapter = async (title: string, expectedSaveCount: number): Promise<void> => {
    const trigger = page.getByRole('button', { name: /Actions for chapter/ });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Rename chapter', exact: true }).click();
    const titleInput = page.getByRole('textbox', { name: 'Chapter title', exact: true });
    await titleInput.fill(title);
    await titleInput.press('Enter');
    await expect.poll(() => updateBodies.length).toBe(expectedSaveCount);
    await expect(titleInput).toHaveCount(0);
  };

  await renameChapter(savedChapter.title, 1);
  await renameChapter('First movement final', 2);

  expect(updateBodies[1]).toMatchObject({ expected_updated_at: savedChapter.updated_at });
});

test('話の保存中に追加した入力を保存応答と再取得で上書きしない', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  const savedEpisode = {
    ...episode,
    story_input_mode: 'full',
    story_full_draft: 'Draft sent to the server',
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    updated_at: '2026-04-26T00:00:01.000Z',
    version: 2,
  };
  let completeSave = (): void => {
    throw new Error('Save gate was not initialized');
  };
  const saveGate = new Promise<void>((resolve) => {
    completeSave = resolve;
  });
  let saveStarted = false;
  let saveCompleted = false;
  let episodeListReads = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/chapters/${chapter.id}/episodes` && request.method() === 'GET') {
      episodeListReads += 1;
      await route.fulfill({
        body: JSON.stringify({ episodes: [saveCompleted ? savedEpisode : episode] }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname === `/api/episodes/${episode.id}` && request.method() === 'PUT') {
      saveStarted = true;
      await saveGate;
      saveCompleted = true;
      await route.fulfill({
        body: JSON.stringify(savedEpisode),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await mockApi(route);
  });

  await page.goto('/');
  const storyDraft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await storyDraft.fill('Draft sent to the server');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saveStarted).toBe(true);

  await storyDraft.fill('Draft typed after the save started');
  completeSave();

  await expect.poll(() => episodeListReads).toBeGreaterThan(1);
  await expect(storyDraft).toHaveValue('Draft typed after the save started');
});

test('話の保存中に選択を変えた場合は古い応答を別の話に反映しない', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  const secondEpisode = {
    ...episode,
    id: 'episode-2',
    order: 2,
    title: 'Departure',
    story_input_mode: 'full',
    story_full_draft: 'The second episode stays selected.',
  };
  const savedFirstEpisode = {
    ...episode,
    story_input_mode: 'full',
    story_full_draft: 'The first episode was saved.',
    updated_at: '2026-04-26T00:00:01.000Z',
    version: 2,
  };
  let completeSave = (): void => {
    throw new Error('Save gate was not initialized');
  };
  const saveGate = new Promise<void>((resolve) => {
    completeSave = resolve;
  });
  let saveStarted = false;
  let saveCompleted = false;
  let episodeListReads = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/chapters/${chapter.id}/episodes` && request.method() === 'GET') {
      episodeListReads += 1;
      await route.fulfill({
        body: JSON.stringify({ episodes: [saveCompleted ? savedFirstEpisode : episode, secondEpisode] }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname === `/api/episodes/${episode.id}` && request.method() === 'PUT') {
      saveStarted = true;
      await saveGate;
      saveCompleted = true;
      await route.fulfill({
        body: JSON.stringify(savedFirstEpisode),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await mockApi(route);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saveStarted).toBe(true);
  await page.getByRole('button', { name: '2 Departure', exact: true }).click();

  const storyDraft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await expect(storyDraft).toHaveValue('The second episode stays selected.');
  completeSave();

  await expect.poll(() => episodeListReads).toBeGreaterThan(1);
  await expect(page.getByRole('main').getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Departure');
  await expect(storyDraft).toHaveValue('The second episode stays selected.');
});

test('ページ設定を保存するとschema外の更新時刻を送らない', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  let updateBody: Record<string, unknown> | null = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/pages/${pageRecord.id}` && request.method() === 'PUT') {
      updateBody = request.postDataJSON() as Record<string, unknown>;
    }
    await mockApi(route);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const artDirectionSection = page.locator('.page-section-style-constraints');
  await artDirectionSection.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => updateBody).not.toBeNull();
  expect(updateBody).not.toHaveProperty('expected_updated_at');
  expect(updateBody).toMatchObject({
    dialogue_mode: pageRecord.dialogue_mode,
    page_dialogue_toggle: pageRecord.page_dialogue_toggle,
  });
});

test('キャラ編集では画像取り込みを自由記述の前に置き不要な詳細入力を隠す', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', mockApi);

  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  const editorSection = page
    .getByRole('heading', { name: 'Character editor', exact: true })
    .locator('xpath=ancestor::section[1]');

  await expect(editorSection.getByText('Import reference', { exact: true })).toBeVisible();
  await expect(editorSection.locator('input[type="file"]')).toHaveAttribute(
    'accept',
    'image/png,image/jpeg,image/webp',
  );

  const importPrecedesFreeDescription = await editorSection.evaluate((section) => {
    const importControl = section.querySelector('.entity-reference-import');
    const freeDescriptionLabel = Array.from(section.querySelectorAll('label.field')).find(
      (label) => label.querySelector('span')?.textContent === 'Free description',
    );
    if (importControl === null || freeDescriptionLabel === undefined) {
      return false;
    }
    return Boolean(importControl.compareDocumentPosition(freeDescriptionLabel) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(importPrecedesFreeDescription).toBe(true);

  await expect(editorSection.getByRole('textbox', { name: 'Prompt supplement', exact: true })).toHaveCount(0);
  await expect(editorSection.getByText('Anchors', { exact: true })).toHaveCount(0);

  const clothingDetails = editorSection.getByRole('textbox', { name: 'Clothing details', exact: true });
  await expect(clothingDetails).toBeVisible();
  await expect(clothingDetails).toHaveAttribute('placeholder', 'Describe the outfit in natural language');
  await expect(editorSection.getByRole('combobox', { name: 'Clothing details', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');
  await page.keyboard.press('Escape');

  const localizedEditorSection = page.locator('.character-editor-section');
  await expect(localizedEditorSection.getByText('レファレンス取り込み', { exact: true })).toBeVisible();
  await expect(localizedEditorSection.getByRole('textbox', { name: '自由記述', exact: true })).toBeVisible();
  await expect(localizedEditorSection.getByRole('textbox', { name: '服装の詳細', exact: true })).toHaveAttribute(
    'placeholder',
    '服装を自然な文章で入力してください。',
  );
  await expect(localizedEditorSection.getByText('補足プロンプト', { exact: true })).toHaveCount(0);
  await expect(localizedEditorSection.getByText('再現アンカー', { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('初心者向け案内とページ編集の情報境界を明確にする', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/api/pages/${pageRecord.id}/panels`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          panels: [
            {
              ...panel,
              entities: [
                {
                  entity_id: entity.id,
                  role: 'primary',
                  expression: 'neutral',
                  custom_expression: null,
                  action: 'standing',
                  custom_action: null,
                  position: 'center',
                  facing_direction: 'front',
                  effect_note: null,
                  state_id: null,
                },
              ],
              dialogue: [
                {
                  entity_id: entity.id,
                  text: 'We should go.',
                  type: 'speech',
                  position: 'top',
                },
              ],
            },
          ],
        }),
      });
    }
    return mockApi(route);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  const characterEditor = page.locator('.character-editor-section');
  await expect(
    characterEditor.getByText(
      'Upload a character image you already have. Lyra will use its appearance as a reference when creating your manga.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    characterEditor.getByText(
      'Use this box for details not covered by the choices, or for special instructions you want Lyra to follow.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Current episode selection', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current episode selection', exact: true })).toHaveCount(0);

  const pageStack = page.locator('.page-sections-stack');
  const artDirection = pageStack.locator('.page-section-style-constraints');
  await expect(artDirection.getByRole('heading', { name: 'Page art direction', exact: true })).toBeVisible();
  await expect(
    artDirection.getByText(
      'Keep generated pages visually consistent by adding an art reference and the desired linework, color, or mood.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(artDirection.getByRole('textbox', { name: 'Art style reference', exact: true })).toBeVisible();
  await expect(artDirection.getByRole('textbox', { name: 'Visual direction notes', exact: true })).toBeVisible();
  expect(
    await pageStack.evaluate((stack) => {
      const artSection = stack.querySelector('.page-section-style-constraints');
      const pagesSection = stack.querySelector('.page-section-pages');
      if (artSection === null || pagesSection === null) {
        return false;
      }
      return Boolean(artSection.compareDocumentPosition(pagesSection) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);

  await page.getByText('Advanced frame geometry', { exact: true }).click();
  await expect(
    page.getByText(
      'You can leave this unchanged. Adjust it only when you want precise control over panel shapes and placement.',
      { exact: true },
    ),
  ).toBeVisible();

  const characterGroup = page.locator('.panel-editor-group.character-assignment-editor');
  await expect(characterGroup).toBeVisible();
  await expect(characterGroup.locator('.character-assignment-card')).toContainText('Appearing character');
  await expect(characterGroup.locator('.character-assignment-card')).toContainText('Mizuki');

  const dialogueGroup = page.locator('.panel-editor-group.dialogue-editor');
  await expect(dialogueGroup).toBeVisible();
  await expect(dialogueGroup.locator('.dialogue-line-card')).toContainText('Dialogue 1');
  await expect(dialogueGroup.locator('.dialogue-line-card')).toContainText('Mizuki');
  const addDialogueButton = dialogueGroup.getByRole('button', { name: 'Add dialogue', exact: true });
  await expect(addDialogueButton).toBeVisible();
  await expect(dialogueGroup.getByRole('button', { name: 'Add line', exact: true })).toHaveCount(0);
  expect(
    await dialogueGroup.evaluate((group) => {
      const lastDialogue = group.querySelector('.dialogue-line-card:last-of-type');
      const addButton = group.querySelector('.dialogue-add-button');
      if (lastDialogue === null || addButton === null) {
        return false;
      }
      return Boolean(lastDialogue.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);

  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'キャラクター', exact: true }).click();
  await expect(
    page.getByText('手元のキャラクター画像をアップロードすると、その見た目を参考にLyraの漫画へ登場させられます。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('選択肢にない特徴や、特別に反映したい設定があればここに書いてください。', {
      exact: true,
    }),
  ).toBeVisible();
  const localizedEntityCard = page.locator('.list-grid .mini-card').filter({ hasText: 'Mizuki' });
  await expect(localizedEntityCard).toContainText('キャラクター');
  await expect(localizedEntityCard.getByText('character', { exact: true })).toHaveCount(0);
  for (const localizedCharacterLabel of [
    '眉の形',
    '鼻の形',
    '口の形',
    'まぶたの種類',
    '目の大きさ',
    '目尻の向き',
    '瞳孔の表現',
    '目元の特徴',
    '通常時の口元',
    '前髪の形',
    '横髪',
    '後ろ髪の形',
    '服装カテゴリ',
    'メインカラー',
    '服装の印象',
    '襟の形',
    '袖の長さ',
    'ボトムス',
    '靴',
    '靴下・脚まわり',
  ]) {
    await expect(page.getByRole('combobox', { name: localizedCharacterLabel, exact: true })).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'ページ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ページの絵柄・雰囲気', exact: true })).toBeVisible();
  await expect(page.locator('.character-assignment-card')).toBeVisible();
  await expect(page.locator('.dialogue-line-card')).toBeVisible();
  await expect(page.getByRole('button', { name: 'セリフを追加', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '行を追加', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('セリフ本文', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('ストーリー画面で各AI操作の役割とシーンが任意であることを説明する', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', mockApi);

  await page.goto('/');

  const pagePlanningSection = page
    .getByRole('heading', { name: 'Page planning', exact: true })
    .locator('xpath=ancestor::section[1]');
  await expect(
    pagePlanningSection.getByText('Use these two steps to turn the episode story into panel details.', { exact: true }),
  ).toBeVisible();
  await expect(pagePlanningSection.locator('.feature-guidance')).toContainText(
    '1. Regenerate page planBuilds the page and panel allocation and the overall story flow.',
  );
  await expect(pagePlanningSection.locator('.feature-guidance')).toContainText(
    '2. Apply story planFills each panel with characters, situation, composition, and dialogue based on that plan.',
  );
  await expect(
    page.getByText(
      'Story AI follows your instruction to improve the episode and rewrites it for reliable page and panel planning. Recommended before planning pages.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Set the location, time, and mood to keep backgrounds and atmosphere consistent across the episode. Scenes are optional; generation works without them.',
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');

  const localizedPagePlanningSection = page
    .getByRole('heading', { name: 'ページ設計', exact: true })
    .locator('xpath=ancestor::section[1]');
  await expect(
    localizedPagePlanningSection.getByText('入力したストーリーをコマへ反映する2段階の操作です。', { exact: true }),
  ).toBeVisible();
  await expect(localizedPagePlanningSection.locator('.feature-guidance')).toContainText(
    '1. ページ骨格を上書き再生成ストーリーをもとに、ページとコマの配分・全体の流れを組み立てます。',
  );
  await expect(localizedPagePlanningSection.locator('.feature-guidance')).toContainText(
    '2. 話全体を反映決めた配分に沿って、各コマの登場人物・状況・構図・セリフを自動入力します。',
  );
  await expect(
    page.getByText(
      '指示に沿って話を改善し、ページやコマへ分けやすい文章に整えます。ページ設計の前に使うのがおすすめです。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      '話全体の場所・時間帯・雰囲気をそろえ、ページをまたいだ背景の一貫性を高めます。未設定でも生成できます。',
      { exact: true },
    ),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('creates works from the sidebar without rendering a work overview editor', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);

  let createPayload: Record<string, unknown> | null = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/works' && request.method() === 'POST') {
      createPayload = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(work),
      });
    }
    return mockApi(route);
  });

  await page.goto('/');

  const sidebar = page.locator('aside.sidebar');
  await expect(sidebar.getByText('New work', { exact: true })).toBeVisible();
  const newWorkTitle = sidebar.getByRole('textbox', { name: 'Title', exact: true });
  await expect(newWorkTitle).toBeVisible();
  await expect(sidebar.getByRole('textbox', { name: 'Genre', exact: true })).toHaveCount(0);
  await expect(page.locator('main').getByText('New work', { exact: true })).toHaveCount(0);

  await newWorkTitle.fill('Sidebar work');
  await sidebar.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => createPayload).toMatchObject({ title: 'Sidebar work', genre: null });

  await expect(page.locator('main').getByText('Work overview', { exact: true })).toHaveCount(0);
  await expect(page.locator('.work-overview-section')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Genre', exact: true })).toHaveCount(0);
});

test('PCヘッダーで制作ナビと設定メニューを階層分離する', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', mockApi);

  await page.goto('/');

  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primaryNavigation).toBeVisible();
  await expect(primaryNavigation.getByRole('button')).toHaveCount(3);
  await expect(primaryNavigation.getByRole('button', { name: 'Story', exact: true })).toBeVisible();
  await expect(primaryNavigation.getByRole('button', { name: 'Entities', exact: true })).toBeVisible();
  await expect(primaryNavigation.getByRole('button', { name: 'Pages', exact: true })).toBeVisible();
  await expect(primaryNavigation.getByRole('button', { name: 'Workspace', exact: true })).toHaveCount(0);

  const sidebar = page.locator('aside.sidebar');
  await expect(sidebar.locator('.sidebar-workspace-switcher')).toContainText('Workspace');

  const accountMenuButton = page.getByRole('button', { name: 'Account menu', exact: true });
  await expect(accountMenuButton).toBeVisible();
  await accountMenuButton.click();

  const accountMenu = page.locator('.account-menu-popover');
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByRole('button', { name: 'Workspace settings', exact: true })).toBeVisible();
  const languageSelect = accountMenu.getByRole('combobox', { name: 'Language', exact: true });
  await expect(languageSelect).toBeVisible();
  await expect(accountMenu.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();

  await languageSelect.selectOption('ja');
  await expect(page.getByRole('navigation', { name: '制作ナビゲーション' })).toBeVisible();
  const localizedAccountMenuButton = page.getByRole('button', { name: 'アカウントメニュー', exact: true });
  await expect(localizedAccountMenuButton).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(accountMenu).toBeHidden();
  await expect(localizedAccountMenuButton).toBeFocused();
});

test('keeps the story hierarchy usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', mockApi);

  await page.goto('/');

  const sidebar = page.locator('aside.sidebar');
  await expect(sidebar.getByText('New work', { exact: true })).toBeVisible();
  await expect(sidebar.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Moonlit Regiment', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 First movement', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 Arrival', exact: true })).toBeVisible();

  await expect(page.getByRole('menuitem', { name: 'Rename chapter', exact: true })).toHaveCount(0);
  const workMenuTrigger = page.getByRole('button', { name: 'Actions for work “Moonlit Regiment”', exact: true });
  await workMenuTrigger.click();
  await expect(page.getByRole('menuitem', { name: 'Rename work', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add chapter', exact: true })).toBeVisible();
  const workMenu = page.getByRole('menu', {
    name: 'Actions for work “Moonlit Regiment”',
    exact: true,
  });
  await page.keyboard.press('Escape');
  await expect(workMenu).toHaveCount(0);
  await expect(workMenuTrigger).toBeFocused();

  const episodeMenuTrigger = page.getByRole('button', { name: 'Actions for episode “Arrival”', exact: true });
  await expect(episodeMenuTrigger).toBeVisible();

  const titleAndTriggerDoNotOverlap = await page.evaluate(() => {
    const title = document.querySelector<HTMLButtonElement>('.story-hierarchy-episode-row .story-hierarchy-title');
    const trigger = document.querySelector<HTMLButtonElement>('.story-hierarchy-episode-row .story-hierarchy-menu-trigger');
    if (title === null || trigger === null) {
      return false;
    }
    const titleRect = title.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    return titleRect.width >= 100 && titleRect.right <= triggerRect.left;
  });
  expect(titleAndTriggerDoNotOverlap).toBe(true);

  await episodeMenuTrigger.focus();
  await expect(episodeMenuTrigger).toBeFocused();
  await episodeMenuTrigger.press('ArrowDown');
  await expect(episodeMenuTrigger).toHaveAttribute('aria-expanded', 'true');
  const episodeMenu = page.getByRole('menu', { name: 'Actions for episode “Arrival”', exact: true });
  await expect(episodeMenu).toBeVisible();
  await expect(episodeMenu.getByRole('menuitem', { name: 'Move episode up', exact: true })).toBeDisabled();
  await expect(episodeMenu.getByRole('menuitem', { name: 'Move episode down', exact: true })).toBeDisabled();
  const renameEpisode = episodeMenu.getByRole('menuitem', { name: 'Rename episode', exact: true });
  const deleteEpisode = episodeMenu.getByRole('menuitem', { name: 'Delete episode', exact: true });
  await expect(renameEpisode).toBeFocused();
  await page.keyboard.press('End');
  await expect(deleteEpisode).toBeFocused();
  await page.keyboard.press('Home');
  await expect(renameEpisode).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(episodeMenu).toHaveCount(0);
  await expect(episodeMenuTrigger).toBeFocused();
  await expect(episodeMenuTrigger).toHaveAttribute('aria-expanded', 'false');

  await episodeMenuTrigger.click();
  await page.getByRole('menuitem', { name: 'Rename episode', exact: true }).click();
  const episodeTitleInput = page.getByRole('textbox', { name: 'Episode title', exact: true });
  await expect(episodeTitleInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '1 Arrival', exact: true })).toBeVisible();

  const chapterMenuTrigger = page.getByRole('button', { name: 'Actions for chapter “First movement”', exact: true });
  await chapterMenuTrigger.click();
  await expect(page.getByRole('menuitem', { name: 'Rename chapter', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add episode', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Move chapter up', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Move chapter down', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Delete chapter', exact: true })).toBeVisible();
  await page.mouse.click(380, 800);
  await expect(page.getByRole('menuitem', { name: 'Add episode', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('stops a queued story apply job and removes it from local history', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await seedTrackedJobs(page, [cancellableStoryJobId]);
  await page.route('**/api/**', mockApi);

  await page.goto('/');

  const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
  await expect(stopButton).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await stopButton.click();

  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  const removeButton = page.getByRole('button', { name: 'Remove from job history' });
  await expect(removeButton).toBeVisible();
  await removeButton.click();
  await expect(page.getByText('No recent jobs.')).toBeVisible();
});

test('keeps stop available when a rolling API response omits cancellation fields', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await seedTrackedJobs(page, [cancellableStoryJobId], legacyTrackedJobsStorageKey);
  await page.route('**/api/**', (route) =>
    mockApi(route, { legacyJobCancellationFields: true }),
  );

  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await expect(page.getByText('Saving has started, so this job can no longer be stopped.')).toHaveCount(0);
});

test('keeps the console usable with a legacy billing response', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockApi(route, { legacyBilling: true }));

  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Moonlit Regiment', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Story', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
