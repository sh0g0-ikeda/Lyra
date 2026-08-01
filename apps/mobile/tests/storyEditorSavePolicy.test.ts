import { describe, expect, it, vi } from 'vitest';

import type { EpisodeRecord, SceneRecord } from '@/domain/types';
import {
  replaceEpisodeInResponse,
  runStoryAiAfterEpisodeSave,
  saveEpisodeBeforeStoryAi,
  shouldSaveEpisodeBeforeStoryAi,
  upsertSceneInResponse
} from '@/domain/storyEditorSavePolicy';

const episode = (id: string, updatedAt: string): EpisodeRecord => ({
  chapter_id: 'chapter-1',
  climax: null,
  created_at: '2026-08-01T00:00:00.000Z',
  ending_hook: null,
  entities_involved: [],
  estimated_pages: 4,
  id,
  introduction: null,
  middle: null,
  order: 1,
  page_skeleton_generated: false,
  purpose: null,
  status: 'draft',
  story_full_draft: '本文',
  story_input_mode: 'full',
  title: '話',
  updated_at: updatedAt,
  version: 1
});

const scene = (id: string, updatedAt: string): SceneRecord => ({
  atmosphere: null,
  created_at: '2026-08-01T00:00:00.000Z',
  entity_states: [],
  episode_id: 'episode-1',
  id,
  involved_entity_ids: [],
  location: null,
  order: 1,
  status: 'draft',
  time: null,
  updated_at: updatedAt
});

describe('story editor save policy', () => {
  it('保存APIが返した話だけを一覧の最新recordへ置き換える', () => {
    const untouched = episode('episode-2', '2026-08-01T00:00:00.000Z');
    const updated = episode('episode-1', '2026-08-01T00:01:00.000Z');

    expect(replaceEpisodeInResponse(
      { episodes: [episode('episode-1', '2026-08-01T00:00:00.000Z'), untouched] },
      updated
    )).toEqual({ episodes: [updated, untouched] });
  });

  it('保存APIが返したシーンだけを一覧の最新recordへ置き換える', () => {
    const untouched = scene('scene-2', '2026-08-01T00:00:00.000Z');
    const updated = scene('scene-1', '2026-08-01T00:01:00.000Z');

    expect(upsertSceneInResponse(
      { scenes: [scene('scene-1', '2026-08-01T00:00:00.000Z'), untouched] },
      updated
    )).toEqual({ scenes: [updated, untouched] });
  });

  it('作成APIが返した新しいシーンを一覧へ追加する', () => {
    const created = scene('scene-2', '2026-08-01T00:01:00.000Z');
    const current = scene('scene-1', '2026-08-01T00:00:00.000Z');

    expect(upsertSceneInResponse({ scenes: [current] }, created)).toEqual({
      scenes: [current, created]
    });
  });

  it('保存済みの話ではStoryAI前の重複保存を行わない', () => {
    expect(shouldSaveEpisodeBeforeStoryAi({ episodeDirty: false, selectedEpisodeId: 'episode-1' })).toBe(false);
  });

  it('未保存変更と選択中の話が両方ある場合だけStoryAI前に保存する', () => {
    expect(shouldSaveEpisodeBeforeStoryAi({ episodeDirty: true, selectedEpisodeId: 'episode-1' })).toBe(true);
    expect(shouldSaveEpisodeBeforeStoryAi({ episodeDirty: true, selectedEpisodeId: null })).toBe(false);
  });

  it('保存済みの話でStoryAIを実行しても保存APIを重複実行しない', async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    await saveEpisodeBeforeStoryAi({
      episodeDirty: false,
      save,
      selectedEpisodeId: 'episode-1'
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('未保存の話ではStoryAIリクエスト前に共有保存処理を完了する', async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    await saveEpisodeBeforeStoryAi({
      episodeDirty: true,
      save,
      selectedEpisodeId: 'episode-1'
    });

    expect(save).toHaveBeenCalledOnce();
  });

  it('保存済みの話では重複保存せずStoryAIを実行する', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue('proposal');

    await expect(runStoryAiAfterEpisodeSave({
      episodeDirty: false,
      request,
      save,
      selectedEpisodeId: 'episode-1'
    })).resolves.toBe('proposal');

    expect(save).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it('未保存の話では保存完了後にStoryAIを実行する', async () => {
    const calls: string[] = [];
    const save = vi.fn(async () => {
      calls.push('save');
    });
    const request = vi.fn(async () => {
      calls.push('request');
      return 'proposal';
    });

    await runStoryAiAfterEpisodeSave({
      episodeDirty: true,
      request,
      save,
      selectedEpisodeId: 'episode-1'
    });

    expect(calls).toEqual(['save', 'request']);
  });

  it('保存に失敗した場合はStoryAIを実行しない', async () => {
    const saveError = new Error('save failed');
    const request = vi.fn().mockResolvedValue('proposal');

    await expect(runStoryAiAfterEpisodeSave({
      episodeDirty: true,
      request,
      save: vi.fn().mockRejectedValue(saveError),
      selectedEpisodeId: 'episode-1'
    })).rejects.toBe(saveError);

    expect(request).not.toHaveBeenCalled();
  });
});
