import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { XOidcError } from '../domain/auth/XOidcProtocol.js';
import { AppError } from '../domain/errors/index.js';
import type { XOidcService } from '../services/auth/XOidcService.js';
import type { AppEnv } from '../types/app.js';
import { readLimitedRawBody } from './requestBody.js';

export function createXOidcRoutes(dependencies: { service: XOidcService; rateLimitMiddleware: MiddlewareHandler<AppEnv> }): Hono<AppEnv> {
  const app = new Hono<AppEnv>(), service = dependencies.service;
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('Pragma', 'no-cache');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    await next();
  });
  app.use('*', dependencies.rateLimitMiddleware);
  app.onError((error, c) => {
    const status = error instanceof XOidcError ? error.status : error instanceof AppError && error.statusCode === 413 ? 413 : 503;
    const code = error instanceof XOidcError ? error.code : status === 413 ? 'invalid_request' : 'temporarily_unavailable';
    if (c.req.path.endsWith('/token') || c.req.path.endsWith('/userinfo')) return c.json({ error: code }, status);
    return c.html(unavailablePage(), status);
  });
  app.get('/capabilities', c => c.json({ x_sign_in: service.enabled, x_android: service.androidEnabled, x_ios: false }));
  app.get('/.well-known/openid-configuration', c => c.json(service.discovery()));
  app.get('/jwks', async c => c.json(await service.jwks()));
  app.get('/authorize', async c => {
    const result = await service.start(new URL(c.req.url).searchParams);
    setCookie(c, result.cookie.name, result.cookie.value, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: result.cookie.maxAge });
    return c.redirect(result.url, 303);
  });
  app.get('/callback', async c => {
    const query = uniqueParams(new URL(c.req.url).searchParams);
    const state = query.get('state') ?? '';
    const cookieName = service.cookieName(state);
    const result = await service.callback({ state, code: query.get('code') ?? undefined, error: query.get('error') ?? undefined }, getCookie(c, cookieName));
    deleteCookie(c, cookieName, { secure: true, path: '/' });
    setCookie(c, result.cookie.name, result.cookie.value, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: result.cookie.maxAge });
    return c.redirect(`/api/auth/x/verify?challenge=${result.challenge}`, 303);
  });
  app.get('/verify', c => {
    const query = uniqueParams(new URL(c.req.url).searchParams);
    const challenge = query.get('challenge') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/u.test(challenge) || !getCookie(c, service.cookieName(challenge))) throw new XOidcError('invalid_request');
    return c.html(verificationPage(challenge, false));
  });
  app.post('/verify', async c => {
    const query = await readForm(c.req.raw);
    const challenge = query.get('challenge') ?? '';
    const cookieName = service.cookieName(challenge);
    try {
      const redirect = await service.verify(challenge, query.get('code') ?? '', getCookie(c, cookieName));
      deleteCookie(c, cookieName, { secure: true, path: '/' });
      return c.redirect(redirect, 303);
    } catch (error) {
      if (error instanceof XOidcError && error.code === 'invalid_grant' && /^[A-Za-z0-9_-]{43}$/u.test(challenge)) return c.html(verificationPage(challenge, true), 400);
      throw error;
    }
  });
  app.post('/token', async c => c.json(await service.token(await readForm(c.req.raw))));
  app.get('/userinfo', async c => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/iu.exec(c.req.header('Authorization') ?? '');
    if (!match) throw new XOidcError('invalid_token', 401);
    return c.json(await service.userinfo(match[1]));
  });
  return app;
}
function uniqueParams(query: URLSearchParams): URLSearchParams {
  const keys = new Set<string>();
  for (const [key, value] of query) { if (keys.has(key) || key.length > 64 || value.length > 4096) throw new XOidcError('invalid_request'); keys.add(key); }
  return query;
}
async function readForm(request: Request): Promise<URLSearchParams> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new XOidcError('invalid_request');
  const body = await readLimitedRawBody(request, request.headers.get('content-length') ?? undefined, { maxBytes: 8192, description: 'Authentication form' });
  return uniqueParams(new URLSearchParams(body.toString('utf8')));
}
function verificationPage(challenge: string, invalid: boolean): string {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lyra — Xログイン / X sign-in</title><style>body{font:16px system-ui,sans-serif;max-width:30rem;margin:8vh auto;padding:1.5rem;color:#111;background:#fafafa}input,button{font:inherit;box-sizing:border-box;padding:.8rem;width:100%;margin:.5rem 0}button{background:#111;color:white;border:0;border-radius:.3rem}p{line-height:1.7}</style><main><h1>ログインの確認</h1><p>Xの確認済みメールアドレスに届いた6桁のコードを入力してください。<br>Enter the 6-digit code sent to your confirmed X email address.</p>${invalid ? '<p role="alert">コードが違うか期限切れです。5回失敗した場合はLyraからやり直してください。<br>Invalid or expired code. After five attempts, restart sign-in from Lyra.</p>' : ''}<form method="post" action="/api/auth/x/verify"><input type="hidden" name="challenge" value="${challenge}"><label for="code">確認コード / Verification code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus><button type="submit">確認して続ける / Continue</button></form><p>この画面を閉じるとログインを中止できます。<br>Close this page to cancel sign-in.</p></main></html>`;
}
function unavailablePage(): string {
  return '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lyra</title><main><h1>Xログインを完了できませんでした</h1><p>確認済みメールを取得できない場合や、同じメールの既存アカウントがある場合は、これまでの方法でログインしてください。その他の場合はLyraのログイン画面からやり直してください。</p><p>X sign-in could not be completed. Use your existing sign-in method if you already have an account, or restart from Lyra. X must share a confirmed email address.</p></main></html>';
}
