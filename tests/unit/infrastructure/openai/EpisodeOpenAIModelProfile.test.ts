import { describe, expect, it } from 'vitest';
import {
  EPISODE_OPENAI_TEXT_PROFILE_KEYS,
  resolveEpisodeOpenAIModelProfile,
} from '../../../../src/infrastructure/openai/EpisodeOpenAIModelProfile.js';

describe('EpisodeOpenAIModelProfile', () => {
  it('legacy profile は全 stage に gpt-5 と reasoning omitted を返す', () => {
    const profile = resolveEpisodeOpenAIModelProfile('legacy');

    expect(profile).toEqual({
      beat: { model: 'gpt-5', reasoningEffort: undefined },
      detail: { model: 'gpt-5', reasoningEffort: undefined },
      audit: { model: 'gpt-5', reasoningEffort: undefined },
    });
  });

  it('balanced_v1 profile は beat/audit に Terra、detail に Luna と medium reasoning を返す', () => {
    const profile = resolveEpisodeOpenAIModelProfile('balanced_v1');

    expect(profile).toEqual({
      beat: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
      detail: { model: 'gpt-5.6-luna', reasoningEffort: 'medium' },
      audit: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
    });
  });

  it('profile registry は bare gpt-5.6 を含めない', () => {
    const configuredModels = EPISODE_OPENAI_TEXT_PROFILE_KEYS.flatMap((key) => {
      const profile = resolveEpisodeOpenAIModelProfile(key);
      return [profile.beat.model, profile.detail.model, profile.audit.model];
    });

    expect(configuredModels).not.toContain('gpt-5.6');
  });

  it('解決した profile と各 stage は実行時にも変更できない', () => {
    for (const key of EPISODE_OPENAI_TEXT_PROFILE_KEYS) {
      const profile = resolveEpisodeOpenAIModelProfile(key);

      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.beat)).toBe(true);
      expect(Object.isFrozen(profile.detail)).toBe(true);
      expect(Object.isFrozen(profile.audit)).toBe(true);
    }
  });
});
