import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/domain/errors/index.js';
import {
  buildEpisodeExportArtifactKey,
  buildEpisodeExportRequestFingerprint,
  normalizeEpisodeExportFilename,
  parseEpisodeExportPageSnapshot,
} from '../../../src/domain/episodeExportJob.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const episodeId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const pageId = '55555555-5555-4555-8555-555555555555';

describe('episode export job domain', () => {
  it('artifact keyをDB契約どおりserver-owned scopeから組み立てる', () => {
    expect(buildEpisodeExportArtifactKey({
      userId,
      organizationId: null,
      episodeId,
      jobId,
      format: 'pdf',
    })).toBe(`exports/${userId}/episodes/${episodeId}/${jobId}.pdf`);

    expect(buildEpisodeExportArtifactKey({
      userId,
      organizationId,
      episodeId,
      jobId,
      format: 'zip',
    })).toBe(`exports/${organizationId}/episodes/${episodeId}/${jobId}.zip`);
  });

  it('filenameからpathと制御文字を除きUnicode basenameと形式を保持する', () => {
    expect(normalizeEpisodeExportFilename('../../緋色の研究.PDF', 'pdf'))
      .toBe('緋色の研究.pdf');
    expect(normalizeEpisodeExportFilename('bad\r\nname.zip', 'zip'))
      .toBe('bad--name.zip');
    expect(normalizeEpisodeExportFilename('..', 'pdf')).toBe('lyra-export.pdf');
  });

  it('page順序を含む安定fingerprintを作り順序変更を別requestとして扱う', () => {
    const first = buildEpisodeExportRequestFingerprint({
      episodeId,
      format: 'pdf',
      filename: 'story.pdf',
      pageIds: [pageId, jobId],
    });
    const same = buildEpisodeExportRequestFingerprint({
      episodeId,
      format: 'pdf',
      filename: 'story.pdf',
      pageIds: [pageId, jobId],
    });
    const reordered = buildEpisodeExportRequestFingerprint({
      episodeId,
      format: 'pdf',
      filename: 'story.pdf',
      pageIds: [jobId, pageId],
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(same).toBe(first);
    expect(reordered).not.toBe(first);
  });

  it('snapshotをboundedな既知fieldだけへ検証し不正keyを拒否する', () => {
    expect(parseEpisodeExportPageSnapshot([{
      page_id: pageId,
      page_number: 1,
      s3_key: `saved/${userId}/pages/${pageId}_final.png`,
      mime_type: 'image/png',
    }])).toEqual([{
      pageId,
      pageNumber: 1,
      s3Key: `saved/${userId}/pages/${pageId}_final.png`,
      mimeType: 'image/png',
    }]);

    expect(() => parseEpisodeExportPageSnapshot([{
      page_id: pageId,
      page_number: 1,
      s3_key: '../private.png',
      mime_type: 'image/png',
    }])).toThrow(ValidationError);
  });
});
