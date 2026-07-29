import {
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IOS_BUNDLE_IDENTIFIER = 'com.lyra.mobile';
const APPLE_TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/u;
const ALLOWED_UNIVERSAL_LINK_PATHS = [
  '/auth/mobile/*',
  '/invitations/*',
];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory =
  process.env.MOBILE_ASSOCIATION_OUTPUT_DIR ??
  path.resolve(scriptDirectory, '../public/.well-known');
const outputPath = path.join(outputDirectory, 'apple-app-site-association');
const temporaryOutputPath = `${outputPath}.tmp`;
const teamId = process.env.APPLE_DEVELOPER_TEAM_ID?.trim() ?? '';
const strictProduction =
  process.env.LYRA_STRICT_WEB_PRODUCTION_CONFIG === 'true';

if (teamId.length === 0) {
  rmSync(temporaryOutputPath, { force: true });
  rmSync(outputPath, { force: true });

  if (strictProduction) {
    throw new Error(
      'APPLE_DEVELOPER_TEAM_ID is required for a strict production Web build.',
    );
  }

  process.stdout.write(
    'Skipping iOS association generation outside a strict production build.\n',
  );
  process.exit(0);
}

if (!APPLE_TEAM_ID_PATTERN.test(teamId)) {
  throw new Error(
    'APPLE_DEVELOPER_TEAM_ID must contain exactly 10 uppercase ASCII letters or digits.',
  );
}

const association = {
  applinks: {
    apps: [],
    details: [
      {
        appID: `${teamId}.${IOS_BUNDLE_IDENTIFIER}`,
        paths: ALLOWED_UNIVERSAL_LINK_PATHS,
      },
    ],
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  temporaryOutputPath,
  `${JSON.stringify(association, null, 2)}\n`,
  'utf8',
);
rmSync(outputPath, { force: true });
renameSync(temporaryOutputPath, outputPath);
process.stdout.write(`Generated ${outputPath}.\n`);
