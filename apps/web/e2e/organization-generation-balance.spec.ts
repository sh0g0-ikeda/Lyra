import { expect, test, type Page, type Route } from '@playwright/test';
import type { BillingBalanceRecord, CurrentSessionRecord, GenerationJobRecord, OrganizationWorkspaceRecord } from '../src/types/api';

// Spec §§4,7,8,10: terminal job observation refreshes only its query workspace's
// credits. It does not modify charges, refunds, APIs, data, or provider calls.
// Cover all terminal states and an in-flight organization response after leaving
// that workspace so another scope's credits cannot be refreshed by stale data.
const organizationId = 'organization-generation-balance';
const jobId = '77777777-7777-4777-8777-777777777777';
const organization: OrganizationWorkspaceRecord = {
  organization: { id: organizationId, type: 'business', name: 'Generation Studio', legal_name: null, status: 'active', plan_key: 'enterprise_a', billing_email: null, created_by_user_id: 'user-1', created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z' },
  membership: { id: 'membership-generation', organization_id: organizationId, user_id: 'user-1', email: 'fixture@example.test', display_name: null, role: 'owner', status: 'active', invited_by_user_id: null, joined_at: '2026-10-05T00:00:00.000Z', created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z' },
  balance: { monthly_credits: 11, purchased_credits: 0, total_credits: 11, monthly_expires_at: null },
};
const personalBalance: BillingBalanceRecord = { monthly_credits: 20, purchased_credits: 0, total_credits: 20, monthly_expires_at: null, plan_code: 'free', current_period_end: null, cancel_at_period_end: false, subscription_plans: [] };
const session: CurrentSessionRecord = { user: { id: 'user-1', email: 'fixture@example.test', display_name: null, plan_code: 'free' }, personal_credits: personalBalance, organizations: [], capabilities: { web_image_delivery: false } };
type State = {
  status: GenerationJobRecord['status'];
  organizationCredits: number;
  personalCredits: number;
  terminalRead: boolean;
  organizationBalanceAfterTerminal: number;
  organizationListAfterTerminal: number;
  personalBalanceAfterTerminal: number;
  personalBalanceRequests: number;
  jobRequests: number;
  wrongScopeJobRequests: number;
  pendingJob?: Promise<void>;
};
function createState(): State {
  return { status: 'queued', organizationCredits: 11, personalCredits: 20, terminalRead: false, organizationBalanceAfterTerminal: 0, organizationListAfterTerminal: 0, personalBalanceAfterTerminal: 0, personalBalanceRequests: 0, jobRequests: 0, wrongScopeJobRequests: 0 };
}
async function mockApi(route: Route, state: State, scope: string): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const json = async (body: unknown): Promise<void> => route.fulfill({ json: body });
  expect(request.method(), 'This regression must perform no writes').toBe('GET');
  if (url.pathname === '/api/me') return json(session);
  if (url.pathname === '/api/auth/capabilities') return json({ google_sign_in: false, google_linking: false, google_ios: false });
  if (url.pathname === '/api/organizations') {
    if (state.terminalRead) state.organizationListAfterTerminal += 1;
    return json({ organizations: [{ ...organization, balance: { ...organization.balance, monthly_credits: state.organizationCredits, total_credits: state.organizationCredits } }] });
  }
  if (url.pathname === `/api/organizations/${organizationId}/credits/balance`) {
    if (state.terminalRead) state.organizationBalanceAfterTerminal += 1;
    return json({ organization_id: organizationId, ...organization.balance, monthly_credits: state.organizationCredits, total_credits: state.organizationCredits });
  }
  if (url.pathname === '/api/billing/balance') {
    state.personalBalanceRequests += 1;
    if (state.terminalRead) state.personalBalanceAfterTerminal += 1;
    return json({ ...personalBalance, monthly_credits: state.personalCredits, total_credits: state.personalCredits });
  }
  if (url.pathname === '/api/works') return json({ works: [] });
  if (url.pathname === '/api/compositions') return json({ compositions: [] });
  if (url.pathname === `/api/jobs/${jobId}`) {
    if (url.searchParams.get('organization_id') !== (scope === 'personal' ? null : scope)) {
      state.wrongScopeJobRequests += 1;
      await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Job not found' } } });
      return;
    }
    expect(url.searchParams.get('organization_id')).toBe(scope === 'personal' ? null : scope);
    state.jobRequests += 1;
    if (state.jobRequests > 1 && state.pendingJob !== undefined) await state.pendingJob;
    state.terminalRead = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
    const job: GenerationJobRecord = { id: jobId, job_type: 'page_generate', status: state.status, generation_mode: 'standard', credit_cost: 3, params: { page_id: 'page-balance' }, result: null, error_message: state.status === 'failed' ? 'Generation failed' : null, retry_count: 0, created_at: '2026-10-05T00:00:00.000Z', started_at: null, completed_at: state.terminalRead ? '2026-10-05T00:01:00.000Z' : null, expires_at: null, cancel_requested_at: null, cancelled_at: null, commit_started_at: null };
    return json(job);
  }
  // Account surfaces may request read-only lists unrelated to generation.
  if (/^\/api\/organizations\//u.test(url.pathname)) return json({ members: [], invitations: [], plans: [], entries: [], events: [] });
  throw new Error(`Unexpected GET ${url.pathname}`);
}
async function open(page: Page, state: State, scope: string): Promise<void> {
  await page.clock.install();
  await page.addInitScript(({ scope, organizationId, jobId }) => {
    sessionStorage.setItem('lyra:web:manual-token', 'header.payload.signature');
    localStorage.setItem('lyra:web:ui-language', 'en');
    localStorage.setItem('lyra:web:selected-organization:email:session', scope === 'personal' ? '' : organizationId);
    localStorage.setItem(`lyra:web:tracked-jobs:email:session:workspace:${scope}`, JSON.stringify([jobId]));
  }, { scope, organizationId, jobId });
  await page.route('**/api/**', (route) => mockApi(route, state, scope));
  await page.goto('/');
  await expect.poll(() => state.jobRequests).toBe(1);
  if (scope === 'personal') await expect.poll(() => state.personalBalanceRequests).toBe(1);
  else await expect(page.locator('.sidebar-workspace-summary')).toContainText(`${state.organizationCredits} credits`);
}

for (const status of ['completed', 'failed', 'cancelled'] as const) {
  test(`組織の生成が${status}になった場合に組織残高と一覧だけを再取得する`, async ({ page }) => {
    test.skip(process.env.VITE_ORGANIZATION_FEATURES_ENABLED?.trim().toLowerCase() !== 'true', 'organization UI is disabled');
    const state = createState();
    state.organizationCredits = status === 'completed' ? 11 : 8;
    await open(page, state, organizationId);
    state.status = status;
    state.organizationCredits = status === 'completed' ? 8 : 11;
    await page.clock.fastForward(9_000);
    await expect.poll(() => state.organizationBalanceAfterTerminal).toBe(1);
    await expect.poll(() => state.organizationListAfterTerminal).toBe(1);
    expect(state.personalBalanceAfterTerminal).toBe(0);
    await expect(page.locator('.sidebar-workspace-summary')).toContainText(`${state.organizationCredits} credits`);
    await page.clock.fastForward(9_000);
    expect(state.organizationBalanceAfterTerminal).toBe(1);
    expect(state.organizationListAfterTerminal).toBe(1);
  });
}

test('個人の生成が完了した場合に個人残高だけを再取得する', async ({ page }) => {
  const state = createState();
  await open(page, state, 'personal');
  state.status = 'completed'; state.personalCredits = 17;
  await page.clock.fastForward(9_000);
  await expect.poll(() => state.personalBalanceAfterTerminal).toBe(1);
  expect(state.organizationBalanceAfterTerminal).toBe(0);
  expect(state.organizationListAfterTerminal).toBe(0);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  await expect(page.locator('.billing-balance-grid .metric').first()).toContainText('17');
});

test('組織ジョブの応答待ちに個人へ移動した場合に遅い応答が個人残高を再取得しない', async ({ page }) => {
  test.skip(process.env.VITE_ORGANIZATION_FEATURES_ENABLED?.trim().toLowerCase() !== 'true', 'organization UI is disabled');
  const state = createState();
  let release!: () => void;
  state.pendingJob = new Promise<void>((resolve) => { release = resolve; });
  await open(page, state, organizationId);
  await page.clock.fastForward(9_000);
  await expect.poll(() => state.jobRequests).toBe(2);
  const scope = page.locator('aside.sidebar').getByRole('combobox', { name: 'Scope', exact: true });
  const requestsBeforeSwitch = state.personalBalanceRequests;
  await scope.selectOption('');
  await expect.poll(() => state.personalBalanceRequests).toBeGreaterThan(requestsBeforeSwitch);
  await expect(page.locator('.sidebar-workspace-summary')).toContainText('Personal credits are used');
  await page.clock.fastForward(1_000);
  const requestsBeforeLateResponse = state.personalBalanceRequests;
  state.status = 'completed'; state.organizationCredits = 8;
  release();
  await expect.poll(() => state.terminalRead).toBe(true);
  await page.clock.fastForward(1_000);
  expect(state.personalBalanceRequests).toBe(requestsBeforeLateResponse);
  expect(state.personalBalanceAfterTerminal).toBe(0);
  expect(state.organizationBalanceAfterTerminal).toBe(0);
  await expect(page.locator('.sidebar-workspace-summary')).toContainText('Personal credits are used');
  await scope.selectOption(organizationId);
  await expect.poll(() => state.organizationListAfterTerminal).toBe(1);
  await expect.poll(() => state.organizationBalanceAfterTerminal).toBeGreaterThan(0);
  // Revisit may refetch the existing scope-keyed personal billing query. The
  // no-cross-scope terminal refresh boundary was asserted before this revisit.
  await expect(page.locator('.sidebar-workspace-summary')).toContainText('8 credits');
});
