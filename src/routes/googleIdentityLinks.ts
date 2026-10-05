import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { AppError, ValidationError } from '../domain/errors/index.js';
import type { GoogleIdentityLinkServicePort } from '../services/auth/GoogleIdentityLinkService.js';
import type { AppEnv } from '../types/app.js';
import { googleAuthCapabilitiesSchema, googleAuthCapabilitiesV2Schema, googleLinkStartBodySchema, googleLinkStartSchema, googleLinkStatusSchema } from '../../packages/api-contract/src/mobileApiSchemas.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';
export function createGoogleIdentityLinkRoutes(dependencies: {
    service: GoogleIdentityLinkServicePort;
    signInEnabled: boolean;
    iosEnabled?: boolean;
    authMiddleware: MiddlewareHandler<AppEnv>;
    rateLimitMiddleware: MiddlewareHandler<AppEnv>;
    publicRateLimitMiddleware: MiddlewareHandler<AppEnv>;
}): Hono<AppEnv> {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); await next(); });
    app.get('/capabilities', dependencies.publicRateLimitMiddleware, (c) => {
        const versions = c.req.queries('version') ?? [];
        const googleSignIn = dependencies.signInEnabled && dependencies.service.enabled;
        const googleLinking = dependencies.service.enabled;
        if (versions.length === 0)
            return c.json(assertMobileResponseContract(googleAuthCapabilitiesSchema, { google_sign_in: googleSignIn, google_linking: googleLinking, google_ios: false }));
        if (versions.length !== 1 || versions[0] !== '2')
            throw new AppError('UNSUPPORTED_CAPABILITY_VERSION', 'Unsupported authentication capability version', 400);
        return c.json(assertMobileResponseContract(googleAuthCapabilitiesV2Schema, {
            version: 2,
            google_sign_in: googleSignIn,
            google_linking: googleLinking,
            google_ios: dependencies.iosEnabled === true && googleSignIn && googleLinking,
        }));
    });
    app.get('/identity-links/google/callback', dependencies.publicRateLimitMiddleware, async (c) => {
        const state = c.req.query('state');
        if (!state)
            return c.text('This sign-in request is unavailable. Return to Lyra and try again.', 400);
        const redirect = await dependencies.service.callback({ state, code: c.req.query('code'), error: c.req.query('error') });
        return redirect === null ? c.text('This sign-in request is unavailable. Return to Lyra to check its status.', 400) : c.redirect(redirect, 303);
    });
    app.post('/identity-links/google/start', dependencies.authMiddleware, dependencies.rateLimitMiddleware, async (c) => {
        const parsed = googleLinkStartBodySchema.safeParse(await readJsonBody(c, { maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES, description: 'Identity link request' }));
        if (!parsed.success)
            throw new ValidationError('Invalid identity link request');
        return c.json(assertMobileResponseContract(googleLinkStartSchema, await dependencies.service.start(c.get('user'), c.get('cognitoIdentity') ?? null, parsed.data)));
    });
    app.get('/identity-links/google/:id', dependencies.authMiddleware, dependencies.rateLimitMiddleware, async (c) => {
        const parsed = z.string().uuid().safeParse(c.req.param('id'));
        if (!parsed.success)
            throw new ValidationError('Invalid identity link identifier');
        return c.json(assertMobileResponseContract(googleLinkStatusSchema, await dependencies.service.status(c.get('user'), parsed.data)));
    });
    return app;
}
