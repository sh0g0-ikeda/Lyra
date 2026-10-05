import { expect, test, type Page, type Route } from '@playwright/test';
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

const work: WorkRecord = {
  id: 'work-entity-import', organization_id: null, title: 'Import safety', genre: 'fantasy', world_setting: null, theme: null,
  main_entity_ids: [], starting_point: null, ending_point: null, overall_flow: null, version: 1, status: 'draft',
  created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
const chapter: ChapterRecord = {
  id: 'chapter-entity-import', work_id: work.id, order: 1, title: 'Chapter', purpose: null, starting_state: null, ending_state: null,
  emotion_curve: null, entities_involved: [], key_beats: [], version: 1, status: 'draft',
  created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
const episode: EpisodeRecord = {
  id: 'episode-entity-import', chapter_id: chapter.id, order: 1, title: 'Episode', purpose: null, story_input_mode: 'structured',
  story_full_draft: null, introduction: null, middle: null, climax: null, ending_hook: null, estimated_pages: 1,
  entities_involved: [], page_skeleton_generated: true, version: 1, status: 'draft',
  created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
const existingEntity: EntityRecord = {
  id: 'entity-existing', work_id: work.id, entity_type: 'character', name: 'Existing', free_description: null,
  structured_fields: {}, prompt_supplement: null, speech_profile: {}, status: 'draft',
  created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
const pageRecord: PageRecord = {
  id: 'page-entity-import', episode_id: episode.id, page_number: 1,
  layout_config: { type: 'template', template_id: 'standard_1', style_reference: { title: 'Server style', notes: '' } },
  story_source_scene_ids: [], story_page_purpose: null, story_continuity_note: null, dialogue_mode: 'mixed', page_dialogue_toggle: true,
  generation_mode: 'standard', generated_image: null, status: 'editing', panel_count: 2, frame_count: 1, balloon_count: 0,
  created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
};
function panel(id: string, order: number): PanelRecord {
  return {
    id, page_id: pageRecord.id, order, panel_role: 'establish', panel_size: 'standard', situation_text: `Situation ${order}`,
    entities: [], composition: { source: 'ai_auto', gallery_item_id: null, composition_prompt: null, shot_type: null, angle: null, custom_note: null },
    dialogue_in_panel: true, dialogue: [], sfx_text: null, background_note: null, panel_notes: null,
    created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
  };
}
const frame: PanelFrameRecord = {
  id: 'frame-entity-import', page_id: pageRecord.id, panel_id: 'panel-a',
  vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  border_style: 'solid', border_width: 2, border_color: '#111111', z_index: 1, reading_order: 1,
};
const composition: CompositionRecord = {
  id: 'composition-entity-import', name: 'Medium', category: 'character', entity_count: 1, preview_cdn_url: null,
  composition_prompt: 'medium shot', shot_type: 'medium', angle: 'eye_level', tags: [], created_at: '2026-10-05T00:00:00.000Z',
};
const session: CurrentSessionRecord = {
  user: { id: 'user-1', email: 'fixture@example.test', display_name: null, plan_code: 'free' },
  personal_credits: { monthly_credits: 100, purchased_credits: 0, total_credits: 100, monthly_expires_at: null },
  organizations: [], capabilities: { web_image_delivery: false },
};

type State = {
  entities: EntityRecord[];
  scenes: SceneRecord[];
  pages: PageRecord[];
  panels: PanelRecord[];
  frames: PanelFrameRecord[];
  handleWrite?: (route: Route) => Promise<void>;
};

function createState(): State {
  return {
    entities: [existingEntity], scenes: [], pages: [pageRecord], panels: [panel('panel-a', 1), panel('panel-b', 2)], frames: [frame],
  };
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('lyra:web:manual-token', 'header.payload.signature');
    window.localStorage.setItem('lyra:web:ui-language', 'en');
  });
}

async function mockApi(route: Route, state: State): Promise<void> {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const json = async (body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (request.method() !== 'GET') {
    if (state.handleWrite !== undefined) return state.handleWrite(route);
    return json({});
  }
  if (pathname === '/api/me') return json(session);
  if (pathname === '/api/auth/capabilities') return json({ google_sign_in: false, google_linking: false, google_ios: false });
  if (pathname === '/api/works') return json({ works: [work] });
  if (pathname === `/api/works/${work.id}/chapters`) return json({ chapters: [chapter] });
  if (pathname === `/api/chapters/${chapter.id}/episodes`) return json({ episodes: [episode] });
  if (pathname === `/api/works/${work.id}/entities`) return json({ entities: state.entities });
  if (/^\/api\/entities\/[^/]+\/reference-set$/.test(pathname)) {
    const entityId = pathname.split('/')[3] ?? '';
    return json({ entity_id: entityId, primary_ref_id: null, status: 'empty', updated_at: '2026-10-05T00:00:00.000Z', reference_images: [] });
  }
  if (pathname === `/api/episodes/${episode.id}/scenes`) return json({ scenes: state.scenes });
  if (pathname === `/api/episodes/${episode.id}/pages`) return json({ pages: state.pages });
  if (pathname === `/api/pages/${pageRecord.id}/panels`) return json({ panels: state.panels });
  if (pathname === `/api/pages/${pageRecord.id}/frames`) return json({ frames: state.frames });
  if (pathname === `/api/pages/${pageRecord.id}/balloons`) return json({ balloons: [] });
  if (pathname === `/api/pages/${pageRecord.id}/generation-readiness`) return json({ ready: true, blockers: [], warnings: [], estimated_credit_cost: 3, page_revision: 'revision-1' });
  if (pathname === '/api/compositions') return json({ compositions: [composition] });
  if (/^\/api\/jobs\//.test(pathname)) return json({ id: pathname.split('/').at(-1), job_type: 'entity_generate', status: 'queued', generation_mode: 'standard', credit_cost: 1, params: { entity_id: 'entity-created' }, result: null, error_message: null, retry_count: 0, created_at: '2026-10-05T00:00:00.000Z', started_at: null, completed_at: null, expires_at: null, cancel_requested_at: null, cancelled_at: null, commit_started_at: null });
  return json({ monthly_credits: 100, purchased_credits: 0, total_credits: 100, monthly_expires_at: null, plan_code: 'free', current_period_end: null, cancel_at_period_end: false, subscription_plans: [] });
}

async function open(page: Page, state: State, tab: 'Entities' | 'Story' | 'Pages'): Promise<void> {
  await seed(page);
  await page.route('**/api/**', (route) => mockApi(route, state));
  await page.goto('/');
  await page.getByRole('button', { name: tab, exact: true }).click();
}

const imageFile = { name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('candidate-image') };

test('new draft importは追加入力を保持してCreate後bindしpreviewへv1 tokenを渡す', async ({ page }) => {
  const state = createState();
  let releaseImport!: () => void; let releaseCreate!: () => void;
  const importPending = new Promise<void>((resolve) => { releaseImport = resolve; });
  const createPending = new Promise<void>((resolve) => { releaseCreate = resolve; });
  const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  state.handleWrite = async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    bodies.push({ path, body });
    if (path === '/api/entities/import-image') { await importPending; await route.fulfill({ json: { suggested_fields: { art_style: 'anime' }, prompt_supplement: 'imported prompt', tmp_image_token: 'draft-v3' } }); return; }
    if (path === `/api/works/${work.id}/entities`) {
      await createPending;
      const created: EntityRecord = { ...existingEntity, id: 'entity-created', name: String(body.name), free_description: body.free_description as string | null, structured_fields: body.structured_fields as Record<string, unknown>, prompt_supplement: body.prompt_supplement as string | null, updated_at: '2026-10-05T00:00:01.000Z' };
      state.entities = [created, ...state.entities]; await route.fulfill({ json: created }); return;
    }
    if (path === '/api/entities/entity-created/reference-candidate/bind') { await route.fulfill({ json: { candidate_token: 'bound-v1' } }); return; }
    if (path === '/api/entities/entity-created' && route.request().method() === 'PUT') { const current = state.entities[0]!; const saved = { ...current, ...body, updated_at: '2026-10-05T00:00:02.000Z' }; state.entities[0] = saved as EntityRecord; await route.fulfill({ json: saved }); return; }
    if (path === '/api/entities/entity-created/generate-reference') { await route.fulfill({ json: { job_id: 'job-entity-preview' } }); return; }
    throw new Error(`Unexpected write ${route.request().method()} ${path}`);
  };
  await open(page, state, 'Entities');
  await page.getByRole('button', { name: 'New character', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Imported hero');
  const importRequest = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/entities/import-image');
  await page.locator('.entity-reference-import input[type=file]').setInputFiles(imageFile); await importRequest;
  await page.getByRole('textbox', { name: 'Free description', exact: true }).fill('Typed while import waited');
  await page.getByRole('combobox', { name: 'Art style', exact: true }).selectOption('manga');
  releaseImport(); await expect(page.locator('.notice.success')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Free description', exact: true })).toHaveValue('Typed while import waited');
  await expect(page.getByRole('combobox', { name: 'Art style', exact: true })).toHaveValue('manga');

  const createRequest = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/works/${work.id}/entities`);
  await page.getByRole('button', { name: 'Create character', exact: true }).click(); await createRequest;
  await page.getByRole('textbox', { name: 'Free description', exact: true }).fill('Typed after create started');
  releaseCreate();
  await expect(page.getByRole('button', { name: 'Save character', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Free description', exact: true })).toHaveValue('Typed after create started');
  await page.getByRole('button', { name: 'Generate full-body preview', exact: true }).click();
  await expect.poll(() => bodies.filter((entry) => entry.path.endsWith('/generate-reference')).length).toBe(1);
  expect(bodies.find((entry) => entry.path.endsWith('/reference-candidate/bind'))?.body).toEqual({ candidate_token: 'draft-v3' });
  expect(bodies.find((entry) => entry.path.endsWith('/generate-reference'))?.body).toEqual({ source_candidate_token: 'bound-v1' });
});

test('bind失敗後は作成済みrecordとtokenを保持しbindだけ再試行する', async ({ page }) => {
  const state = createState(); let imports = 0; let creates = 0; let binds = 0;
  state.handleWrite = async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    if (path === '/api/entities/import-image') { imports += 1; await route.fulfill({ json: { suggested_fields: {}, prompt_supplement: 'prompt', tmp_image_token: 'draft-retry' } }); return; }
    if (path === `/api/works/${work.id}/entities`) { creates += 1; const created = { ...existingEntity, id: 'entity-created', name: String(body.name), prompt_supplement: body.prompt_supplement as string, updated_at: '2026-10-05T00:00:01.000Z' }; state.entities = [created, ...state.entities]; await route.fulfill({ json: created }); return; }
    if (path === '/api/entities/entity-created/reference-candidate/bind') { binds += 1; if (binds === 1) { await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'bind failed' } } }); } else { await route.fulfill({ json: { candidate_token: 'bound-retry' } }); } return; }
    throw new Error(`Unexpected write ${path}`);
  };
  await open(page, state, 'Entities');
  await page.getByRole('button', { name: 'New character', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Retry hero');
  await page.locator('.entity-reference-import input[type=file]').setInputFiles(imageFile);
  await expect(page.locator('.notice.success')).toBeVisible();
  await page.getByRole('button', { name: 'Create character', exact: true }).click();
  await expect(page.locator('.notice.error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save character', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry attaching imported image', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry attaching imported image', exact: true }).click();
  await expect(page.locator('.notice.success')).toBeVisible();
  expect({ imports, creates, binds }).toEqual({ imports: 1, creates: 1, binds: 2 });
});

test('同tickのimport再送を一回に絞りtokenだけのdraftでもReset Cancelで保持する', async ({ page }) => {
  const state = createState(); let imports = 0; let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  state.handleWrite = async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/entities/import-image') { imports += 1; await pending; await route.fulfill({ json: { suggested_fields: {}, prompt_supplement: '', tmp_image_token: 'draft-only' } }); return; }
    throw new Error(`Unexpected write ${path}`);
  };
  await open(page, state, 'Entities');
  await page.getByRole('button', { name: 'New character', exact: true }).first().click();
  await page.locator('.entity-reference-import input[type=file]').evaluate((input) => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['candidate'], 'candidate.png', { type: 'image/png' }));
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => imports).toBe(1); release(); await expect(page.locator('.notice.success')).toBeVisible();
  let dialogs = 0; page.once('dialog', async (dialog) => { dialogs += 1; await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Reset draft', exact: true }).click();
  expect(dialogs).toBe(1); expect(imports).toBe(1);
});

test('Create scene応答後も待機中に追記したLocationを保持する', async ({ page }) => {
  const state = createState(); let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  state.handleWrite = async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/episodes/${episode.id}/scenes` && route.request().method() === 'POST') { const body = route.request().postDataJSON() as Record<string, unknown>; await pending; state.scenes = [{ id: 'scene-created', episode_id: episode.id, order: Number(body.order), location: body.location as string, time: body.time as string | null, atmosphere: body.atmosphere as string | null, involved_entity_ids: [], entity_states: [], status: 'draft', created_at: '2026-10-05T00:00:01.000Z', updated_at: '2026-10-05T00:00:01.000Z' }]; await route.fulfill({ json: state.scenes[0] }); return; }
    throw new Error(`Unexpected write ${path}`);
  };
  await open(page, state, 'Story');
  await page.getByRole('textbox', { name: 'Order', exact: true }).fill('1');
  const location = page.getByRole('textbox', { name: 'Location', exact: true }); await location.fill('Submitted location');
  const request = page.waitForRequest((item) => item.method() === 'POST' && new URL(item.url()).pathname.endsWith('/scenes'));
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await request;
  await location.fill('Later location'); release(); await expect(page.locator('.notice.success')).toBeVisible();
  await expect(location).toHaveValue('Later location');
});

test('skeleton失敗と成功応答はいずれも待機中のpage入力を消さない', async ({ page }) => {
  const state = createState(); let attempts = 0; let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  state.handleWrite = async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/episodes/${episode.id}` && route.request().method() === 'PUT') { await route.fulfill({ json: episode }); return; }
    if (path === `/api/episodes/${episode.id}/generate-page-skeleton`) { attempts += 1; if (attempts === 1) { await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'skeleton failed' } } }); } else { await pending; await route.fulfill({ json: { pages_created: 1, panels_created: 2 } }); } return; }
    throw new Error(`Unexpected write ${path}`);
  };
  await open(page, state, 'Pages');
  const style = page.getByRole('textbox', { name: 'Art style reference', exact: true }); await style.fill('Keep after failure');
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Regenerate page plan', exact: true }).click();
  await expect(page.locator('.notice.error')).toBeVisible(); await expect(style).toHaveValue('Keep after failure');
  const request = page.waitForRequest((item) => new URL(item.url()).pathname.endsWith('/generate-page-skeleton'));
  await page.getByRole('button', { name: 'Regenerate page plan', exact: true }).click(); await request;
  await style.fill('Later while skeleton waited'); release(); await expect(page.locator('.notice.success')).toBeVisible();
  await expect(style).toHaveValue('Later while skeleton waited');
});

test('panel削除はdirty framesを一度の確認で守りnonselected削除後も選択を維持する', async ({ page }) => {
  const state = createState(); let deletes = 0;
  state.handleWrite = async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/panels/panel-b' && route.request().method() === 'DELETE') { deletes += 1; state.panels = state.panels.filter((item) => item.id !== 'panel-b'); await route.fulfill({ status: 204 }); return; }
    if (path === '/api/panels/panel-a' && route.request().method() === 'DELETE') { deletes += 1; await route.fulfill({ status: 204 }); return; }
    throw new Error(`Unexpected write ${path}`);
  };
  await open(page, state, 'Pages');
  await page.getByText('Advanced frame geometry', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'X', exact: true }).first().fill('0.25');
  page.once('dialog', (dialog) => dialog.dismiss()); await page.locator('.panel-delete-button').click();
  expect(deletes).toBe(0); await expect(page.getByRole('spinbutton', { name: 'X', exact: true }).first()).toHaveValue('0.25');
  let confirmations = 0; page.once('dialog', async (dialog) => { confirmations += 1; await dialog.accept(); });
  await page.locator('.panel-order-row').nth(1).getByRole('button', { name: 'Delete panel', exact: true }).click();
  await expect.poll(() => deletes).toBe(1); expect(confirmations).toBe(1);
  await expect(page.locator('.panel-order-row').first()).toHaveClass(/active/);
  await expect(page.getByRole('textbox', { name: 'Situation', exact: true })).toHaveValue('Situation 1');
});

test('import待機中にTypeを変更しても元typeの候補を保持し戻せば再解析せずbindする',async({page})=>{
  const state=createState();let imports=0,creates=0,binds=0;let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  state.handleWrite=async route=>{
    const path=new URL(route.request().url()).pathname;
    const body=(route.request().postDataJSON()??{}) as Record<string,unknown>;
    if(path==='/api/entities/import-image'){imports+=1;await pending;await route.fulfill({json:{suggested_fields:{art_style:'anime'},prompt_supplement:'original character prompt',tmp_image_token:'draft-original-type'}});return;}
    if(path==='/api/works/'+work.id+'/entities'){
      creates+=1;const created:EntityRecord={...existingEntity,id:'entity-created',entity_type:body.entity_type as EntityRecord['entity_type'],name:String(body.name),updated_at:'2026-10-05T00:00:01.000Z'};
      state.entities=[created,...state.entities];await route.fulfill({json:created});return;
    }
    if(path==='/api/entities/entity-created/reference-candidate/bind'){
      binds+=1;expect(body).toEqual({candidate_token:'draft-original-type'});await route.fulfill({json:{candidate_token:'bound-original-type'}});return;
    }
    throw new Error('Unexpected write '+path);
  };
  await open(page,state,'Entities');await page.getByRole('button',{name:'New character',exact:true}).first().click();
  await page.getByRole('textbox',{name:'Name',exact:true}).fill('Keep original image');
  const sent=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/entities/import-image');
  await page.locator('.entity-reference-import input[type=file]').setInputFiles(imageFile);await sent;
  const type=page.getByRole('combobox',{name:'Type',exact:true});await type.selectOption('object');release();
  await expect(page.locator('.notice.info')).toBeVisible();
  await page.getByRole('button',{name:'Create character',exact:true}).click();
  await expect(page.locator('.notice.error')).toBeVisible();expect(creates).toBe(0);
  await type.selectOption('character');await page.getByRole('button',{name:'Create character',exact:true}).click();
  await expect(page.locator('.notice.success')).toBeVisible();expect({imports,creates,binds}).toEqual({imports:1,creates:1,binds:1});
});
