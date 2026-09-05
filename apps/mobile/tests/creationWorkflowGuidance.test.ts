import { describe, expect, it } from 'vitest';

import {
  resolveCharacterWorkflowNextStep,
  shouldShowStoryNextStep
} from '@/domain/creationWorkflowGuidance';

describe('制作フローの次工程案内', () => {
  it('保存済みのストーリー本文がある場合だけキャラクター設定を案内する', () => {
    expect(
      shouldShowStoryNextStep({
        hasSelectedEpisode: true,
        hasUnsavedChanges: false,
        storyDraft: '主人公が夜の駅へ向かう。'
      })
    ).toBe(true);

    expect(
      shouldShowStoryNextStep({
        hasSelectedEpisode: true,
        hasUnsavedChanges: true,
        storyDraft: 'まだ保存していない変更'
      })
    ).toBe(false);
    expect(
      shouldShowStoryNextStep({
        hasSelectedEpisode: true,
        hasUnsavedChanges: false,
        storyDraft: '   '
      })
    ).toBe(false);
    expect(
      shouldShowStoryNextStep({
        hasSelectedEpisode: false,
        hasUnsavedChanges: false,
        storyDraft: '選択されていない話'
      })
    ).toBe(false);
  });

  it('保存済みキャラは最初にプレビュー画像の作成を案内する', () => {
    expect(
      resolveCharacterWorkflowNextStep({
        confirmedPreviewCount: 0,
        hasActivePreviewJob: false,
        hasJustConfirmedPreview: false,
        hasPreviewCandidate: false,
        hasResolvedPreviewState: true,
        hasSavedCharacter: true,
        hasUnsavedChanges: false
      })
    ).toBe('create-preview');
  });

  it('プレビュー候補ができたら確定を最優先で案内する', () => {
    expect(
      resolveCharacterWorkflowNextStep({
        confirmedPreviewCount: 1,
        hasActivePreviewJob: false,
        hasJustConfirmedPreview: false,
        hasPreviewCandidate: true,
        hasResolvedPreviewState: false,
        hasSavedCharacter: true,
        hasUnsavedChanges: true
      })
    ).toBe('confirm-preview');
  });

  it('プレビュー確定後はページ設定を案内する', () => {
    expect(
      resolveCharacterWorkflowNextStep({
        confirmedPreviewCount: 1,
        hasActivePreviewJob: false,
        hasJustConfirmedPreview: false,
        hasPreviewCandidate: false,
        hasResolvedPreviewState: true,
        hasSavedCharacter: true,
        hasUnsavedChanges: false
      })
    ).toBe('open-pages');
  });

  it('未保存・未作成・生成中は重複する次工程を案内しない', () => {
    const base = {
      confirmedPreviewCount: 0,
      hasActivePreviewJob: false,
      hasJustConfirmedPreview: false,
      hasPreviewCandidate: false,
      hasResolvedPreviewState: true,
      hasSavedCharacter: true,
      hasUnsavedChanges: false
    } as const;

    expect(
      resolveCharacterWorkflowNextStep({ ...base, hasSavedCharacter: false })
    ).toBeNull();
    expect(
      resolveCharacterWorkflowNextStep({ ...base, hasUnsavedChanges: true })
    ).toBeNull();
    expect(
      resolveCharacterWorkflowNextStep({ ...base, hasActivePreviewJob: true })
    ).toBeNull();
    expect(
      resolveCharacterWorkflowNextStep({ ...base, hasResolvedPreviewState: false })
    ).toBeNull();
  });

  it('画像取り込みの未保存候補を確定した直後はページ設定を案内する', () => {
    expect(
      resolveCharacterWorkflowNextStep({
        confirmedPreviewCount: 0,
        hasActivePreviewJob: false,
        hasJustConfirmedPreview: true,
        hasPreviewCandidate: false,
        hasResolvedPreviewState: false,
        hasSavedCharacter: true,
        hasUnsavedChanges: true
      })
    ).toBe('open-pages');
  });
});
