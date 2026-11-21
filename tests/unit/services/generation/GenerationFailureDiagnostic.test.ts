import { describe, expect, it } from 'vitest';
import { ConfigurationError, ValidationError } from '../../../../src/domain/errors/index.js';
import { StructuredOpenAIResponseError } from '../../../../src/infrastructure/openai/StructuredOpenAIResponse.js';
import { generationFailureDiagnostic } from '../../../../src/services/generation/GenerationFailureDiagnostic.js';

describe('画像生成の失敗診断', () => {
  it('監査AIの出力不正を利用者の入力不正と区別できる', () => {
    expect(generationFailureDiagnostic(new ValidationError('Page pre-render scene audit targets an unassigned entity')))
      .toEqual({ reason: 'scene_audit_unassigned_entity', errorType: 'validation' });
    expect(generationFailureDiagnostic(new StructuredOpenAIResponseError('private response body', 'incomplete_max_output_tokens', true, 'request')))
      .toEqual({ reason: 'structured_incomplete_max_output_tokens', errorType: 'structured_response' });
  });

  it('未知の例外は本文や署名URLや認証情報をログへ含めない', () => {
    for (const error of [new Error('secret https://private.test?token=secret'), new ConfigurationError('private story'), new ValidationError('private profile')]) {
      const result = JSON.stringify(generationFailureDiagnostic(error));
      expect(result).not.toMatch(/secret|private|https/u);
    }
  });
});
