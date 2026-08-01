import { describe, expect, it } from 'vitest';

import { buildAiContentFeedback } from '@/lib/observabilityPolicy';

describe('AI生成内容の通報policy', () => {
  it('本文・画像・利用者識別子を含めず固定分類だけを送る', () => {
    const feedback = buildAiContentFeedback({
      contentKind: 'story_proposal',
      contentId: '11111111-1111-4111-8111-111111111111',
      reason: 'unsafe_or_inappropriate',
    });

    expect(feedback).toEqual({
      message: 'AI-generated content was reported in Lyra Mobile.',
      source: 'lyra_mobile_ai_content_report',
      tags: {
        content_kind: 'story_proposal',
        content_id: '11111111-1111-4111-8111-111111111111',
        reason: 'unsafe_or_inappropriate',
      },
    });
    expect(JSON.stringify(feedback)).not.toContain('story body');
    expect(JSON.stringify(feedback)).not.toContain('image_url');
    expect(JSON.stringify(feedback)).not.toContain('email');
    expect(JSON.stringify(feedback)).not.toContain('user_id');
  });

  it('不正なcontent IDはpayloadへ含めない', () => {
    expect(buildAiContentFeedback({
      contentKind: 'generated_image',
      contentId: 'story body@example.test',
      reason: 'unsafe_or_inappropriate',
    }).tags).toEqual({
      content_kind: 'generated_image',
      reason: 'unsafe_or_inappropriate',
    });
  });

  it('許可されていない分類は通報payloadにできない', () => {
    expect(() => buildAiContentFeedback({
      contentKind: 'raw_prompt' as never,
      reason: 'unsafe_or_inappropriate',
    })).toThrow('Unsupported AI content report category.');
  });
});
