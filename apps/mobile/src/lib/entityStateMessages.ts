import type { UiLanguage } from '@/domain/types';
export const entityStateMessages = {
  ja: {
    title: 'キャラクターの状態', default: 'default（基本）', newState: '状態を追加', name: '状態名', description: '自由入力',
    nameExample: '例：外傷', descriptionExample: '例：左頬に傷、右腕に包帯。服装や髪型は基本のまま。',
    base: '参照するdefault画像', baseMissing: '先にキャラクターの基本画像を確定してください。',
    save: '状態を保存', saved: '状態を保存しました。画像はまだ変更されていません。', invalid: '状態名と自由入力を入力してください。',
    dirty: 'プレビューの前に状態とキャラクターの変更を保存してください。', permission: 'この操作の権限がありません。',
    unavailable: '状態画像のプレビューは現在利用できません。', checking: '状態・画像・ジョブを確認しています。',
    legacyName: '旧形式の状態',
    legacy: '旧形式の状態です。保存済みの衣装・表情などは保持されます。',
    draft: '未確定', confirmed: '確定済み', stale: '変更が画像に未反映',
    retained: '以前の確定画像は保持されています。変更を反映するには新しいプレビューを確定してください。',
    preview: 'プレビューを生成（{cost}クレジット）', previewConfirm: '「{name}」の状態画像をdefault画像から生成します。{cost}クレジットを消費します。基本画像と以前の確定画像は変更されません。',
    noBalance: '残高を確認してからプレビューしてください。', insufficient: 'クレジットが不足しています。マイページで残高を確認してください。',
    processing: '状態画像を生成しています。完了後に候補を選択して確定してください。',
    candidate: '画像候補', selectCandidate: 'この候補を選択', confirm: '選択した候補を状態画像に確定',
    confirmedDone: '状態画像を確定しました。基本画像は変更されていません。',
    staleCandidate: '状態または基本画像が変更されています。最新の状態を確認してプレビューを作り直してください。',
    unknown: '受付結果を確認できません。再生成せず、ジョブと残高を確認してください。',
    refresh: '最新の状態を読み込む', noStates: '保存済みの状態はありません。',
    missing: '保存済みの状態が見つかりません。変更せず保持しています。', notReady: '未確定または変更が未反映の状態は新しく選択できません。',
    returnPages: 'ページ設定に戻る', imageUnavailable: '画像を読み込めませんでした。',
    selected: '選択中', error: '状態の操作を完了できませんでした。入力と以前の確定画像は保持されています。'
  },
  en: {
    title: 'Character states', default: 'default (base)', newState: 'Add a state', name: 'State name', description: 'Description',
    nameExample: 'Example: Injured', descriptionExample: 'Example: A cut on the left cheek and a bandage on the right arm. Keep the base outfit and hairstyle.',
    base: 'Default reference image', baseMissing: 'Confirm a base character image first.',
    save: 'Save state', saved: 'State saved. Images have not changed.', invalid: 'Enter a state name and description.',
    dirty: 'Save state and character changes before previewing.', permission: 'Your role cannot perform this action.',
    unavailable: 'State image previews are currently unavailable.', checking: 'Checking states, images, and jobs.',
    legacyName: 'Legacy state',
    legacy: 'This is a legacy state. Its saved outfit, expression, and other notes are preserved.',
    draft: 'Draft', confirmed: 'Confirmed', stale: 'Changes not reflected in image',
    retained: 'The previous confirmed image is preserved. Confirm a new preview to apply your changes.',
    preview: 'Generate preview ({cost} credit)', previewConfirm: 'Generate the “{name}” state image from its default reference for {cost} credit. The base and previous confirmed images will not change.',
    noBalance: 'Check the balance before generating a preview.', insufficient: 'Insufficient credits. Check your balance in My Page.',
    processing: 'Generating the state image. Select and confirm a candidate when it is ready.',
    candidate: 'Image candidate', selectCandidate: 'Select this candidate', confirm: 'Confirm selected state image',
    confirmedDone: 'State image confirmed. The base image has not changed.',
    staleCandidate: 'The state or base image has changed. Review the latest state and generate a new preview.',
    unknown: 'The request result is unknown. Check jobs and your balance before generating again.',
    refresh: 'Reload latest state', noStates: 'No saved states yet.',
    missing: 'The saved state could not be found. Its selection is preserved.', notReady: 'Draft or outdated states cannot be newly selected.',
    returnPages: 'Return to page settings', imageUnavailable: 'The image could not be loaded.',
    selected: 'Selected', error: 'The state action could not be completed. Your input and previous confirmed image are preserved.'
  }
} as const;
export function stateMessage(language: UiLanguage, key: keyof typeof entityStateMessages.ja, params: Record<string, string | number> = {}): string {
  return Object.entries(params).reduce<string>((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), entityStateMessages[language][key]);
}
