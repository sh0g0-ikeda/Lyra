import { z } from 'zod';
import type { UiLanguage } from '@/domain/types';

export const workDeletionSchema = z.object({
  deletion_id: z.string().uuid(),
  work_id: z.string().uuid(),
  status: z.enum(['pending', 'processing', 'pending_external_action', 'completed']),
  blocker_code: z.string().min(1).max(120).nullable(),
}).strict();
export const workDeletionsSchema = z.object({ deletions: z.array(workDeletionSchema).max(50) }).strict();
export type WorkDeletionRecord = z.infer<typeof workDeletionSchema>;
export type WorkDeletionsRecord = z.infer<typeof workDeletionsSchema>;

const workDeletionMessages = {
  ja: {
    heading: '作品削除の進行状況',
    workId: '対象作品: {workId}',
    pending: '永久削除を受付済みです。完了するまで待っています。',
    processing: '作品、章、話、画像の削除処理中です。',
    pendingExternal: '外部保存データの安全な削除を再試行しています。',
    completed: '作品と紐づくデータ・画像を削除しました。',
    statusUnavailable: '削除状態を確認できません。受付済みの状態を保持して再確認します。',
    refresh: '削除状態を再確認',
    deleteMenu: '作品を永久削除',
    deleteTitle: '作品を永久削除',
    deleteWarning: '「{title}」と、その章・話・編集内容・この作品に紐づく画像を永久に削除します。削除後は元に戻せません。未保存の編集がある場合は先に確認します。',
    activeConflict: '処理が進行中、または保存結果などの安全確認が必要です。処理の完了・取消後も削除できない場合は、サポートへお問い合わせください。',
    blockerState: '関連データを安全に切り離せないため保留中です。サーバーが自動で再試行します。',
    blockerAsset: '画像または保存ファイルを安全に削除できなかったため保留中です。サーバーが自動で再試行します。',
    blockerFinal: '生成・書き出しまたは関連データの最終確認で保留中です。進行中の処理を完了または取り消すと再試行されます。',
    blockerUnknown: '安全な削除条件を確認しているため保留中です。サーバーが自動で再試行します。'
  },
  en: {
    heading: 'Work deletion status',
    workId: 'Work: {workId}',
    pending: 'Permanent deletion was accepted and is waiting to run.',
    processing: 'Deleting the work, chapters, episodes, and images.',
    pendingExternal: 'Retrying safe deletion of externally stored data.',
    completed: 'The work and its associated data and images were deleted.',
    statusUnavailable: 'Deletion status could not be confirmed. The accepted status is retained while the app checks again.',
    refresh: 'Check deletion status',
    deleteMenu: 'Permanently delete work',
    deleteTitle: 'Permanently delete work',
    deleteWarning: 'Permanently delete “{title}”, including its chapters, episodes, edits, and images associated with this work. This cannot be undone. Any unsaved edits will be reviewed first.',
    activeConflict: 'A process is still running, or a saved result needs a safety check. If deletion is still unavailable after the process finishes or is canceled, contact support.',
    blockerState: 'Deletion is paused because related data could not be detached safely. The server will retry automatically.',
    blockerAsset: 'Deletion is paused because an image or stored file could not be erased safely. The server will retry automatically.',
    blockerFinal: 'Deletion is paused during final checks for generation, export, or related data. It will retry after active work finishes or is canceled.',
    blockerUnknown: 'Deletion is paused while safe deletion conditions are checked. The server will retry automatically.'
  }
} as const;

export type WorkDeletionMessageKey = keyof typeof workDeletionMessages.ja;

export const workDeletionMessage = (
  language: UiLanguage,
  key: WorkDeletionMessageKey,
  values: Readonly<Record<string, string | number>> = {}
): string => Object.entries(values).reduce<string>(
  (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
  workDeletionMessages[language][key]
);

const blockerMessageKeys: Readonly<Record<string, WorkDeletionMessageKey>> = {
  STATE_REFERENCE_FENCING_UNAVAILABLE: 'blockerState',
  ASSET_INVENTORY_FAILED: 'blockerAsset',
  ASSET_ERASURE_FAILED: 'blockerAsset',
  FINAL_REVALIDATION_BLOCKED: 'blockerFinal'
};

export const workDeletionBlockerMessage = (language: UiLanguage, blockerCode: string | null): string =>
  workDeletionMessage(language, blockerCode === null ? 'pendingExternal' : blockerMessageKeys[blockerCode] ?? 'blockerUnknown');
