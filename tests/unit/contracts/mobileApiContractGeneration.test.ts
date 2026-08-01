import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const generatedHeader =
  '// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.\n';
const compatibilityExport = `export {
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

describe('Mobile API contract generation', () => {
  it('canonical schemaをMobile生成物へbyte-stableに反映する', async () => {
    const canonical = normalizeNewlines(
      await readFile('packages/api-contract/src/mobileApiSchemas.ts', 'utf8'),
    );
    const generated = await readFile('apps/mobile/src/domain/apiSchemas.ts', 'utf8');

    expect(generated).toBe(`${generatedHeader}${canonical}\n${compatibilityExport}`);
  });

  it('生成物が最新の場合にcheck commandが成功する', async () => {
    await expect(
      execFileAsync(process.execPath, ['scripts/generateMobileApiContract.mjs', '--check']),
    ).resolves.toMatchObject({ stderr: '' });
  });
});

function normalizeNewlines(content: string): string {
  return content.replace(/\r\n?/gu, '\n');
}
