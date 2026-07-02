import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIStoryEpisodeImprovementPlanner } from '../../../../src/infrastructure/openai/OpenAIStoryEpisodeImprovementPlanner.js';

describe('OpenAIStoryEpisodeImprovementPlanner', () => {
  it('does not resend stored episode body when editable draft matches it', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: {
            output_text: JSON.stringify({
              story_objective: 'Clarify the episode.',
              must_preserve: [],
              continuity_guards: [],
              page_adaptation_notes: [],
              introduction: buildSection(),
              middle: buildSection(),
              climax: buildSection(),
              ending_hook: buildSection(),
            }),
          },
          requestId: 'req-1',
        };
      },
    } as unknown as OpenAIClient;
    const planner = new OpenAIStoryEpisodeImprovementPlanner(client);

    await planner.planEpisodeImprovement({
      instruction: 'Tighten the draft.',
      language: 'ja',
      baseDraft: createDraft(),
      context: createContext(),
    });

    const input = requests[0]?.input as Array<{ content: Array<{ text: string }> }>;
    const userPrompt = input[1]?.content[0]?.text ?? '';
    expect(userPrompt).toContain('Current stored episode: same as current editable draft.');
    expect(userPrompt).not.toContain('Current stored episode:\nStory input mode: structured');
  });

  it('compacts long context before sending the planning request', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: {
            output_text: JSON.stringify({
              story_objective: 'Clarify the episode.',
              must_preserve: [],
              continuity_guards: [],
              page_adaptation_notes: [],
              introduction: buildSection(),
              middle: buildSection(),
              climax: buildSection(),
              ending_hook: buildSection(),
            }),
          },
          requestId: 'req-1',
        };
      },
    } as unknown as OpenAIClient;
    const planner = new OpenAIStoryEpisodeImprovementPlanner(client);
    const longDescription = 'planner-overflow-entity-detail '.repeat(80).trim();

    await planner.planEpisodeImprovement({
      instruction: 'Tighten the draft.',
      language: 'ja',
      baseDraft: createDraft(),
      context: {
        ...createContext(),
        entities: [
          {
            id: 'entity-1',
            name: 'Aki',
            aliases: ['Long Alias '.repeat(20)],
            entityType: 'character',
            freeDescription: longDescription,
          },
        ],
        sceneSummaries: Array.from({ length: 60 }, (_unused, index) => `Scene ${index + 1}: planning scene ${index + 1}`),
      },
    });

    const input = requests[0]?.input as Array<{ content: Array<{ text: string }> }>;
    const userPrompt = input[1]?.content[0]?.text ?? '';
    expect(userPrompt).toContain('planner-overflow-entity-detail');
    expect(userPrompt).not.toContain(longDescription);
    expect(userPrompt).not.toContain('Scene 60: planning scene 60');
  });
});

function createDraft() {
  return {
    title: 'Episode 1',
    purpose: 'Introduce the rivalry',
    storyInputMode: 'structured' as const,
    storyFullDraft: null,
    introduction: 'Current intro',
    middle: 'Current middle',
    climax: 'Current climax',
    endingHook: 'Current hook',
  };
}

function createContext() {
  return {
    episodeId: 'episode-1',
    chapterId: 'chapter-1',
    workId: 'work-1',
    workTitle: 'Lyra',
    workGenre: 'dark fantasy',
    worldSetting: 'A fractured time city.',
    theme: 'Responsibility',
    overallFlow: 'A reluctant girl joins a time-repair organization.',
    chapterTitle: 'Chapter 1',
    chapterPurpose: 'Start the story.',
    chapterStartingState: 'Mio is alone.',
    chapterEndingState: 'Mio sees the organization.',
    chapterEmotionCurve: 'fear -> resolve',
    episodeTitle: 'Episode 1',
    episodePurpose: 'Introduce the rivalry',
    introduction: 'Current intro',
    middle: 'Current middle',
    climax: 'Current climax',
    endingHook: 'Current hook',
    estimatedPages: 16,
    entities: [],
    sceneSummaries: [],
    chapterSummaries: [],
    siblingEpisodeSummaries: [],
  };
}

function buildSection(): Record<string, unknown> {
  return {
    objective: 'Improve clarity.',
    must_include: [],
    visual_beats: [],
    narration_hints: [],
    continuity_guards: [],
    avoid: [],
  };
}
