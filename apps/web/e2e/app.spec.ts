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
