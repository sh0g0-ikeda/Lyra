import { describe, expect, it } from 'vitest';

import { appendAiProviderDisclosure } from '@/lib/aiProviderDisclosure';

describe('AI provider送信前の説明', () => {
  it('日本語では送信対象とOpenAIを明記する', () => {
    expect(appendAiProviderDisclosure('既存の確認文です。', 'ja', 'text')).toBe(
      '既存の確認文です。\n\n続行すると、入力した本文・設定をAI生成のためOpenAIへ送信することに同意したものとします。'
    );
  });

  it('英語では画像送信と同意を明記する', () => {
    expect(appendAiProviderDisclosure('Existing confirmation.', 'en', 'image')).toBe(
      'Existing confirmation.\n\nBy continuing, you consent to sending the selected image to OpenAI for AI processing.'
    );
  });
});
