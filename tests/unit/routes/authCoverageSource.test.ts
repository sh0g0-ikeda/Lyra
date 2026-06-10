import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const AUTHENTICATED_ROUTE_FILES = [
  'balloons.ts',
  'billing.ts',
  'compositions.ts',
  'entities.ts',
  'jobs.ts',
  'pages.ts',
  'panelEntityAssignments.ts',
  'panelFrames.ts',
  'panels.ts',
  'scenes.ts',
  'story.ts',
] as const;

describe('authenticated route coverage', () => {
  it('ユーザーデータを扱う route は auth middleware を必ず登録する', () => {
    for (const routeFile of AUTHENTICATED_ROUTE_FILES) {
      const source = readFileSync(join(process.cwd(), 'src', 'routes', routeFile), 'utf8');

      expect(source, `${routeFile} should declare auth dependency`).toContain(
        'authMiddleware: MiddlewareHandler<AppEnv>',
      );
      expect(source, `${routeFile} should register auth middleware`).toContain(
        "app.use('*', dependencies.authMiddleware)",
      );
    }
  });
});
