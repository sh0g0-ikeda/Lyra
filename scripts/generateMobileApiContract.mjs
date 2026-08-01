import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const generatedHeader =
  '// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.\n';
const compatibilityExport =
  `export {
  accountDeletionPreviewSchema,
  accountDeletionResultSchema,
  apiErrorBodySchema,
  createEpisodeExportResponseSchema,
  entityReferenceGenerationAvailabilitySchema,
  exportJobSchema,
  generationJobSchema,
  generationJobsResponseSchema,
  jobAcceptedSchema,
  layoutTemplateResponseSchema,
  organizationBillingSummarySchema,
  organizationCreditCheckoutSchema,
  organizationCustomerPortalSchema,
  organizationInvitationActionResponseSchema,
  organizationInvitationPreviewSchema,
  organizationInvitationUpdateResponseSchema,
  organizationMemberUpdateResponseSchema,
  organizationPlansResponseSchema,
  organizationSubscriptionCheckoutSchema,
  organizationUpdateResponseSchema,
  organizationWorkspaceDetailSchema,
  organizationWorkspacesResponseSchema,
  pageGenerationReadinessSchema,
  pageLayoutTemplatesResponseSchema,
  pushTokenRegistrationSchema,
  saveAndGeneratePageResponseSchema,
} from './mobileCompatibilitySchemas';
`;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonicalPath = resolve(
  projectRoot,
  'packages/api-contract/src/mobileApiSchemas.ts',
);
const generatedPath = resolve(
  projectRoot,
  'apps/mobile/src/domain/apiSchemas.ts',
);
const checkOnly = process.argv.slice(2).includes('--check');

const canonical = normalizeNewlines(await readFile(canonicalPath, 'utf8'));
const expected = `${generatedHeader}${canonical}\n${compatibilityExport}`;

if (checkOnly) {
  await checkGeneratedContract(expected);
} else {
  await mkdir(dirname(generatedPath), { recursive: true });
  await writeFile(generatedPath, expected, 'utf8');
  process.stdout.write(`Wrote ${relativePath(generatedPath)}\n`);
}

async function checkGeneratedContract(expected) {
  let generated;
  try {
    generated = await readFile(generatedPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      process.stderr.write(`generated file is missing: ${relativePath(generatedPath)}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (generated !== expected) {
    process.stderr.write(`generated file is stale: ${relativePath(generatedPath)}\n`);
    process.exitCode = 1;
  }
}

function normalizeNewlines(content) {
  return content.replace(/\r\n?/gu, '\n');
}

function relativePath(path) {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function isMissingFileError(error) {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}
