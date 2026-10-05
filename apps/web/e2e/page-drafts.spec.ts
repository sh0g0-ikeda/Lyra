import { expect, test as base, type ConsoleMessage, type Page, type Route } from '@playwright/test';
import type {
  ChapterRecord,
  CompositionRecord,
  CurrentSessionRecord,
  EntityRecord,
  EpisodeRecord,
  PageRecord,
  PanelFrameRecord,
  PanelRecord,
  SceneRecord,
  WorkRecord,
} from '../src/types/api';

// Design 05 §§1/3/7: an asynchronous same-resource refresh must never erase
// editable page, scene, panel, or frame drafts. These tests use server-shaped
// records and observe React's render boundary as well as ordinary page errors.
const test = base.extend<{ browserRuntimeErrors: void }>({
  browserRuntimeErrors: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    const onPageError = (error: Error): void => { errors.push(error.stack ?? error.message); };
    const onConsoleError = (message: ConsoleMessage): void => {
      if (message.type() === 'error' && message.text().includes('Unexpected web render failure')) errors.push(message.text());
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsoleError);
    await use();
    page.off('pageerror', onPageError);
    page.off('console', onConsoleError);
    if (errors.length > 0) await testInfo.attach('browser-runtime-errors', { body: errors.join('\n\n'), contentType: 'text/plain' });
    expect(errors, 'The editor must not enter its render error boundary').toEqual([]);
  }, { auto: true }],
});

const manualTokenStorageKey = 'lyra:web:manual-token';
const uiLanguageStorageKey = 'lyra:web:ui-language';

const work: WorkRecord = {
  id: 'work-1', organization_id: null, title: 'Moonlit Regiment', genre: 'fantasy', world_setting: null, theme: null,
  main_entity_ids: ['entity-1'], starting_point: null, ending_point: null, overall_flow: null, version: 1, status: 'draft',
  created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
const chapter: ChapterRecord = {
  id: 'chapter-1', work_id: work.id, order: 1, title: 'First movement', purpose: null, starting_state: null, ending_state: null,
  emotion_curve: null, entities_involved: ['entity-1'], key_beats: [], version: 1, status: 'draft',
  created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
const episode: EpisodeRecord = {
  id: 'episode-1', chapter_id: chapter.id, order: 1, title: 'Arrival', purpose: null, story_input_mode: 'structured', story_full_draft: null,
  introduction: null, middle: null, climax: null, ending_hook: null, estimated_pages: 2, entities_involved: ['entity-1'],
  page_skeleton_generated: true, version: 1, status: 'draft', created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
const entity: EntityRecord = {
  id: 'entity-1', work_id: work.id, entity_type: 'character', name: 'Mizuki', free_description: null, structured_fields: {},
  prompt_supplement: null, speech_profile: {}, status: 'draft', created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
const session: CurrentSessionRecord = {
  user: { id: 'user-1', email: 'fixture@example.test', display_name: null, plan_code: 'free' },
  personal_credits: { monthly_credits: 100, purchased_credits: 0, total_credits: 100, monthly_expires_at: null },
  organizations: [], capabilities: { web_image_delivery: false },
};
const composition: CompositionRecord = {
  id: 'composition-1', name: 'Medium', category: 'character', entity_count: 1, preview_cdn_url: null, composition_prompt: 'medium shot',
  shot_type: 'medium', angle: 'eye_level', tags: [], created_at: '2026-10-05T00:00:00.000Z',
};

type EditorState = {
  pages: PageRecord[];
  panels: Record<string, PanelRecord[]>;
  frames: Record<string, PanelFrameRecord[]>;
  scenes: SceneRecord[];
  writes: number;
  handleWrite?: (route: Route) => Promise<void>;
};

function createPage(id: string, pageNumber: number): PageRecord {
  return {
    id, episode_id: episode.id, page_number: pageNumber,
    layout_config: { type: 'template', template_id: 'standard_1', style_reference: { title: `Server style ${pageNumber}`, notes: '' } },
    story_source_scene_ids: [], story_page_purpose: null, story_continuity_note: null, dialogue_mode: 'mixed', page_dialogue_toggle: true,
    generation_mode: 'standard', generated_image: null, status: 'editing', panel_count: 1, frame_count: 1, balloon_count: 0,
    created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
  };
}

function createPanel(id: string, pageId: string, order: number): PanelRecord {
  return {
    id, page_id: pageId, order, panel_role: 'establish', panel_size: 'standard', situation_text: `Server situation ${order}`,
    entities: [], composition: { source: 'ai_auto', gallery_item_id: null, composition_prompt: null, shot_type: null, angle: null, custom_note: null },
    dialogue_in_panel: true, dialogue: [], sfx_text: null, background_note: null, panel_notes: null,
    created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
  };
}

function createFrame(id: string, pageId: string, panelId: string): PanelFrameRecord {
  return {
    id, page_id: pageId, panel_id: panelId,
    vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    border_style: 'solid', border_width: 2, border_color: '#111111', z_index: 1, reading_order: 1,
  };
}

function createState(): EditorState {
  const first = createPage('page-1', 1);
  const second = createPage('page-2', 2);
  const firstPanel = createPanel('panel-1', first.id, 1);
  const secondPanel = createPanel('panel-2', first.id, 2);
  return {
    pages: [first, second],
    panels: { [first.id]: [firstPanel, secondPanel], [second.id]: [createPanel('panel-3', second.id, 1)] },
    frames: { [first.id]: [createFrame('frame-1', first.id, firstPanel.id)], [second.id]: [createFrame('frame-2', second.id, 'panel-3')] },
    scenes: [{ id: 'scene-1', episode_id: episode.id, order: 1, location: 'Server fort', time: 'night', atmosphere: 'tense', involved_entity_ids: [], entity_states: [], status: 'draft', created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z' }],
    writes: 0,
  };
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(({ tokenKey, languageKey }) => {
    window.sessionStorage.setItem(tokenKey, 'header.payload.signature');
    window.localStorage.setItem(languageKey, 'en');
  }, { tokenKey: manualTokenStorageKey, languageKey: uiLanguageStorageKey });
}

async function mockEditorApi(route: Route, state: EditorState): Promise<void> {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (request.method() !== 'GET') {
    state.writes += 1;
    if (state.handleWrite !== undefined) return state.handleWrite(route);
    await route.fulfill({json: {}}); return;
  }
  const json = async (body: unknown): Promise<void> => { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }); };
  const pageMatch = /^\/api\/episodes\/([^/]+)\/pages$/.exec(pathname);
  const panelMatch = /^\/api\/pages\/([^/]+)\/panels$/.exec(pathname);
  const frameMatch = /^\/api\/pages\/([^/]+)\/frames$/.exec(pathname);

  if (pathname === '/api/me') return json(session);
  if (pathname === '/api/auth/capabilities') return json({ google_sign_in: false, google_linking: false, google_ios: false });
  if (pathname === '/api/works') return json({ works: [work] });
  if (pathname === `/api/works/${work.id}/chapters`) return json({ chapters: [chapter] });
  if (pathname === `/api/chapters/${chapter.id}/episodes`) return json({ episodes: [episode] });
  if (pathname === `/api/works/${work.id}/entities`) return json({ entities: [entity] });
  if (pathname === `/api/entities/${entity.id}/reference-set`) return json({ entity_id: entity.id, primary_ref_id: null, status: 'empty', updated_at: entity.updated_at, reference_images: [] });
  if (pathname === `/api/episodes/${episode.id}/scenes`) return json({ scenes: state.scenes });
  if (pageMatch !== null) return json({ pages: state.pages });
  if (panelMatch !== null) return json({ panels: state.panels[panelMatch[1]] ?? [] });
  if (frameMatch !== null) return json({ frames: state.frames[frameMatch[1]] ?? [] });
  if (pathname === '/api/compositions') return json({ compositions: [composition] });
  if (/^\/api\/pages\/[^/]+\/generation-readiness$/.test(pathname)) return json({ ready: true, blockers: [], warnings: [], estimated_credit_cost: 3, page_revision: 'revision-1' });
  return json({ monthly_credits: 100, purchased_credits: 0, total_credits: 100, monthly_expires_at: null, plan_code: 'free', current_period_end: null, cancel_at_period_end: false, subscription_plans: [] });
}

async function openPages(page: Page, state: EditorState): Promise<void> {
  await seed(page);
  await page.route('**/api/**', (route) => mockEditorApi(route, state));
  await page.goto('/');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.locator('.page-card').first()).toHaveClass(/active/);
}

async function refetchAfterStale(page: Page, path: string): Promise<void> {
  await page.waitForTimeout(5_100);
  const response = page.waitForResponse((candidate) => candidate.request().method() === 'GET' && new URL(candidate.url()).pathname === path);
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await (await response).finished();
}

test('同じpageのremote refetchでも未保存のArt style referenceを保持する', async ({ page }) => {
  const state = createState();
  await openPages(page, state);
  const style = page.getByRole('textbox', { name: 'Art style reference', exact: true });
  await style.fill('Local ink direction');
  state.pages[0] = { ...state.pages[0], layout_config: { type: 'template', style_reference: { title: 'Remote style', notes: '' } }, updated_at: '2026-10-05T00:00:01.000Z' };

  await refetchAfterStale(page, `/api/episodes/${episode.id}/pages`);

  await expect(style).toHaveValue('Local ink direction');
});

test('同じsceneのremote refetchでも未保存のLocationを保持する', async ({ page }) => {
  const state = createState();
  await openPages(page, state);
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const location = page.getByRole('textbox', { name: 'Location', exact: true });
  await location.fill('Local rooftop');
  state.scenes[0] = { ...state.scenes[0], location: 'Remote harbor', updated_at: '2026-10-05T00:00:01.000Z' };

  await refetchAfterStale(page, `/api/episodes/${episode.id}/scenes`);

  await expect(location).toHaveValue('Local rooftop');
});

test('同じpanelのremote refetchでも未保存のSituationを保持する', async ({ page }) => {
  const state = createState();
  await openPages(page, state);
  const situation = page.getByRole('textbox', { name: 'Situation', exact: true });
  await situation.fill('Local ambush');
  state.panels['page-1'][0] = { ...state.panels['page-1'][0], situation_text: 'Remote march', updated_at: '2026-10-05T00:00:01.000Z' };

  await refetchAfterStale(page, '/api/pages/page-1/panels');

  await expect(situation).toHaveValue('Local ambush');
});

test('frames refetchでも未保存のvertex編集を保持する', async ({ page }) => {
  const state = createState();
  await openPages(page, state);
  await page.getByText('Advanced frame geometry', { exact: true }).click();
  const vertexX = page.getByRole('spinbutton', { name: 'X', exact: true }).first();
  await vertexX.fill('0.25');
  state.frames['page-1'][0] = { ...state.frames['page-1'][0], vertices: [{ x: 0.75, y: 0 }, ...state.frames['page-1'][0].vertices.slice(1)] };

  await refetchAfterStale(page, '/api/pages/page-1/frames');

  await expect(vertexX).toHaveValue('0.25');
});

test('page切替をCancelするとpage panel frameのdraftと選択を保持しPUTしない', async ({ page }) => {
  const state = createState();
  await openPages(page, state);
  const style = page.getByRole('textbox', { name: 'Art style reference', exact: true });
  const situation = page.getByRole('textbox', { name: 'Situation', exact: true });
  await style.fill('Keep local style');
  await situation.fill('Keep local situation');
  await page.getByText('Advanced frame geometry', { exact: true }).click();
  const vertexX = page.getByRole('spinbutton', { name: 'X', exact: true }).first();
  await vertexX.fill('0.25');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.page-card').nth(1).click();

  await expect(style).toHaveValue('Keep local style');
  await expect(situation).toHaveValue('Keep local situation');
  await expect(vertexX).toHaveValue('0.25');
  await expect(page.locator('.page-card').first()).toHaveClass(/active/);
  expect(state.writes).toBe(0);
});

test('panel切替をCancelするとdraftと選択を保持しPUTしない', async ({ page }) => {
  const state = createState();
  await openPages(page, state);
  const situation = page.getByRole('textbox', { name: 'Situation', exact: true });
  await situation.fill('Keep local panel situation');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.panel-order-main').nth(1).click();

  await expect(situation).toHaveValue('Keep local panel situation');
  await expect(page.locator('.panel-order-row').first()).toHaveClass(/active/);
  expect(state.writes).toBe(0);
});


test('ページ保存待機中の追加入力は応答とrefetchで消えず再編集できる',async({page})=>{
  const state=createState();let release:()=>void=()=>{throw new Error('save not pending');};
  const pending=new Promise<void>(resolve=>{release=resolve;});
  state.handleWrite=async route=>{
    expect(new URL(route.request().url()).pathname).toBe('/api/pages/page-1');
    expect(route.request().method()).toBe('PUT');
    const body=route.request().postDataJSON() as {style_reference: {title:string;notes:string|null}};
    await pending;
    state.pages[0]={...state.pages[0],layout_config:{...state.pages[0].layout_config,style_reference:body.style_reference},updated_at:'2026-10-05T00:00:02.000Z'};
    await route.fulfill({json:state.pages[0]});
  };
  await openPages(page,state);const style=page.getByRole('textbox',{name:'Art style reference',exact:true});
  await style.fill('Submitted art direction');
  const sent=page.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname==='/api/pages/page-1');
  const returned=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/pages/page-1');
  await page.locator('.page-section-style-constraints').getByRole('button',{name:'Save',exact:true}).click();await sent;
  await style.fill('Later art direction');release();await(await returned).finished();
  await expect(page.locator('.notice.success')).toBeVisible();await expect(style).toHaveValue('Later art direction');
  page.once('dialog',d=>d.dismiss());await page.locator('.page-card').nth(1).click();
  await expect(style).toHaveValue('Later art direction');expect(state.writes).toBe(1);
});

test('コマ情報保存成功後のキャラ割当失敗は入力を保持し再試行で復帰できる',async({page})=>{
  const state=createState();let metadataWrites=0,assignmentWrites=0,fail=true,generated=0;
  state.handleWrite=async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/panels/panel-1'&&route.request().method()==='PUT'){
      metadataWrites+=1;const body=route.request().postDataJSON() as {situation_text:string};
      state.panels['page-1'][0]={...state.panels['page-1'][0],situation_text:body.situation_text,updated_at:'2026-10-05T00:00:02.000Z'};
      await route.fulfill({json:state.panels['page-1'][0]});return;
    }
    if(path==='/api/panels/panel-1/entities'){
      assignmentWrites+=1;
      if(fail){await route.fulfill({status:500,json:{error:{code:'INTERNAL_ERROR',message:'Assignment save failed'}}});return;}
      await route.fulfill({json:{entities:[]}});return;
    }
    if(path.endsWith('/generate'))generated+=1;
    throw new Error('Unexpected write '+path);
  };
  await openPages(page,state);const situation=page.getByRole('textbox',{name:'Situation',exact:true});
  await situation.fill('Keep after assignment failure');await page.getByRole('button',{name:'Save panel',exact:true}).click();
  await expect(page.locator('.notice.error')).toBeVisible();await expect(situation).toHaveValue('Keep after assignment failure');
  expect(metadataWrites).toBe(1);expect(assignmentWrites).toBe(1);expect(generated).toBe(0);
  fail=false;await situation.fill('Retry corrected panel');await page.getByRole('button',{name:'Save panel',exact:true}).click();
  await expect(page.locator('.notice.success')).toBeVisible();await expect(situation).toHaveValue('Retry corrected panel');
  expect(metadataWrites).toBe(2);expect(assignmentWrites).toBe(2);expect(generated).toBe(0);
});

test('ページ保存失敗後に入力を保持し再編集と移動Cancelができる',async({page})=>{
  const state=createState();state.handleWrite=async route=>{await route.fulfill({status:500,json:{error:{code:'INTERNAL_ERROR',message:'Page save failed'}}});};
  await openPages(page,state);const style=page.getByRole('textbox',{name:'Art style reference',exact:true});
  await style.fill('Keep failed page save');await page.locator('.page-section-style-constraints').getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.notice.error')).toBeVisible();await expect(style).toHaveValue('Keep failed page save');
  await style.fill('Editable after error');page.once('dialog',d=>d.dismiss());await page.locator('.page-card').nth(1).click();
  await expect(style).toHaveValue('Editable after error');expect(state.writes).toBe(1);
});

test('ページ系の未保存入力はブラウザ再読込Cancelでも保持される',async({page})=>{
  const state=createState();await openPages(page,state);
  const style=page.getByRole('textbox',{name:'Art style reference',exact:true});await style.fill('Keep page on reload');
  const warning=page.waitForEvent('dialog'),reload=page.evaluate(()=>window.location.reload());
  const dialog=await warning;expect(dialog.type()).toBe('beforeunload');await dialog.dismiss();await reload;
  await expect(style).toHaveValue('Keep page on reload');expect(state.writes).toBe(0);
});

test('未保存frame編集がある場合はカラーと白黒生成を無効化し書込しない',async({page})=>{
  const state=createState();state.panels['page-1']=state.panels['page-1'].slice(0,1);
  await openPages(page,state);
  const color=page.getByRole('button',{name:'Generate in color',exact:true});
  const monochrome=page.getByRole('button',{name:'Generate monochrome page',exact:true});
  await expect(color).toBeEnabled();await expect(monochrome).toBeEnabled();
  await page.getByText('Advanced frame geometry',{exact:true}).click();
  await page.getByRole('spinbutton',{name:'X',exact:true}).first().fill('0.25');
  await expect(color).toBeDisabled();await expect(monochrome).toBeDisabled();
  expect(state.writes).toBe(0);
});

test('frame保存待機中のremote更新後は遅い保存応答で入力と基準を巻き戻さない',async({page})=>{
  const state=createState();let release:()=>void=()=>{throw new Error('frame save not pending');};
  const linkedPanelId='11111111-1111-4111-8111-111111111112';
  state.panels['page-1'][0]={...state.panels['page-1'][0],id:linkedPanelId};
  state.frames['page-1'][0]={...state.frames['page-1'][0],panel_id:linkedPanelId};
  const pending=new Promise<void>(resolve=>{release=resolve;});
  state.handleWrite=async route=>{
    expect(new URL(route.request().url()).pathname).toBe('/api/pages/page-1/frames');
    expect(route.request().method()).toBe('PUT');
    const submitted=structuredClone(state.frames['page-1']);
    submitted[0]={...submitted[0],vertices:[{x:0.25,y:0},...submitted[0].vertices.slice(1)]};
    await pending;await route.fulfill({json:{frames:submitted}});
  };
  await openPages(page,state);await page.getByText('Advanced frame geometry',{exact:true}).click();
  const x=page.getByRole('spinbutton',{name:'X',exact:true}).first();await x.fill('0.25');
  const sent=page.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname==='/api/pages/page-1/frames');
  const returned=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/pages/page-1/frames');
  await page.getByRole('button',{name:'Save frame geometry',exact:true}).click();await sent;
  state.frames['page-1'][0]={...state.frames['page-1'][0],vertices:[{x:0.75,y:0},...state.frames['page-1'][0].vertices.slice(1)]};
  await refetchAfterStale(page,'/api/pages/page-1/frames');await expect(x).toHaveValue('0.25');
  release();await(await returned).finished();
  await expect(page.locator('.notice.error')).toBeVisible();
  await expect(page.getByRole('button',{name:'Save frame geometry',exact:true})).toBeEnabled();
  await expect(x).toHaveValue('0.25');
  let dialogs=0;page.once('dialog',async dialog=>{dialogs+=1;await dialog.dismiss();});
  await page.locator('.page-card').nth(1).click();expect(dialogs).toBe(1);
  await expect(x).toHaveValue('0.25');expect(state.writes).toBe(1);
});
