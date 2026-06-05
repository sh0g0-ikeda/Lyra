import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIStoryEpisodeImprovementPlanner } from '../../../../src/infrastructure/openai/OpenAIStoryEpisodeImprovementPlanner.js';

describe('OpenAIStoryEpisodeImprovementPlanner', () => {
  it('editable draft と stored episode が同じ場合は stored episode 本文を再掲しない', async () => {
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
              title: buildSection(),
              purpose: buildSection(),
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
      baseDraft: {
        title: 'Episode 1',
        purpose: 'Introduce the rivalry',
        storyInputMode: 'structured',
        storyFullDraft: null,
        introduction: 'Current intro',
        middle: 'Current middle',
        climax: 'Current climax',
        endingHook: 'Current hook',
      },
      context: {
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
      },
    });

    const input = requests[0]?.input as Array<{ content: Array<{ text: string }> }>;
    const userPrompt = input[1]?.content[0]?.text ?? '';
    expect(userPrompt).toContain('Current stored episode: same as current editable draft.');
    expect(userPrompt).not.toContain('Current stored episode:\nTitle: Episode 1');
  });
});

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
