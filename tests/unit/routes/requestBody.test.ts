import { describe, expect, it } from 'vitest';
import { readLimitedRawBody } from '../../../src/routes/requestBody.js';

describe('request body helpers', () => {
  it('Content-Length が上限を超える場合に body を読まず 413 にする', async () => {
    const request = new Request('https://lyra.test/api', {
      method: 'POST',
      body: '{}',
    });

    await expect(
      readLimitedRawBody(request, '4', {
        maxBytes: 3,
        description: 'Test request',
      }),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      statusCode: 413,
    });
  });

  it('Content-Length がない場合も読み取り中に上限超過を検出する', async () => {
    const request = new Request('https://lyra.test/api', {
      method: 'POST',
      body: 'abcd',
    });

    await expect(
      readLimitedRawBody(request, undefined, {
        maxBytes: 3,
        description: 'Test request',
      }),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      statusCode: 413,
    });
  });

  it('Content-Length が不正な場合は validation error にする', async () => {
    const request = new Request('https://lyra.test/api', {
      method: 'POST',
      body: '{}',
    });

    await expect(
      readLimitedRawBody(request, '-1', {
        maxBytes: 3,
        description: 'Test request',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 422,
    });
  });
});
