import type { UiLanguage } from '@/domain/types';

const messages = {
  ja: {
    startingTitle: '話の開始状態',
    startingHelp: 'この話が始まる時点の人物の状態です。指定がない人物はdefaultから始まります。前の話から自動で引き継ぎません。',
    startingEmpty: '全員defaultから開始します。',
    startingAdd: '開始状態を指定する人物',
    startingRemove: '指定を外す',
    startingReset: '全員defaultに戻す',
    startingUnknown: '未読込の人物（保存済みの指定は保持されています）',
    startingUnavailable: 'この接続先では開始状態の編集を利用できません。保存済みの指定は保持されます。',
    startingLimit: '開始状態は最大100人まで指定できます。',
    autofillTitle: 'ストーリーに沿った人物状態',
    autofillEnabled: '人物の状態変化も自動入力する（無料）',
    autofillHelp: '保存済みの本文と開始状態から、状態の変化と継続を全ページへ反映します。必要な状態画像が未確定の場合は設定を変更せず停止します。',
    overwrite: '既存の人物状態の指定を上書きする',
    preserveHelp: '既存の指定を保護します。結果が競合した場合は変更せず停止します。',
    overwriteWarning: '話の全ページ・全コマにある人物状態の指定を置き換えます。defaultに戻る箇所では既存の状態指定が解除されます。',
    stateConfirmation: '人物の状態変化も自動入力します。本文の自動入力は無料です。画像の生成・状態画像のプレビューは行いません。',
    blockerTitle: '状態の確認が必要です',
    blockerHelp: '今回の自動入力ではページ・コマ設定を変更していません。必要な状態を確認・確定してから、自動入力をもう一度実行してください。',
    openCandidate: 'この人物の状態を確認・作成',
    candidateBoundary: '変更が始まるコマ',
    candidateEvidence: '保存本文の根拠',
    returnPages: 'ページに戻る',
    conflict: '既存の状態指定と競合しています。上書き範囲を確認するか、本文・開始状態を見直してください。',
    invalid: '状態の計画を安全に確定できませんでした。本文や状態の指定を見直して再試行してください。',
    transitionsTitle: '反映された状態の変化',
    moreTransitions: '状態変化をさらに表示',
    defaultState: 'default',
    candidateUnavailable: 'この人物を現在の作品で確認できません。作品と状態一覧を再読み込みしてください。'
  },
  en: {
    startingTitle: 'Episode starting states',
    startingHelp: 'Choose character states at the start of this episode. Unspecified characters start at default. States are not inherited from the previous episode.',
    startingEmpty: 'Everyone starts at default.',
    startingAdd: 'Choose a character for a starting state',
    startingRemove: 'Remove assignment',
    startingReset: 'Reset everyone to default',
    startingUnknown: 'Character not loaded (saved assignment retained)',
    startingUnavailable: 'Starting-state editing is unavailable on this server. Saved assignments are retained.',
    startingLimit: 'Up to 100 character starting states can be assigned.',
    autofillTitle: 'Story-driven character states',
    autofillEnabled: 'Autofill character state changes too (free)',
    autofillHelp: 'Use the saved story and starting states to apply changes and continuity across the episode. Missing confirmed state images stop the operation without changing settings.',
    overwrite: 'Overwrite existing character state assignments',
    preserveHelp: 'Existing assignments are protected. Conflicting results stop without making changes.',
    overwriteWarning: 'This replaces character state assignments in every panel of this episode. Existing state assignments are cleared wherever the result returns a character to default.',
    stateConfirmation: 'Character state changes will also be autofilled. Text autofill is free. This does not generate images or paid state previews.',
    blockerTitle: 'Review character states',
    blockerHelp: 'This autofill attempt did not change page or panel settings. Review and confirm the required states, then explicitly run autofill again.',
    openCandidate: 'Review or create this character state',
    candidateBoundary: 'First affected panel',
    candidateEvidence: 'Evidence from the saved story',
    returnPages: 'Return to pages',
    conflict: 'The result conflicts with existing state assignments. Review the overwrite scope, or revise the story and starting states.',
    invalid: 'A safe state plan could not be confirmed. Review the story and states, then retry.',
    transitionsTitle: 'Applied state transitions',
    moreTransitions: 'Show more state transitions',
    defaultState: 'default',
    candidateUnavailable: 'This character could not be verified in the current work. Reload the work and its character states.'
  }
} as const;

export function episodeStateMessage(language: UiLanguage, key: keyof typeof messages.ja): string {
  return messages[language][key];
}
