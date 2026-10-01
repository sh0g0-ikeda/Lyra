import {
  EPISODE_BEAT_PLAN_COMPILER_OPENAI_MODEL,
  EPISODE_PAGE_PLAN_COMPILER_OPENAI_MODEL,
  EPISODE_PLAN_AUDIT_COMPILER_OPENAI_MODEL,
} from '../../domain/constants/generation.js';
import type { OpenAIReasoningEffort } from './StructuredOpenAIResponse.js';

export const EPISODE_OPENAI_TEXT_PROFILE_KEYS = ['legacy', 'balanced_v1'] as const;

export type EpisodeOpenAITextProfileKey = (typeof EPISODE_OPENAI_TEXT_PROFILE_KEYS)[number];

export interface EpisodeOpenAIStageProfile {
  readonly model: string;
  readonly reasoningEffort: OpenAIReasoningEffort | undefined;
}

export interface EpisodeOpenAIModelProfile {
  readonly beat: EpisodeOpenAIStageProfile;
  readonly detail: EpisodeOpenAIStageProfile;
  readonly audit: EpisodeOpenAIStageProfile;
}

const episodeOpenAIModelProfiles: Readonly<
  Record<EpisodeOpenAITextProfileKey, EpisodeOpenAIModelProfile>
> = Object.freeze({
  legacy: freezeProfile({
    beat: { model: EPISODE_BEAT_PLAN_COMPILER_OPENAI_MODEL, reasoningEffort: undefined },
    detail: { model: EPISODE_PAGE_PLAN_COMPILER_OPENAI_MODEL, reasoningEffort: undefined },
    audit: { model: EPISODE_PLAN_AUDIT_COMPILER_OPENAI_MODEL, reasoningEffort: undefined },
  }),
  balanced_v1: freezeProfile({
    beat: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
    detail: { model: 'gpt-5.6-luna', reasoningEffort: 'medium' },
    audit: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
  }),
});

export function resolveEpisodeOpenAIModelProfile(
  profileKey: EpisodeOpenAITextProfileKey,
): EpisodeOpenAIModelProfile {
  return episodeOpenAIModelProfiles[profileKey];
}

function freezeProfile(profile: EpisodeOpenAIModelProfile): EpisodeOpenAIModelProfile {
  Object.freeze(profile.beat);
  Object.freeze(profile.detail);
  Object.freeze(profile.audit);
  return Object.freeze(profile);
}
