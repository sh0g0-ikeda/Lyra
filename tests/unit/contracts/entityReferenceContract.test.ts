import { describe, expect, it } from 'vitest';
import {
  entityImportResponseSchema,
  entityReferenceGenerationResponseSchema,
  entityReferenceSetSchema,
  entityReferenceUploadPresignResponseSchema,
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

  it('direct upload responseはHTTPS・固定header・opaque tokenだけを許可する', () => {
    const valid = {
      upload_url: 'https://uploads.lyra.test/presigned',
      upload_token: 'opaque-token',
      expires_at: '2026-07-31T00:05:00.000Z',
      upload_headers: {
        'Content-Type': 'image/png',
        'x-amz-server-side-encryption': 'AES256',
      },
    };

    expect(entityReferenceUploadPresignResponseSchema.safeParse(valid).success).toBe(true);
    expect(entityReferenceUploadPresignResponseSchema.safeParse({
      ...valid,
      upload_url: 'http://uploads.lyra.test/unsafe',
    }).success).toBe(false);
    expect(entityReferenceUploadPresignResponseSchema.safeParse({
      ...valid,
      s3_key: 'tmp/private.png',
    }).success).toBe(false);
    expect(entityReferenceUploadPresignResponseSchema.safeParse({
      ...valid,
      upload_headers: {
        ...valid.upload_headers,
        'x-amz-meta-user-input': 'not-allowed',
      },
    }).success).toBe(false);
  });
});
