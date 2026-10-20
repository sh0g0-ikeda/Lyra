import { expect, test, type Page } from '@playwright/test';

async function mockCapabilities(page: Page, enabled: boolean): Promise<void> {
  await page.route('**/api/auth/capabilities**', route => route.fulfill({ json: { version: 2, google_sign_in: false, google_linking: false, google_ios: false } }));
  await page.route('**/api/auth/x/capabilities', route => route.fulfill({ json: { x_sign_in: enabled, x_android: enabled, x_ios: false } }));
}
test('X認証が有効な場合にCognitoへS256 PKCEとX指定で進む', async ({ page }) => {
  await mockCapabilities(page, true);
  await page.route('https://lyra-x-fixture.auth.ap-northeast-1.amazoncognito.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Fixture Cognito</h1>' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const button = page.getByTestId('auth-x-button');
  await expect(button).toBeVisible();
  await expect(page.locator('.splash-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/x-login-mobile-web.png', fullPage: true });
  await button.click();
  await page.waitForURL('https://lyra-x-fixture.auth.ap-northeast-1.amazoncognito.com/**');
  const url = new URL(page.url());
  expect(url.searchParams.get('identity_provider')).toBe('X');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
});
test('無効または通信失敗の場合にXを隠して通常ログインを維持する', async ({ page }) => {
  await mockCapabilities(page, false);
  await page.goto('/');
  await expect(page.getByTestId('auth-x-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /sign in|ログイン|continue/i }).first()).toBeVisible();
  await page.route('**/api/auth/x/capabilities', route => route.abort());
  await page.reload();
  await expect(page.getByTestId('auth-x-button')).toHaveCount(0);
});
test('iOSではサーバーが有効でもXを表示しない', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
  });
  await mockCapabilities(page, true);
  await page.goto('/');
  await expect(page.getByTestId('auth-x-button')).toHaveCount(0);
});
