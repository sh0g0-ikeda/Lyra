import type { UiLanguage } from '@/domain/types';

// F21: distinguish visible cast, known off-panel voices, and unresolved saved
// IDs without claiming scene membership or requiring a reference assignment.
const messages = {
  ja: {
    offPanelSuffix: '（コマ外）',
    unresolvedSpeaker: '未解決の話者',
    chooseSpeaker: '話者を選択',
    missingSpeaker: '保存済みの話者がこの作品の一覧に見つかりません。まだ読み込まれていない可能性があります。話者の ID は変更せず保持しています。一覧を追加で読み込むか、この作品の話者を選んでください。',
    requiredSpeaker: 'この作品のキャラクターを話者に選んでください。コマ外のキャラクターも選べます。',
    noLoadedCharacters: 'この作品のキャラクターはまだ読み込まれていません。',
    loadMore: 'キャラクターをさらに読み込む',
    loading: 'キャラクターを読み込み中…'
  },
  en: {
    offPanelSuffix: ' (off-panel)',
    unresolvedSpeaker: 'Unresolved speaker',
    chooseSpeaker: 'Choose a speaker',
    missingSpeaker: 'The saved speaker is missing from this work’s loaded character list and may not be loaded yet. The speaker ID has been kept unchanged. Load more characters or choose a speaker from this work.',
    requiredSpeaker: 'Choose a character from this work as the speaker. Off-panel characters are also allowed.',
    noLoadedCharacters: 'No characters from this work are loaded yet.',
    loadMore: 'Load more characters',
    loading: 'Loading characters…'
  }
} as const;

export function panelDialogueMessage(language: UiLanguage, key: keyof typeof messages.ja): string {
  return messages[language][key];
}
