import { describe, expect, it } from 'vitest';
import {
  entityImportResponseSchema,
  entityReferenceGenerationResponseSchema,
  entityReferenceSetSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validReferenceSet = {
  entity_id: 'entity-1',
  primary_ref_id: null,
  status: 'empty',
  updated_at: '2026-07-30T00:00:00.000Z',
  reference_images: [],
};

describe('Entity reference response contract', () => {
  it('空のreference set・署名URL省略・import・生成受付を受理する', () => {
    expect(entityReferenceSetSchema.safeParse(validReferenceSet).success).toBe(true);
    expect(
      entityReferenceSetSchema.safeParse({
        ...validReferenceSet,
        primary_ref_id: 'ref-1',
        status: 'partial',
        reference_images: [
          {
            ref_id: 'ref-1',
            source: 'upload',
            created_at: '2026-07-30T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      entityImportResponseSchema.safeParse({
        suggested_fields: {},
        prompt_supplement: '',
        tmp_image_token: 'token',
      }).success,
    ).toBe(true);
    expect(entityReferenceGenerationResponseSchema.safeParse({ job_id: 'job-1' }).success).toBe(true);
  });

  it('内部S3 key・未知status/source・objectでないsuggestion・空job IDを拒否する', () => {
    expect(
      entityReferenceSetSchema.strict().safeParse({
        ...validReferenceSet,
        s3_key: 'saved/private.png',
      }).success,
    ).toBe(false);
    expect(
      entityReferenceSetSchema.safeParse({ ...validReferenceSet, status: 'failed' }).success,
    ).toBe(false);
    expect(
      entityReferenceSetSchema.safeParse({
        ...validReferenceSet,
        reference_images: [
          {
            ref_id: 'ref-1',
            source: 'legacy',
            created_at: '2026-07-30T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      entityImportResponseSchema.safeParse({
        suggested_fields: [],
        prompt_supplement: '',
        tmp_image_token: 'token',
      }).success,
    ).toBe(false);
    expect(entityReferenceGenerationResponseSchema.safeParse({ job_id: '' }).success).toBe(false);
  });
});
