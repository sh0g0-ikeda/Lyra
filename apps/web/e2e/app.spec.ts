import { expect, test as base, type ConsoleMessage, type Page, type Route } from '@playwright/test';
import type { CurrentSessionRecord, OrganizationWorkspaceRecord } from '../src/types/api';

// React's error boundary catches render failures before pageerror can report them.
// Keep both diagnostics in the mocked smoke gate and its failure artifacts.
const test = base.extend<{ browserRuntimeErrors: void }>({
  browserRuntimeErrors: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    const onPageError = (error: Error): void => { errors.push(error.stack ?? error.message); };
    const onConsoleError = (message: ConsoleMessage): void => {
      if (message.type() === 'error' && message.text().includes('Unexpected web render failure')) {
        errors.push(message.text());
      }
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsoleError);
    await use();
    page.off('pageerror', onPageError);
    page.off('console', onConsoleError);
    if (errors.length > 0) {
      await testInfo.attach('browser-runtime-errors', {
        body: errors.join('\n\n'),
        contentType: 'text/plain',
      });
    }
    expect(errors, 'The console must not throw or enter its render error boundary').toEqual([]);
  }, { auto: true }],
});

const manualTokenStorageKey = 'lyra:web:manual-token';
const uiLanguageStorageKey = 'lyra:web:ui-language';
const legacyTrackedJobsStorageKey = 'lyra:web:tracked-jobs:email:session';
const personalTrackedJobsStorageKey = `${legacyTrackedJobsStorageKey}:workspace:personal`;
const cancellableStoryJobId = '77777777-7777-4777-8777-777777777777';
const skeletonProgressJobId = '99999999-9999-4999-8999-999999999999';

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
  starting_entity_states: [
    {
      entity_id: 'entity-1',
      state_id: '88888888-8888-4888-8888-888888888888',
    },
  ],
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

const currentSession: CurrentSessionRecord = {
  user: {
    id: work.user_id,
    email: 'fixture@example.test',
    display_name: null,
    plan_code: 'free',
  },
  personal_credits: {
    monthly_credits: 100,
    purchased_credits: 40,
    total_credits: 140,
    monthly_expires_at: null,
  },
  organizations: [],
  capabilities: { web_image_delivery: false },
};

async function mockApi(
  route: Route,
  options: { legacyBilling?: boolean; legacyJobCancellationFields?: boolean; skeletonJobStatus?: 'queued' | 'processing' } = {},
): Promise<void> {
  const url = new URL(route.request().url());
  const { pathname } = url;

  const json = (body: unknown): Promise<void> =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  if (pathname === '/api/me') {
    return json(currentSession);
  }

  if (pathname === '/api/auth/capabilities') {
    return json({ google_sign_in: false, google_linking: false, google_ios: false });
  }

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

  if (pathname === `/api/pages/${pageRecord.id}` && route.request().method() === 'PUT') {
    return json(pageRecord);
  }
  if (pathname === `/api/panels/${panel.id}` && route.request().method() === 'PUT') {
    return json(panel);
  }
  if (pathname === `/api/panels/${panel.id}/entities` && route.request().method() === 'PUT') {
    return json({ entities: panel.entities });
  }

  if (pathname === `/api/works/${work.id}/entities`) {
    if (route.request().method() === 'GET') {
      return json({ entities: [entity] });
    }
    if (route.request().method() === 'POST') {
      return json(entity);
    }
  }

  if (pathname === `/api/entities/${entity.id}` && route.request().method() === 'PUT') {
    return json(entity);
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

  if (pathname === `/api/jobs/${skeletonProgressJobId}`) {
    return json({
      id: skeletonProgressJobId,
      job_type: 'episode_page_skeleton',
      status: options.skeletonJobStatus ?? 'queued',
      generation_mode: null,
      credit_cost: 0,
      params: { episode_id: episode.id, language: 'ja' },
      result: {},
      error_message: null,
      retry_count: 0,
      created_at: '2026-04-26T00:00:00.000Z',
      started_at: null,
      completed_at: null,
      expires_at: null,
      cancel_requested_at: null,
      cancelled_at: null,
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

function storyNavigationFixtures(): {
  works: Array<typeof work>;
  chapters: Record<string, Array<typeof chapter>>;
  episodes: Record<string, Array<typeof episode>>;
} {
  const secondWork = { ...work, id: 'work-2', title: 'Sunward Company' };
  const secondChapter = { ...chapter, id: 'chapter-2', work_id: work.id, order: 2, title: 'Second movement' };
  const otherWorkChapter = { ...chapter, id: 'chapter-3', work_id: secondWork.id, title: 'Sunward opening' };
  const secondEpisode = {
    ...episode,
    id: 'episode-2',
    order: 2,
    title: 'Countermarch',
    story_full_draft: 'Server text for the second episode.',
  };
  const otherWorkEpisode = {
    ...episode,
    id: 'episode-3',
    chapter_id: otherWorkChapter.id,
    title: 'Dawn patrol',
    story_full_draft: 'Server text for the other work.',
  };
  return {
    works: [work, secondWork],
    chapters: { [work.id]: [chapter, secondChapter], [secondWork.id]: [otherWorkChapter] },
    episodes: { [chapter.id]: [episode, secondEpisode], [secondChapter.id]: [secondEpisode], [otherWorkChapter.id]: [otherWorkEpisode] },
  };
}

async function mockStoryNavigationApi(
  route: Route,
  fixtures: ReturnType<typeof storyNavigationFixtures>,
  onEpisodePut?: (route: Route) => Promise<void>,
): Promise<void> {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === '/api/works' && request.method() === 'GET') {
    await route.fulfill({ json: { works: fixtures.works } });
    return;
  }
  const workMatch = /^\/api\/works\/([^/]+)\/chapters$/.exec(pathname);
  if (workMatch !== null && request.method() === 'GET') {
    await route.fulfill({ json: { chapters: fixtures.chapters[workMatch[1]] ?? [] } });
    return;
  }
  const chapterMatch = /^\/api\/chapters\/([^/]+)\/episodes$/.exec(pathname);
  if (chapterMatch !== null && request.method() === 'GET') {
    await route.fulfill({ json: { episodes: fixtures.episodes[chapterMatch[1]] ?? [] } });
    return;
  }
  if (/^\/api\/episodes\/[^/]+$/.test(pathname) && request.method() === 'PUT' && onEpisodePut !== undefined) {
    await onEpisodePut(route);
    return;
  }
  await mockApi(route);
}

const organizationWorkspace: OrganizationWorkspaceRecord = {
  organization: {
    id: 'organization-1', type: 'business', name: 'Studio North', legal_name: null, status: 'active',
    plan_key: 'enterprise_a', billing_email: null, created_by_user_id: work.user_id,
    created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-26T00:00:00.000Z',
  },
  membership: {
    id: 'membership-1', organization_id: 'organization-1', user_id: work.user_id, email: 'fixture@example.test',
    display_name: null, role: 'owner', status: 'active', invited_by_user_id: null, joined_at: '2026-04-26T00:00:00.000Z',
    created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-26T00:00:00.000Z',
  },
  balance: { monthly_credits: 100, purchased_credits: 40, total_credits: 140, monthly_expires_at: null },
};

async function mockStoryNavigationWithOrganizationApi(
  route: Route,
  fixtures: ReturnType<typeof storyNavigationFixtures>,
): Promise<void> {
  if (new URL(route.request().url()).pathname === '/api/organizations') {
    await route.fulfill({ json: { organizations: [organizationWorkspace] } });
    return;
  }
  await mockStoryNavigationApi(route, fixtures);
}

const secondEntity = {
  ...entity,
  id: 'entity-2',
  name: 'Rin',
  free_description: 'A scout with a red scarf.',
};

async function mockEntityDirtyApi(
  route: Route,
  onEntityPut?: (route: Route) => Promise<void>,
): Promise<void> {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === `/api/works/${work.id}/entities` && request.method() === 'GET') {
    await route.fulfill({ json: { entities: [entity, secondEntity] } });
    return;
  }
  if (/^\/api\/entities\/[^/]+\/reference-set$/.test(pathname) && request.method() === 'GET' && pathname !== `/api/entities/${entity.id}/reference-set`) {
    await route.fulfill({ json: { entity_id: pathname.split('/')[3], primary_ref_id: null, status: 'empty', updated_at: entity.updated_at, reference_images: [] } });
    return;
  }
  if (/^\/api\/entities\/[^/]+$/.test(pathname) && request.method() === 'PUT' && onEntityPut !== undefined) {
    await onEntityPut(route);
    return;
  }
  await mockApi(route);
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
  await page.route('**/api/**', (route) => mockApi(route));

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

test('未保存の話から別の話を選ぶ場合にCancelすると入力と選択を保持しPUTしない', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  let episodePutCount = 0;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures, async (pendingRoute) => {
    episodePutCount += 1;
    await pendingRoute.fulfill({ json: episode });
  }));
  await page.goto('/');

  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Unsaved full episode draft');
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toBe('Discard unsaved story changes and leave? Cancel keeps editing.');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: '2 Countermarch', exact: true }).click();

  await expect(draft).toHaveValue('Unsaved full episode draft');
  await expect(page.getByRole('button', { name: '1 Arrival', exact: true }).locator('xpath=..')).toHaveClass(/active/);
  expect(episodePutCount).toBe(0);
});

test('未保存の話を破棄して移動し戻る場合はサーバー本文へ戻りPUTしない', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  let episodePutCount = 0;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures, async (pendingRoute) => {
    episodePutCount += 1;
    await pendingRoute.fulfill({ json: episode });
  }));
  await page.goto('/');

  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Discard this local draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '2 Countermarch', exact: true }).click();
  await expect(draft).toHaveValue('Server text for the second episode.');
  await page.getByRole('button', { name: '1 Arrival', exact: true }).click();

  await expect(draft).toHaveValue('Arrival at the fort.\n\nA suspicious briefing.\n\nA duel in the rain.\n\nAn unseen observer.');
  expect(episodePutCount).toBe(0);
});

test('同じ話の再選択とタブ往復では未保存の本文を確認なしで保持する', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures));
  await page.goto('/');

  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Keep this draft across harmless navigation');
  page.on('dialog', (dialog) => { throw new Error(`unexpected ${dialog.type()} dialog: ${dialog.message()}`); });
  await page.getByRole('button', { name: '1 Arrival', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Story', exact: true }).click();

  await expect(draft).toHaveValue('Keep this draft across harmless navigation');
});

test('未保存の想定ページ数は章と作品の変更をCancelしても保持しPUTしない', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  let episodePutCount = 0;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures, async (pendingRoute) => {
    episodePutCount += 1;
    await pendingRoute.fulfill({ json: episode });
  }));
  await page.goto('/');

  const estimatedPages = page.getByRole('spinbutton', { name: 'Estimated pages', exact: true });
  await estimatedPages.fill('13');
  for (const target of ['2 Second movement', 'Sunward Company']) {
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: target, exact: true }).click();
    await expect(estimatedPages).toHaveValue('13');
  }
  expect(episodePutCount).toBe(0);
});

test('遅い保存の古い応答は後続の話入力を上書きしない', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  let releaseSave: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures, async (pendingRoute) => {
    await saveStarted;
    await pendingRoute.fulfill({ json: { ...episode, story_full_draft: 'Old server save response', version: 2 } });
  }));
  await page.goto('/');

  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('First save payload');
  const requestStarted = page.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname === `/api/episodes/${episode.id}`);
  const responseFinished = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/episodes/${episode.id}`);
  await page.locator('.episode-save-desktop').click();
  await requestStarted;
  await draft.fill('Later local edit must win');
  await page.getByRole('button', { name: '2 Countermarch', exact: true }).click();
  await expect(page.getByRole('button', { name: '1 Arrival', exact: true }).locator('xpath=..')).toHaveClass(/active/);
  releaseSave?.();
  await (await responseFinished).finished();
  await expect(page.locator('.episode-save-desktop')).toBeEnabled();
  await expect(draft).toHaveValue('Later local edit must win');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '2 Countermarch', exact: true }).click();
  await expect(draft).toHaveValue('Later local edit must win');
});

test('空の作品を経由して破棄後に戻る場合はサーバー本文へ戻り、その後の編集を再びguardする', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  fixtures.chapters['work-2'] = [];
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures));
  await page.goto('/');

  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Discard through empty work');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Sunward Company', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Episode draft', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Moonlit Regiment', exact: true }).click();

  await expect(draft).toHaveValue('Arrival at the fort.\n\nA suspicious briefing.\n\nA duel in the rain.\n\nAn unseen observer.');
  await draft.fill('Fresh edit after empty work roundtrip');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Discard unsaved story changes and leave? Cancel keeps editing.');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: '2 Countermarch', exact: true }).click();
  await expect(draft).toHaveValue('Fresh edit after empty work roundtrip');
});

test('desktop Scope と Account Current workspace は未保存話をCancelで保持し、破棄後の同一ID往復もguardする', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationWithOrganizationApi(route, fixtures));
  await page.goto('/');

  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  const desktopScope = page.locator('aside.sidebar').getByRole('combobox', { name: 'Scope', exact: true });
  await draft.fill('Keep through desktop scope cancel');
  page.once('dialog', (dialog) => dialog.dismiss());
  await desktopScope.selectOption(organizationWorkspace.organization.id);
  await expect(desktopScope).toHaveValue('');
  await expect(draft).toHaveValue('Keep through desktop scope cancel');

  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  const accountWorkspace = page.getByRole('heading', { name: 'Workspace', exact: true }).locator('xpath=ancestor::section[1]');
  const currentWorkspace = accountWorkspace.getByRole('combobox', { name: 'Current workspace', exact: true });
  page.once('dialog', (dialog) => dialog.dismiss());
  await currentWorkspace.selectOption(organizationWorkspace.organization.id);
  await expect(currentWorkspace).toHaveValue('');
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  await expect(draft).toHaveValue('Keep through desktop scope cancel');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await currentWorkspace.selectOption(organizationWorkspace.organization.id);
  await expect(currentWorkspace).toHaveValue(organizationWorkspace.organization.id);
  await desktopScope.selectOption('');
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  await expect(draft).toHaveValue('Arrival at the fort.\n\nA suspicious briefing.\n\nA duel in the rain.\n\nAn unseen observer.');
  await draft.fill('Guard after workspace roundtrip');
  page.once('dialog', (dialog) => dialog.dismiss());
  await desktopScope.selectOption(organizationWorkspace.organization.id);
  await expect(draft).toHaveValue('Guard after workspace roundtrip');
});

test('失敗した話の保存は本文を保持して再編集できる', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  let releasePages: (() => void) | undefined;
  const pagesPending = new Promise<void>((resolve) => { releasePages = resolve; });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === `/api/episodes/${episode.id}/pages`) {
      await pagesPending;
    }
    await mockStoryNavigationApi(route, fixtures, async (pendingRoute) => {
      await pendingRoute.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'save failed' } }) });
    });
  });
  const initialPagesRequest = page.waitForRequest((request) => request.method() === 'GET' && new URL(request.url()).pathname === `/api/episodes/${episode.id}/pages`);
  const initialPagesResponse = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/episodes/${episode.id}/pages`);
  await page.goto('/');
  await initialPagesRequest;

  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Keep after failed save');
  const failedResponse = page.waitForResponse((response) => response.status() === 500 && response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/episodes/${episode.id}`);
  await page.locator('.episode-save-desktop').click();
  await (await failedResponse).finished();
  releasePages?.();
  await (await initialPagesResponse).finished();
  await expect(page.locator('.notice.error')).toBeVisible();
  await expect(page.locator('.episode-save-desktop')).toBeEnabled();
  await expect(draft).toHaveValue('Keep after failed save');
  await draft.fill('Edited after failed save');
  await expect(draft).toHaveValue('Edited after failed save');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '2 Countermarch', exact: true }).click();
  await expect(draft).toHaveValue('Edited after failed save');
});

test('遅い話名変更の応答は変更中の本文を上書きしない', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  let releaseRename: (() => void) | undefined;
  const renamePending = new Promise<void>((resolve) => { releaseRename = resolve; });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures, async (pendingRoute) => {
    await renamePending;
    const renamed = { ...episode, title: 'Renamed arrival', version: 2 };
    fixtures.episodes[chapter.id] = [renamed, fixtures.episodes[chapter.id][1]];
    await pendingRoute.fulfill({ json: renamed });
  }));
  await page.goto('/');

  await page.getByRole('button', { name: 'Actions for episode “Arrival”', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename episode', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Episode title', exact: true });
  await title.fill('Renamed arrival');
  const renameRequest = page.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname === `/api/episodes/${episode.id}`);
  const renameResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/episodes/${episode.id}`);
  await title.press('Enter');
  await renameRequest;
  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Text edited while rename is pending');
  releaseRename?.();
  await (await renameResponse).finished();
  await expect(page.getByRole('button', { name: '1 Renamed arrival', exact: true })).toBeVisible();
  await expect(page.locator('.notice.success')).toBeVisible();
  await expect(draft).toHaveValue('Text edited while rename is pending');
});

test('作品作成待機中に話を編集した場合は新しい作品を自動選択せず本文を保持する', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  const createdWork = { ...work, id: 'work-created', title: 'Created while editing' };
  let releaseCreate: (() => void) | undefined;
  const createPending = new Promise<void>((resolve) => { releaseCreate = resolve; });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/works' && request.method() === 'POST') {
      await createPending;
      fixtures.works.push(createdWork);
      fixtures.chapters[createdWork.id] = [];
      await route.fulfill({ json: createdWork });
      return;
    }
    await mockStoryNavigationApi(route, fixtures);
  });
  await page.goto('/');

  const createForm = page.locator('.sidebar-create-disclosure form');
  await createForm.getByRole('textbox', { name: 'Title', exact: true }).fill(createdWork.title);
  const createRequest = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/works');
  const createResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/works');
  await createForm.getByRole('button', { name: 'Create', exact: true }).click();
  await createRequest;
  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Story edited while work creation is pending');
  releaseCreate?.();
  await (await createResponse).finished();
  await expect(page.getByRole('button', { name: createdWork.title, exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Your current edits are kept');
  await expect(draft).toHaveValue('Story edited while work creation is pending');
  await expect(page.getByRole('button', { name: 'Moonlit Regiment', exact: true }).locator('xpath=..')).toHaveClass(/active/);
});

test('未保存の話がある場合にブラウザ再読込をキャンセルすると入力を保持する', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures));
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Keep this draft when reload is cancelled');
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  const warning = page.waitForEvent('dialog');
  // A dismissed beforeunload deliberately prevents a navigation load event.
  const reloadRequested = page.evaluate(() => window.location.reload());
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reloadRequested;
  expect(navigations).toBe(0);
  await expect(draft).toHaveValue('Keep this draft when reload is cancelled');
});

test('同じ話のversionを再取得する場合に未保存本文を上書きしない', async ({ page, context }) => {
  const fixtures = storyNavigationFixtures();
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures));
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Keep local text across background refetch');
  const remote = { ...episode, story_full_draft: 'Updated remotely', version: 2 };
  fixtures.episodes[chapter.id] = [remote, fixtures.episodes[chapter.id][1]];
  // React Query intentionally treats data as fresh for 5 seconds in this app.
  await page.waitForTimeout(5_100);
  const refetched = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/chapters/${chapter.id}/episodes`);
  await context.setOffline(true);
  await context.setOffline(false);
  const response = await refetched;
  await response.finished();
  const body = await response.json() as { episodes: Array<{ version: number }> };
  expect(body.episodes[0].version).toBe(2);
  await expect(draft).toHaveValue('Keep local text across background refetch');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '2 Countermarch', exact: true }).click();
  await expect(draft).toHaveValue('Keep local text across background refetch');
});

test('保存済みの話を再編集せず切り替える場合は確認せず保存内容を保持する', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockStoryNavigationApi(route, fixtures, async (pendingRoute) => {
    const payload = pendingRoute.request().postDataJSON() as Record<string, unknown>;
    const saved = { ...episode, story_full_draft: String(payload.story_full_draft), version: 2 };
    fixtures.episodes[chapter.id] = [saved, fixtures.episodes[chapter.id][1]];
    await pendingRoute.fulfill({ json: saved });
  }));
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Whole story draft', exact: true });
  await draft.fill('Saved clean draft');
  const savedResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/episodes/${episode.id}`);
  await page.locator('.episode-save-desktop').click();
  await (await savedResponse).finished();
  await expect(page.locator('.notice.success')).toBeVisible();
  page.on('dialog', (dialog) => { throw new Error(`Unexpected ${dialog.type()} dialog after successful save`); });
  await page.getByRole('button', { name: '2 Countermarch', exact: true }).click();
  await expect(draft).toHaveValue('Server text for the second episode.');
  await page.getByRole('button', { name: '1 Arrival', exact: true }).click();
  await expect(draft).toHaveValue('Saved clean draft');
});

test('未保存キャラから別キャラを選ぶ場合にCancelすると入力と選択を保持しPUTしない', async ({ page }) => {
  let entityPutCount = 0;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockEntityDirtyApi(route, async (pendingRoute) => {
    entityPutCount += 1;
    await pendingRoute.fulfill({ json: entity });
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Mizuki');
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('Unsaved Mizuki description');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: /Rin/u }).click();

  await expect(description).toHaveValue('Unsaved Mizuki description');
  await expect(page.getByRole('button', { name: /^Mizuki\b/u })).toHaveClass(/active/);
  expect(entityPutCount).toBe(0);
});

test('同じキャラのreconnect refetchは未保存の自由記述を上書きしない', async ({ page }) => {
  let entityReads = 0;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === `/api/works/${work.id}/entities` && request.method() === 'GET') {
      entityReads += 1;
      await route.fulfill({ json: { entities: [{ ...entity, free_description: entityReads > 1 ? 'Updated remote character description' : entity.free_description, updated_at: `2026-04-26T00:00:0${entityReads}.000Z` }, secondEntity] } });
      return;
    }
    await mockEntityDirtyApi(route);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Mizuki');
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('Keep across entity refetch');
  // The query uses a five-second stale window before reconnect can trigger a fetch.
  await page.waitForTimeout(5_100);
  const refetched = page.waitForResponse((response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/works/${work.id}/entities`
  );
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  const response = await refetched;
  await response.finished();
  const body = await response.json() as { entities: Array<{ id: string; updated_at: string }> };
  expect(body.entities[0]).toMatchObject({
    id: entity.id,
    updated_at: '2026-04-26T00:00:02.000Z',
  });
  expect(entityReads).toBeGreaterThan(1);
  await expect(description).toHaveValue('Keep across entity refetch');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset draft', exact: true }).click();
  await expect(description).toHaveValue('Updated remote character description');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(entity.name);
});

test('遅いキャラ保存の応答は保存待機中の追加入力を上書きしない', async ({ page }) => {
  let releaseSave: (() => void) | undefined;
  const savePending = new Promise<void>((resolve) => { releaseSave = resolve; });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockEntityDirtyApi(route, async (pendingRoute) => {
    await savePending;
    await pendingRoute.fulfill({ json: { ...entity, free_description: 'Stale saved description', updated_at: '2026-04-26T00:00:02.000Z' } });
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Mizuki');
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('First entity save');
  const requestStarted = page.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname === `/api/entities/${entity.id}`);
  const responseFinished = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/entities/${entity.id}`);
  await page.getByRole('button', { name: 'Save character', exact: true }).click();
  await requestStarted;
  await description.fill('Later entity edit must win');
  releaseSave?.();
  await (await responseFinished).finished();
  await expect(page.locator('.notice.success')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save character', exact: true })).toBeEnabled();
  await expect(description).toHaveValue('Later entity edit must win');
});

test('未保存キャラを破棄して別キャラへ移動し戻る場合はサーバー値を復元しPUTしない', async ({ page }) => {
  let entityPutCount = 0;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockEntityDirtyApi(route, async (pendingRoute) => {
    entityPutCount += 1;
    await pendingRoute.fulfill({ json: entity });
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('Discard this character draft');
  let warnings = 0;
  page.once('dialog', (dialog) => { warnings += 1; return dialog.accept(); });
  await page.getByRole('button', { name: /Rin/u }).click();
  await expect(description).toHaveValue(secondEntity.free_description);
  expect(warnings).toBe(1);
  await page.getByRole('button', { name: /Mizuki/u }).click();
  await expect(description).toHaveValue(entity.free_description);
  expect(entityPutCount).toBe(0);
});

test('新規キャラdraftから既存キャラを選ぶ場合にCancelすると新規入力を保持する', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockEntityDirtyApi(route));
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Mizuki');
  await page.getByRole('button', { name: 'New character', exact: true }).first().click();

  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Unsaved new character');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: /Rin/u }).click();
  await expect(name).toHaveValue('Unsaved new character');
  await expect(page.getByText('Creating a new character. Saving here will add a new record and will not overwrite existing characters.', { exact: true })).toBeVisible();
});

test('キャラResetをCancelすると入力を保持し破棄確定後は同じ既存キャラへ戻る', async ({ page }) => {
  let writes = 0;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => {
    if (route.request().method() !== 'GET') writes += 1;
    return mockEntityDirtyApi(route);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(name).toHaveValue(entity.name);
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('Keep until Reset is confirmed');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Reset draft', exact: true }).click();
  await expect(description).toHaveValue('Keep until Reset is confirmed');
  await expect(name).toHaveValue(entity.name);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset draft', exact: true }).click();
  await expect(description).toHaveValue(entity.free_description);
  await expect(name).toHaveValue(entity.name);
  await expect(page.getByRole('button', { name: 'Save character', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create character', exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});

test('キャラ保存が失敗した場合に入力を保持して再編集と切替Cancelができる', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockEntityDirtyApi(route, async (pendingRoute) => {
    await pendingRoute.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'Temporary test failure' } } });
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('Failed save keeps this character');
  const response = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/entities/' + entity.id);
  await page.getByRole('button', { name: 'Save character', exact: true }).click();
  await (await response).finished();
  await expect(page.locator('.notice.error')).toBeVisible();
  await expect(description).toHaveValue('Failed save keeps this character');
  await description.fill('Editing again after the failure');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: /^Rin\b/u }).click();
  await expect(description).toHaveValue('Editing again after the failure');
});

test('キャラ保存を連打しても保存中は要求を一回だけ送る', async ({ page }) => {
  let puts = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockEntityDirtyApi(route, async (r) => {
    puts += 1;
    await pending;
    await r.fulfill({ json: { ...entity, updated_at: '2026-04-26T00:00:02.000Z' } });
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(entity.name);
  const request = page.waitForRequest((r) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/entities/' + entity.id);
  const response = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/entities/' + entity.id);
  const save = page.getByRole('button', { name: 'Save character', exact: true });
  await save.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('Expected the character save button');
    button.click();
    button.click();
  });
  await request;
  const disabledDuringSave = await save.isDisabled();
  release?.();
  await (await response).finished();
  await expect(page.locator('.notice.success')).toBeVisible();
  expect(disabledDuringSave).toBe(true);
  expect(puts).toBe(1);
  await expect(save).toBeEnabled();
});

test('キャラ作成待機中の追加入力は作成成功後も新しいキャラの下書きに残す', async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let created: typeof entity | undefined;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (pathname === '/api/works/' + work.id + '/entities' && request.method() === 'POST') {
      const payload = request.postDataJSON() as { name: string; free_description: string };
      await pending;
      created = { ...entity, id: 'entity-created', name: payload.name, free_description: payload.free_description, updated_at: '2026-04-26T00:00:02.000Z' };
      await route.fulfill({ json: created });
      return;
    }
    if (pathname === '/api/works/' + work.id + '/entities' && request.method() === 'GET') {
      await route.fulfill({ json: { entities: created === undefined ? [entity, secondEntity] : [created, entity, secondEntity] } });
      return;
    }
    await mockEntityDirtyApi(route);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(entity.name);
  await page.getByRole('button', { name: 'New character', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Created test character');
  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await description.fill('Submitted description');
  const request = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/works/' + work.id + '/entities');
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/works/' + work.id + '/entities');
  await page.getByRole('button', { name: 'Create character', exact: true }).click();
  await request;
  await description.fill('New text typed while creating');
  release?.();
  await (await response).finished();
  await expect(page.locator('.notice.success')).toBeVisible();
  await expect(description).toHaveValue('New text typed while creating');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Created test character');
  await expect(page.getByRole('button', { name: 'Save character', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create character', exact: true })).toHaveCount(0);
});

test('キャラ保存済みの入力を変えず切替える場合は確認せず保存内容を表示する', async ({ page }) => {
  let saved = entity;
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (pathname === '/api/works/' + work.id + '/entities' && request.method() === 'GET') {
      await route.fulfill({ json: { entities: [saved, secondEntity] } });return;
    }
    await mockEntityDirtyApi(route, async (r) => {
      const payload = r.request().postDataJSON() as { free_description: string };
      saved = { ...entity, free_description: payload.free_description, updated_at: '2026-04-26T00:00:02.000Z' };
      await r.fulfill({ json: saved });
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('Clean saved character');
  const response = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/entities/' + entity.id);
  await page.getByRole('button', { name: 'Save character', exact: true }).click();
  await (await response).finished();
  await expect(page.locator('.notice.success')).toBeVisible();
  page.on('dialog', () => { throw new Error('A clean saved character must not trigger discard confirmation'); });
  await page.getByRole('button', { name: /^Rin\b/u }).click();
  await expect(description).toHaveValue(secondEntity.free_description);
  await page.getByRole('button', { name: /^Mizuki\b/u }).click();
  await expect(description).toHaveValue('Clean saved character');
});

test('キャラの未保存入力がある場合にworkspaceと別作品の切替Cancelは入力を保持する', async ({ page }) => {
  const fixtures = storyNavigationFixtures();
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/works/' + work.id + '/entities' || pathname.startsWith('/api/entities/')) {
      await mockEntityDirtyApi(route);return;
    }
    await mockStoryNavigationWithOrganizationApi(route, fixtures);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('Keep character through context cancellation');
  const scope = page.locator('aside.sidebar').getByRole('combobox', { name: 'Scope', exact: true });
  page.once('dialog', (dialog) => dialog.dismiss());
  await scope.selectOption(organizationWorkspace.organization.id);
  await expect(scope).toHaveValue('');
  await expect(description).toHaveValue('Keep character through context cancellation');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: fixtures.works[1].title, exact: true }).click();
  await expect(description).toHaveValue('Keep character through context cancellation');
});

test('キャラの未保存入力がある場合にブラウザ再読込をCancelすると入力を保持する', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockEntityDirtyApi(route));
  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(description).toHaveValue(entity.free_description);
  await description.fill('Keep character through reload cancellation');
  let navigations = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1; });
  const warning = page.waitForEvent('dialog');
  const requested = page.evaluate(() => window.location.reload());
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await requested;
  expect(navigations).toBe(0);
  await expect(description).toHaveValue('Keep character through reload cancellation');
});

test('Mobileが保存した開始状態を旧Webの話とbaseキャラ保存で消さない', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockApi(route));

  await page.goto('/');

  const episodeSection = page
    .getByRole('heading', { name: 'Episode draft', exact: true })
    .locator('xpath=ancestor::section[1]');
  const episodeRequestPromise = page.waitForRequest((request) =>
    request.method() === 'PUT' &&
    new URL(request.url()).pathname === `/api/episodes/${episode.id}`
  );
  const episodeResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'PUT' &&
    new URL(response.url()).pathname === `/api/episodes/${episode.id}`
  );
  await episodeSection.locator('.episode-save-desktop').click();
  const episodePayload = (await episodeRequestPromise).postDataJSON() as Record<string, unknown>;
  await (await episodeResponsePromise).finished();

  expect(episodePayload).not.toHaveProperty('starting_entity_states');

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const characterEditor = page
    .getByRole('heading', { name: 'Character editor', exact: true })
    .locator('xpath=ancestor::section[1]');
  const entityRequestPromise = page.waitForRequest((request) =>
    request.method() === 'PUT' &&
    new URL(request.url()).pathname === `/api/entities/${entity.id}`
  );
  await characterEditor.getByRole('button', { name: 'Save character', exact: true }).click();
  const entityPayload = (await entityRequestPromise).postDataJSON() as Record<string, unknown>;

  expect(Object.keys(entityPayload).sort()).toEqual([
    'entity_type',
    'free_description',
    'name',
    'prompt_supplement',
    'speech_profile',
    'structured_fields',
  ]);
});

test('キャラ編集では画像取り込みを自由記述の前に置き不要な詳細入力を隠す', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockApi(route));

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
      const generationSection = stack.querySelector('.page-section-generate');
      const artSection = stack.querySelector('.page-section-style-constraints');
      if (generationSection === null || artSection === null) {
        return false;
      }
      return Boolean(generationSection.compareDocumentPosition(artSection) & Node.DOCUMENT_POSITION_FOLLOWING);
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

test('ストーリー画面でストーリーAIとシーンが任意であることを説明する', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockApi(route));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Page planning', exact: true })).toHaveCount(0);
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

  await expect(page.getByRole('heading', { name: 'ページ設計', exact: true })).toHaveCount(0);
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

test('ページ設計とページ生成の操作をページ編集の保存導線に並べる', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockApi(route));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Page planning', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pages', exact: true }).click();

  const pagePlanningSection = page
    .getByRole('heading', { name: 'Page planning', exact: true })
    .locator('xpath=ancestor::section[1]');
  await expect(
    pagePlanningSection.getByText('Use these two steps to turn the episode story into panel details.', { exact: true }),
  ).toBeVisible();
  await expect(pagePlanningSection.getByRole('button', { name: 'Regenerate page plan', exact: true })).toBeVisible();
  await expect(
    pagePlanningSection.getByRole('button', { name: 'Autofill page settings from story', exact: true }),
  ).toBeVisible();

  const pageStack = page.locator('.page-sections-stack');
  await expect(pageStack.locator('.page-section-frames-panels + .page-section-generate')).toHaveCount(1);
  await expect(pageStack.locator('.page-section-generate + .page-section-style-constraints')).toHaveCount(1);
  await expect(pageStack.locator('.page-section-generate').getByRole('button', { name: 'Generate in color', exact: true })).toBeVisible();
  await expect(pageStack.locator('.page-section-generate').getByRole('button', { name: 'Generate monochrome page', exact: true })).toBeVisible();
  await expect(pageStack.locator('.page-section-generate .generated-image')).toHaveCount(1);
  // Hy4 has no verified image API contract: preparation must never start a job.
  const flexibleGeneration = page.getByRole('region', { name: 'More flexible generation', exact: true });
  await expect(flexibleGeneration.getByRole('button', { name: 'Generate in color (Hy4 Preview)', exact: true })).toBeDisabled();
  await expect(flexibleGeneration.getByRole('button', { name: 'Generate in black and white (Hy4 Preview)', exact: true })).toBeDisabled();
  await expect(flexibleGeneration.getByText('We are checking the Hy4 Preview image generation and reference-image editing API. It is not available yet.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');
  await expect(page.getByRole('heading', { name: 'ページ設計', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ストーリーから設定を自動入力', exact: true })).toBeVisible();
  await expect(pageStack.locator('.page-section-generate').getByRole('button', { name: 'カラー生成', exact: true })).toBeVisible();
  await expect(pageStack.locator('.page-section-generate').getByRole('button', { name: '白黒で生成', exact: true })).toBeVisible();
  const flexibleGenerationJa = page.getByRole('region', { name: 'より自由な生成', exact: true });
  await expect(flexibleGenerationJa.getByRole('button', { name: 'カラー生成（Hy4 Preview）', exact: true })).toBeDisabled();
  await expect(flexibleGenerationJa.getByRole('button', { name: '白黒で生成（Hy4 Preview）', exact: true })).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(pageStack.locator('.page-section-generate').getByRole('button', { name: '白黒で生成', exact: true })).toBeVisible();
});

test('キャラ画面ではHy4 PreviewをWeb限定の自由生成として案内し、未設定時に受付しない', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  let providerOrAdmissionPosts = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (pathname.includes('hy4') || pathname.includes('generate-reference') || pathname.includes('generation-quotes'))) {
      providerOrAdmissionPosts += 1;
    }
    await mockApi(route);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  const flexibleGeneration = page.getByRole('region', { name: 'More flexible generation', exact: true });
  await expect(flexibleGeneration.getByText('More flexible generation: Hy4 Preview (Tencent). Requests and references are not sent to OpenAI image models. Images are available only on the web.', { exact: true })).toBeVisible();
  await expect(flexibleGeneration.getByRole('button', { name: 'Generate in color (Hy4 Preview)', exact: true })).toBeDisabled();
  await expect(flexibleGeneration.getByRole('button', { name: 'Generate in black and white (Hy4 Preview)', exact: true })).toBeDisabled();
  await expect(page.getByText('Standard generation: GPT Image 2 (OpenAI)', { exact: true })).toBeVisible();
  expect(providerOrAdmissionPosts).toBe(0);

  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');
  const flexibleGenerationJa = page.getByRole('region', { name: 'より自由な生成', exact: true });
  await expect(flexibleGenerationJa.getByText('自由生成：Hy4 Preview（Tencent）。依頼と参照画像はOpenAIの画像モデルへ送らず、作成した画像はweb版でのみ利用できます。', { exact: true })).toBeVisible();
  await expect(page.getByText('通常生成：GPT Image 2（OpenAI）', { exact: true })).toBeVisible();
});

test('Hy4確定キャラを使うページ生成は通常CTAを止め、キャラ設定へ案内する', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  let generationRequests = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/pages/${pageRecord.id}/generation-readiness`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ready: false,
          blockers: [{
            code: 'CHARACTER_REFERENCE_MODEL_INCOMPATIBLE',
            entity_id: entity.id,
            field: 'entities',
            action: 'open_characters',
            message_key: 'page.blocker.characterReferenceModelIncompatible',
          }],
          warnings: [],
          estimated_credit_cost: 3,
          page_revision: pageRecord.updated_at,
        }),
      });
      return;
    }
    if (request.method() === 'POST' && pathname === `/api/pages/${pageRecord.id}/generate`) {
      generationRequests += 1;
    }
    await mockApi(route);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Generate in color', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Generate monochrome page', exact: true })).toBeDisabled();
  await expect(page.getByText('Characters confirmed with flexible generation cannot be used for standard page generation. Generate and confirm a standard preview to use standard page generation again.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open characters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Character editor', exact: true })).toBeVisible();
  expect(generationRequests).toBe(0);
});

test('Hy4確定レファレンスはWeb限定バッジを表示し、通常画像URLを要求しない', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  let regularReferenceImageRequests = 0;
  let rawCdnRequests = 0;
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/api/entities/${entity.id}/reference-set`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entity_id: entity.id,
          primary_ref_id: 'hy4-ref-1',
          status: 'ready',
          updated_at: entity.updated_at,
          reference_images: [{
            ref_id: 'hy4-ref-1',
            image_model: 'hy4-preview',
            provider_model_id: 'hy4-preview',
            provider: 'tencent',
            mobile_access: 'web_only',
            source: 'generated',
            created_at: entity.updated_at,
          }],
        }),
      });
      return;
    }
    if (pathname.includes('/reference/') && pathname.endsWith('/image')) {
      regularReferenceImageRequests += 1;
    }
    await mockApi(route);
  });
  await page.route('https://cdn.example.test/**', async (route) => {
    rawCdnRequests += 1;
    await route.abort();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  await expect(page.getByText('Hy4 Preview · Web only', { exact: true })).toBeVisible();
  await expect(page.getByText('https://cdn.example.test/ref-1.png', { exact: true })).toHaveCount(0);
  expect(regularReferenceImageRequests).toBe(0);
  expect(rawCdnRequests).toBe(0);
});

test('Hy4生成候補はWeb配信権限なしでは通常候補画像口とCDNを使わない', async ({ page }) => {
  const jobId = '99999999-9999-4999-8999-999999999999';
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await seedTrackedJobs(page, [jobId]);
  let regularCandidateImageRequests = 0;
  let rawCdnRequests = 0;
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/api/jobs/${jobId}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: jobId,
          job_type: 'entity_generate',
          status: 'completed',
          generation_mode: null,
          credit_cost: 1,
          params: { entity_id: entity.id },
          result: {
            image_model: 'hy4-preview',
            provider_model_id: 'hy4-preview',
            provider: 'tencent',
            candidates: [{ candidate_token: 'hy4-candidate', cdn_url: 'https://cdn.example.test/hy4-candidate.png' }],
          },
          error_message: null,
          retry_count: 0,
          created_at: entity.updated_at,
          started_at: entity.updated_at,
          completed_at: entity.updated_at,
          expires_at: null,
          cancel_requested_at: null,
          cancel_requested_by: null,
          cancelled_at: null,
          commit_started_at: null,
        }),
      });
      return;
    }
    if (pathname.includes('/reference-candidate-image')) {
      regularCandidateImageRequests += 1;
    }
    await mockApi(route);
  });
  await page.route('https://cdn.example.test/**', async (route) => {
    rawCdnRequests += 1;
    await route.abort();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  await expect(page.getByText('This image cannot be viewed or saved in this session. You can continue editing the work and page.', { exact: true })).toBeVisible();
  expect(regularCandidateImageRequests).toBe(0);
  expect(rawCdnRequests).toBe(0);
});

test('白黒で生成は保存後に白黒指定のページjobを送る', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === `/api/pages/${pageRecord.id}/generate`) {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 'job-monochrome' }),
      });
      return;
    }
    await mockApi(route);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const generationRequest = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === `/api/pages/${pageRecord.id}/generate`,
  );
  await page.getByRole('button', { name: 'Generate monochrome page', exact: true }).click();
  const request = await generationRequest;

  expect(request.postDataJSON()).toEqual({ render_style: 'monochrome' });
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
  await page.route('**/api/**', (route) => mockApi(route));

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
  await page.route('**/api/**', (route) => mockApi(route));

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
  await workMenuTrigger.focus();
  await expect(workMenuTrigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Actions for work “Moonlit Regiment”', exact: true })).toHaveCount(0);
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
  await page.keyboard.press('ArrowDown');
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
  await page.setViewportSize({ width: 761, height: 844 });
  await expect(deleteEpisode).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
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

test('スマホWebで作品一覧と編集操作を作業導線に合わせて配置する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockApi(route));

  await page.goto('/');

  const sidebar = page.locator('aside.sidebar');
  await expect(sidebar.locator('.sidebar-workspace-switcher')).toBeHidden();

  const worksToggle = sidebar.getByRole('button', { name: 'Collapse works', exact: true });
  const worksContent = sidebar.locator('.sidebar-works-content');
  await expect(worksToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(worksContent).toBeVisible();
  await worksToggle.click();
  await expect(sidebar.getByRole('button', { name: 'Expand works', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(worksContent).toBeHidden();

  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await mobileNavigation.getByRole('button', { name: 'Account', exact: true }).click();
  const accountWorkspace = page
    .getByRole('heading', { name: 'Workspace', exact: true })
    .locator('xpath=ancestor::section[1]');
  await expect(accountWorkspace).toBeVisible();
  // Spec §5: both rollout configurations preserve personal access. When the
  // organization UI is enabled, verify its actual selected scope and action.
  const organizationFeaturesEnabled = process.env.VITE_ORGANIZATION_FEATURES_ENABLED?.trim().toLowerCase() === 'true';
  if (organizationFeaturesEnabled) {
    await expect(accountWorkspace.getByRole('combobox')).toHaveValue('');
    await expect(accountWorkspace.getByRole('combobox').locator('option:checked')).toHaveText('Personal');
    await expect(accountWorkspace.getByRole('button', { name: 'Create organization', exact: true })).toBeVisible();
  } else {
    await expect(accountWorkspace).toContainText('Personal use is available now.');
    await expect(accountWorkspace.getByRole('combobox')).toHaveCount(0);
    await expect(accountWorkspace.getByRole('button', { name: 'Create organization', exact: true })).toHaveCount(0);
  }

  await mobileNavigation.getByRole('button', { name: 'Story', exact: true }).click();
  const episodeSection = page
    .getByRole('heading', { name: 'Episode draft', exact: true })
    .locator('xpath=ancestor::section[1]');
  const storyAiSection = page
    .getByRole('heading', { name: 'Story AI', exact: true })
    .locator('xpath=ancestor::section[1]');
  const mobileEpisodeSave = episodeSection.locator('.episode-save-mobile');
  await expect(storyAiSection).toBeVisible();
  await expect(episodeSection.locator('.episode-save-desktop')).toBeHidden();
  await expect(mobileEpisodeSave).toBeVisible();
  expect(
    await mobileEpisodeSave.evaluate((save) => {
      const storyAi = document.querySelector('.story-ai-section');
      return storyAi !== null && Boolean(save.compareDocumentPosition(storyAi) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);

  await mobileNavigation.getByRole('button', { name: 'Entities', exact: true }).click();
  const characterList = page
    .getByRole('heading', { name: 'Character list', exact: true })
    .locator('xpath=ancestor::section[1]');
  const characterEditor = page
    .getByRole('heading', { name: 'Character editor', exact: true })
    .locator('xpath=ancestor::section[1]');
  await expect(characterList.locator('.desktop-character-list-new-action')).toBeHidden();
  await expect(
    characterEditor.locator('.mobile-character-editor-new-action').getByText('New character', { exact: true }),
  ).toBeVisible();
  await expect(characterEditor.getByRole('button', { name: 'Reset draft', exact: true })).toBeVisible();
  await expect(characterEditor.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar.locator('.sidebar-workspace-switcher')).toBeVisible();
  await expect(sidebar.locator('.mobile-works-toggle')).toBeHidden();
  await expect(characterList.locator('.desktop-character-list-new-action')).toBeVisible();
  await expect(characterEditor.locator('.mobile-character-editor-new-action')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await mobileNavigation.getByRole('button', { name: 'Guide', exact: true }).click();
  await expect(
    page.getByText(
      'On desktop, change workspace in the left sidebar. On mobile, open Account to change workspace.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'On mobile, Save is directly before Story AI. On desktop, Save remains in the episode header.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'On desktop, use New character in Character list. On mobile, use New character beside Reset draft and Delete in Character editor.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'After creating the needed characters, open Page planning at the top of Pages and use Generate page plan.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('stops a queued story apply job and removes it from local history', async ({ page }) => {
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await seedTrackedJobs(page, [cancellableStoryJobId]);
  await page.route('**/api/**', (route) => mockApi(route));

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
  await seedEnglishUi(page);
  await seedAuthenticatedSession(page);
  await page.route('**/api/**', (route) => mockApi(route, { legacyBilling: true }));

  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Moonlit Regiment', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Story', exact: true })).toBeVisible();
});

for (const [caseName, session] of [
  ['user omitted', {}],
  ['user null', { ...currentSession, user: null }],
] as const) {
  test(`keeps editing available and Google linking hidden with ${caseName} in the session response`, async ({ page }) => {
    await seedEnglishUi(page);
    await seedAuthenticatedSession(page);
    await page.route('**/api/**', (route) => {
      if (new URL(route.request().url()).pathname === '/api/me') {
        return route.fulfill({ json: session });
      }
      return mockApi(route);
    });

    const sessionResponse = page.waitForResponse('**/api/me');
    await page.goto('/?account=google-link');
    await (await sessionResponse).finished();

    await expect(page.getByRole('button', { name: 'Moonlit Regiment', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify existing login and link Google' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Situation' })).toHaveValue('Mizuki enters the fort.');
    await expect(page.getByRole('heading', { name: 'The screen could not be displayed' })).toHaveCount(0);
  });
}

for (const width of [1440, 390]) {
  test(`画面下部の生成が拒否された場合にエラー案内が見える (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedEnglishUi(page);
    await seedAuthenticatedSession(page);
    let generationRequests = 0;
    await page.route('**/api/**', async (route) => {
      if (new URL(route.request().url()).pathname === `/api/pages/${pageRecord.id}/generate`) {
        expect(route.request().postDataJSON()).toBeNull();
        generationRequests += 1;
        await route.fulfill({ status: 429, contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded for generation. Retry after 30 seconds' } }) });
        return;
      }
      await mockApi(route);
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    const generate = page.getByRole('button', { name: 'Generate in color', exact: true });
    await generate.scrollIntoViewIfNeeded();
    await generate.click();
    const errorNotice = page.locator('.notice.error');
    await expect(errorNotice).toBeVisible();
    await expect.poll(() => errorNotice.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.y >= 0 && rect.y + rect.height <= window.innerHeight && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await expect(errorNotice).toHaveAttribute('role', 'alert');
    await expect(generate).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Generate monochrome page', exact: true })).toBeEnabled();
    expect(generationRequests).toBe(1);
  });
}

test('jaではページ骨格生成の待機中と処理中を自動入力と混同せず表示する', async ({ page }) => {
  await seedAuthenticatedSession(page);
  await seedTrackedJobs(page, [skeletonProgressJobId]);
  await page.route('**/api/**', (route) => mockApi(route, { skeletonJobStatus: 'queued' }));

  await page.goto('/');
  await page.getByRole('button', { name: '1 Arrival', exact: true }).click();
  await page.getByRole('button', { name: 'ページ', exact: true }).click();

  await expect(page.getByText('ページ骨格生成', { exact: true })).toBeVisible();
  await expect(page.getByText('ページ骨格生成を待機しています。この処理は20分程度かかる場合があります。', { exact: true })).toBeVisible();
  await expect(page.getByText('ストーリーからページとコマの設定を自動入力しています。この処理は20分程度かかる場合があります。', { exact: true })).toHaveCount(0);
});

test('jaではページ骨格生成の処理中fallbackを表示する', async ({ page }) => {
  await seedAuthenticatedSession(page);
  await seedTrackedJobs(page, [skeletonProgressJobId]);
  await page.route('**/api/**', (route) => mockApi(route, { skeletonJobStatus: 'processing' }));

  await page.goto('/');
  await page.getByRole('button', { name: '1 Arrival', exact: true }).click();
  await page.getByRole('button', { name: 'ページ', exact: true }).click();

  await expect(page.getByText('ページ骨格を生成しています。この処理は20分程度かかる場合があります。', { exact: true })).toBeVisible();
  await expect(page.getByText('ストーリーからページとコマの設定を自動入力しています。この処理は20分程度かかる場合があります。', { exact: true })).toHaveCount(0);
});


// Automatic list changes must not discard a local draft or treat it as a new record.
test('外部更新で選択中キャラが消えた場合に未保存入力を保持し新規作成へ変えない', async ({ page }) => {
  let removed = false;
  await seedEnglishUi(page); await seedAuthenticatedSession(page);
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/works/' + work.id + '/entities' && route.request().method() === 'GET') {
      await route.fulfill({ json: { entities: removed ? [secondEntity] : [entity, secondEntity] } }); return;
    }
    await mockEntityDirtyApi(route);
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const draft=page.getByRole('textbox', { name: 'Free description', exact: true });
  await expect(draft).toHaveValue(entity.free_description); await draft.fill('Keep externally removed character draft');
  removed=true; await page.waitForTimeout(5100);
  const fetched=page.waitForResponse(r=>r.request().method()==='GET' && new URL(r.url()).pathname==='/api/works/'+work.id+'/entities');
  await page.context().setOffline(true); await page.context().setOffline(false); await (await fetched).finished();
  await expect(draft).toHaveValue('Keep externally removed character draft');
  await expect(page.getByRole('button',{name:'Create character',exact:true})).toHaveCount(0);
  page.once('dialog',d=>d.dismiss()); await page.getByRole('button',{name:'Rin Character',exact:true}).click();
  await expect(draft).toHaveValue('Keep externally removed character draft');
});

test('外部更新で選択中作品が消えた場合に未保存キャラを別作品へ移さない', async ({ page }) => {
  const fixtures=storyNavigationFixtures(); let removed=false;
  await seedEnglishUi(page); await seedAuthenticatedSession(page);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/works' && route.request().method()==='GET') {await route.fulfill({json:{works:removed?fixtures.works.slice(1):fixtures.works}});return;}
    if(path==='/api/works/'+work.id+'/entities') {await mockEntityDirtyApi(route);return;}
    await mockStoryNavigationApi(route,fixtures);
  });
  await page.goto('/'); await page.getByRole('button',{name:'Entities',exact:true}).click();
  const draft=page.getByRole('textbox',{name:'Free description',exact:true});
  await expect(draft).toHaveValue(entity.free_description);await draft.fill('Keep missing work local draft');
  removed=true;await page.waitForTimeout(5100);
  const fetched=page.waitForResponse(r=>r.request().method()==='GET' && new URL(r.url()).pathname==='/api/works');
  await page.context().setOffline(true);await page.context().setOffline(false);await(await fetched).finished();
  await expect(draft).toHaveValue('Keep missing work local draft');
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Sunward Company',exact:true}).click();
  await expect(draft).toHaveValue('Keep missing work local draft');
});

test('外部更新で法人参加権限が消えた場合に未保存キャラをpersonalへ移さない',async({page})=>{
  let removed=false;const fixtures=storyNavigationFixtures();
  await page.setViewportSize({width:1440,height:900});
  await seedEnglishUi(page);await seedAuthenticatedSession(page);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/organizations') {await route.fulfill({json:{organizations:removed?[]:[organizationWorkspace]}});return;}
    if(path==='/api/works/'+work.id+'/entities') {await mockEntityDirtyApi(route);return;}
    await mockStoryNavigationApi(route,fixtures);
  });
  await page.goto('/');await page.locator('aside.sidebar').getByRole('combobox',{name:'Scope',exact:true}).selectOption(organizationWorkspace.organization.id);
  await page.getByRole('button',{name:'Entities',exact:true}).click();
  const draft=page.getByRole('textbox',{name:'Free description',exact:true});
  await expect(draft).toHaveValue(entity.free_description);await draft.fill('Keep revoked workspace local draft');
  removed=true;await page.waitForTimeout(5100);
  const fetched=page.waitForResponse(r=>r.request().method()==='GET' && new URL(r.url()).pathname==='/api/organizations');
  await page.context().setOffline(true);await page.context().setOffline(false);await(await fetched).finished();
  await expect(draft).toHaveValue('Keep revoked workspace local draft');
});

test('外部更新より古いキャラ保存応答はbaselineとquery cacheを巻き戻さない',async({page})=>{
  let remote=entity;let release:()=>void=()=>{throw new Error('save not pending');};
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await seedEnglishUi(page);await seedAuthenticatedSession(page);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname,method=route.request().method();
    if(path==='/api/works/'+work.id+'/entities' && method==='GET'){await route.fulfill({json:{entities:[remote,secondEntity]}});return;}
    if(path==='/api/entities/'+entity.id && method==='PUT'){await pending;await route.fulfill({json:{...entity,free_description:'Submitted stale save',updated_at:'2026-04-26T00:00:02.000Z'}});return;}
    await mockEntityDirtyApi(route);
  });
  await page.goto('/');await page.getByRole('button',{name:'Entities',exact:true}).click();
  const draft=page.getByRole('textbox',{name:'Free description',exact:true});
  await expect(draft).toHaveValue(entity.free_description);await draft.fill('Submitted stale save');
  const put=page.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname==='/api/entities/'+entity.id);
  await page.getByRole('button',{name:'Save character',exact:true}).click();await put;
  remote={...entity,free_description:'Newer server revision',updated_at:'2026-04-26T00:00:03.000Z'};
  await page.waitForTimeout(5100);
  const fetched=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/works/'+work.id+'/entities');
  await page.context().setOffline(true);await page.context().setOffline(false);await(await fetched).finished();
  await expect(draft).toHaveValue('Submitted stale save');
  const finished=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/entities/'+entity.id);
  release();await(await finished).finished();await expect(page.getByRole('button',{name:'Save character',exact:true})).toBeEnabled();
  await expect(draft).toHaveValue('Submitted stale save');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Reset draft',exact:true}).click();
  await expect(draft).toHaveValue('Newer server revision');
});
