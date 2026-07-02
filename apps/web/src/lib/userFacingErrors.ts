export type UserFacingErrorLanguage = 'ja' | 'en';

interface UserFacingErrorInput {
  message?: string | null;
  code?: string | null;
  status?: number | null;
}

interface LocalizedMessage {
  en: string;
  ja: string;
}

interface ErrorWithApiFields extends Error {
  status?: number;
  code?: string | null;
}

const messages = {
  generic: {
    en: 'The operation failed. Save your changes, wait a moment, then try again.',
    ja: '処理に失敗しました。入力内容を保存し、少し待ってからもう一度お試しください。',
  },
  network: {
    en: 'Could not connect to the server. Check your connection, reload the page, then try again.',
    ja: 'サーバーに接続できませんでした。通信状況を確認し、ページを再読み込みしてからもう一度お試しください。',
  },
  authExpired: {
    en: 'Your login session expired. Please sign in again.',
    ja: 'ログインの有効期限が切れました。もう一度ログインしてください。',
  },
  authNotConfirmed: {
    en: 'Email verification is not complete. Open the verification email, then sign in again.',
    ja: 'メール確認が完了していません。確認メールのリンクを開いてから、もう一度ログインしてください。',
  },
  forbidden: {
    en: 'This account cannot perform that operation. Check that you are signed in with the correct account.',
    ja: 'このアカウントではその操作を実行できません。正しいアカウントでログインしているか確認してください。',
  },
  notFound: {
    en: 'The target data could not be found. Reload the page, then select it again.',
    ja: '対象のデータが見つかりませんでした。ページを再読み込みしてから、もう一度選択してください。',
  },
  validation: {
    en: 'Some input is incomplete or inconsistent. Check the highlighted fields and try again.',
    ja: '入力内容に不足または不整合があります。入力内容を確認してからもう一度お試しください。',
  },
  credits: {
    en: 'Credits are insufficient. Add credits, then try again.',
    ja: 'クレジットが不足しています。クレジットを購入してからもう一度お試しください。',
  },
  rateLimit: {
    en: 'Requests are being sent too quickly. Wait a short while, then try again.',
    ja: '短時間に操作が集中しています。少し待ってからもう一度お試しください。',
  },
  timeout: {
    en: 'The operation is still taking time. Wait a while, then reload the page or jobs list. Avoid starting it again immediately.',
    ja: '処理に時間がかかっています。しばらく待ってからページまたはジョブ一覧を再読み込みしてください。すぐに重複実行しないでください。',
  },
  billingTimeout: {
    en: 'The billing page took too long to open. Wait a moment, then open it again.',
    ja: '決済ページの準備に時間がかかっています。少し待ってからもう一度開いてください。',
  },
  billingPlanUnavailable: {
    en: 'This plan is not available for purchase yet. Choose another plan or try again after setup is complete.',
    ja: 'このプランはまだ購入できません。別のプランを選ぶか、設定完了後にもう一度お試しください。',
  },
  unavailable: {
    en: 'This feature is temporarily unavailable. Wait a while, then try again.',
    ja: 'この機能は一時的に利用できません。少し待ってからもう一度お試しください。',
  },
  queueBusy: {
    en: 'Generation is already queued or running. Wait for the current job to finish before trying again.',
    ja: '生成処理がすでに待機中または実行中です。現在のジョブが終わってからもう一度お試しください。',
  },
  queueFull: {
    en: 'Generation requests are currently crowded. Wait a few minutes, then try again.',
    ja: '現在、生成リクエストが混み合っています。数分待ってからもう一度お試しください。',
  },
  generationFailed: {
    en: 'Generation failed before the image could be saved. Check the input, then try again.',
    ja: '画像を保存する前に生成が失敗しました。入力内容を確認してからもう一度お試しください。',
  },
  skeletonFailed: {
    en: 'The page skeleton could not be created from the story. Shorten or split the story, then try again.',
    ja: 'ストーリーからページ骨格を作成できませんでした。文章を短くするか話を分けてから、もう一度お試しください。',
  },
  storyTooLarge: {
    en: 'The story input is too large. Shorten the text or split it into smaller episodes, then try again.',
    ja: 'ストーリーの入力量が大きすぎます。文章を短くするか、話を分けてからもう一度お試しください。',
  },
  needsScene: {
    en: 'This action can run without scenes, but the current story context could not be prepared. Save the story, then try again.',
    ja: 'シーンなしでも実行できますが、現在のストーリー情報を準備できませんでした。ストーリーを保存してから再度お試しください。',
  },
  needsPages: {
    en: 'Create the page skeleton first, then run this action.',
    ja: '先にページ骨格を生成してから、この操作を実行してください。',
  },
  needsFrames: {
    en: 'Apply or save a panel layout before generating the page.',
    ja: 'ページ生成の前に、コマ割りテンプレートを適用または保存してください。',
  },
  panelFrameMismatch: {
    en: 'Panel count and frame count do not match. Apply a panel layout or adjust panels before generating.',
    ja: 'コマ数とコマ枠数が一致していません。コマ割りテンプレートを適用するか、コマを調整してから生成してください。',
  },
  speakerRequired: {
    en: 'A character is required for speech, thought, shout, and whisper lines. Use narration for lines without a speaker.',
    ja: '発話・思考・叫び・ささやきのセリフにはキャラクター指定が必要です。話者がない文章はナレーションを選んでください。',
  },
  entityMismatch: {
    en: 'A character from another work or episode is selected. Review character selections, then save again.',
    ja: '別の作品または話のキャラクターが選ばれています。キャラクター選択を確認して保存し直してください。',
  },
  duplicateEntity: {
    en: 'The same character is assigned more than once in the same panel. Remove the duplicate assignment.',
    ja: '同じコマに同じキャラクターが重複して割り当てられています。重複した割り当てを削除してください。',
  },
  referenceSelection: {
    en: 'Select the reference image you want to use, then set one selected image as the primary reference.',
    ja: '使用するレファレンス画像を選び、その中からメイン画像を1枚指定してください。',
  },
  referenceMissing: {
    en: 'The reference image could not be found. Reload the page, then import or generate the reference again.',
    ja: 'レファレンス画像が見つかりません。ページを再読み込みし、画像の取り込みまたは生成をやり直してください。',
  },
  pageNeedsImage: {
    en: 'Generate the page image before confirming or exporting it.',
    ja: '確定またはエクスポートの前に、ページ画像を生成してください。',
  },
  exportSelection: {
    en: 'Select at least one generated page to export.',
    ja: 'エクスポートする生成済みページを1枚以上選択してください。',
  },
  imageFile: {
    en: 'The image file could not be read. Choose a PNG, JPEG, or WebP image under 5 MB.',
    ja: '画像ファイルを読み込めませんでした。5MB以下のPNG、JPEG、WebP画像を選んでください。',
  },
  billingUnavailable: {
    en: 'Billing could not be opened. Wait a moment, then try again from the billing panel.',
    ja: '決済画面を開けませんでした。少し待ってから、課金パネルでもう一度お試しください。',
  },
  confirmedPage: {
    en: 'This page is confirmed. Reopen it before editing or regenerating.',
    ja: 'このページは確定済みです。編集または再生成の前に、確定を解除してください。',
  },
  alreadyDone: {
    en: 'This action has already been completed. Reload the page to see the latest state.',
    ja: 'この操作はすでに完了しています。ページを再読み込みして最新の状態を確認してください。',
  },
  layoutWouldDeletePanels: {
    en: 'This layout would remove existing panels. Delete unnecessary panels first, or choose a layout with the same panel count.',
    ja: 'このテンプレートを適用すると既存のコマが削除されます。不要なコマを先に削除するか、同じコマ数のテンプレートを選んでください。',
  },
  jsonBody: {
    en: 'The request could not be sent correctly. Reload the page, then try the operation again.',
    ja: 'リクエストを正しく送信できませんでした。ページを再読み込みしてからもう一度お試しください。',
  },
  skeletonAlreadyExists: {
    en: 'This episode already has pages. Use overwrite regeneration if you want to rebuild the page skeleton.',
    ja: 'この話にはすでにページがあります。ページ骨格を作り直す場合は、上書き再生成を使ってください。',
  },
  retryLimit: {
    en: 'This job has reached its retry limit. Review the input, then start a new generation job.',
    ja: 'このジョブは再試行上限に達しました。入力内容を見直してから、新しく生成を開始してください。',
  },
} satisfies Record<string, LocalizedMessage>;

export function formatUserFacingError(error: unknown, language: UserFacingErrorLanguage = 'en'): string {
  if (isErrorWithApiFields(error)) {
    return formatUserFacingErrorMessage(
      {
        message: error.message,
        code: error.code,
        status: error.status,
      },
      language,
    );
  }

  if (error instanceof Error) {
    return formatUserFacingErrorMessage({ message: error.message }, language);
  }

  return localize(messages.generic, language);
}

export function formatUserFacingErrorMessage(
  input: UserFacingErrorInput,
  language: UserFacingErrorLanguage = 'en',
): string {
  const rawMessage = input.message?.trim() ?? '';
  const normalizedCode = input.code?.trim().toUpperCase() ?? '';
  const normalizedMessage = normalizeErrorText(rawMessage);

  const matchedMessage = findMessageBySpecificCause(normalizedMessage, normalizedCode);
  if (matchedMessage !== null) {
    return localize(matchedMessage, language);
  }

  const statusMessage = findMessageByStatus(input.status ?? null, normalizedCode);
  if (statusMessage !== null) {
    return localize(statusMessage, language);
  }

  if (rawMessage.length > 0 && shouldKeepBackendMessage(rawMessage, normalizedMessage, language)) {
    return rawMessage;
  }

  return localize(messages.generic, language);
}

function findMessageBySpecificCause(normalizedMessage: string, normalizedCode: string): LocalizedMessage | null {
  if (normalizedCode === 'BILLING_TIMEOUT') {
    return messages.billingTimeout;
  }
  if (
    normalizedCode === 'INSUFFICIENT_CREDITS' ||
    hasAny(normalizedMessage, ['insufficient credits', 'credit balance is insufficient'])
  ) {
    return messages.credits;
  }
  if (normalizedCode === 'RATE_LIMITED' || hasAny(normalizedMessage, ['rate limit', 'too many requests'])) {
    return messages.rateLimit;
  }
  if (normalizedCode === 'STREAM_UNAVAILABLE' || normalizedCode === 'SSE_ERROR') {
    return messages.timeout;
  }
  if (
    hasAny(normalizedMessage, [
      'failed to fetch',
      'networkerror',
      'load failed',
      'fetch api is unavailable',
      'network request failed',
    ])
  ) {
    return messages.network;
  }
  if (hasAny(normalizedMessage, ['user is not confirmed', 'not confirmed'])) {
    return messages.authNotConfirmed;
  }
  if (
    hasAny(normalizedMessage, [
      'session expired',
      'token refresh failed',
      'token exchange failed',
      'access token',
      'id token',
      'session no longer matches this app',
      'cognito sign in failed',
    ])
  ) {
    return messages.authExpired;
  }
  if (
    hasAny(normalizedMessage, [
      'subscription plan is not available',
      'stripe price id is not configured',
    ])
  ) {
    return messages.billingPlanUnavailable;
  }
  if (hasAny(normalizedMessage, ['stripe checkout session url', 'stripe billing', 'redirect url is invalid', 'billing page'])) {
    return messages.billingUnavailable;
  }
  if (hasAny(normalizedMessage, ['temporarily disabled', 'not configured', 'not available'])) {
    return messages.unavailable;
  }
  if (hasAny(normalizedMessage, ['already queued or processing', 'already generating', 'page is still generating'])) {
    return messages.queueBusy;
  }
  if (hasAny(normalizedMessage, ['too many active generation jobs', 'generation queue is temporarily full'])) {
    return messages.queueFull;
  }
  if (hasAny(normalizedMessage, ['exceeded retry limit', 'retry limit'])) {
    return messages.retryLimit;
  }
  if (hasAny(normalizedMessage, ['renderer unavailable', 'generation failed', 'empty image data', 'failed to persist generated page image'])) {
    return messages.generationFailed;
  }
  if (
    hasAny(normalizedMessage, [
      'ai page skeleton generation did not complete',
      'ai page skeleton result was incomplete',
      'invalid json',
      'generated page skeleton',
      'page skeleton page count',
      'page skeleton panel count',
      'page skeleton contains duplicate',
      'page skeleton used an unknown layout template',
    ])
  ) {
    return messages.skeletonFailed;
  }
  if (hasAny(normalizedMessage, ['context is too large', 'output exceeded the maximum size'])) {
    return messages.storyTooLarge;
  }
  if (hasAny(normalizedMessage, ['at least one scene', 'scenes before', 'scene before'])) {
    return messages.needsScene;
  }
  if (hasAny(normalizedMessage, ['episode already has pages', 'page skeleton has already been generated'])) {
    return messages.skeletonAlreadyExists;
  }
  if (hasAny(normalizedMessage, ['must have pages before', 'create page skeleton'])) {
    return messages.needsPages;
  }
  if (hasAny(normalizedMessage, ['must have at least one frame', 'must have frames before', 'all pages must have frames'])) {
    return messages.needsFrames;
  }
  if (
    hasAny(normalizedMessage, [
      'frame count must match panel count',
      'panel count must match frame count',
      'matching panel and frame counts',
      'panel count did not match layout template',
      'layout template',
    ])
  ) {
    return messages.panelFrameMismatch;
  }
  if (
    hasAny(normalizedMessage, [
      'entity id is required for speaker dialogue types',
      'entity_id is required for speaker dialogue types',
      'speaker is required',
      'dialogue entity id',
      'dialogue entity_id',
    ])
  ) {
    return messages.speakerRequired;
  }
  if (
    hasAny(normalizedMessage, [
      'entities must belong',
      'entity outside',
      'outside the episode',
      'outside the work',
      'outside the panel work',
      'state id values must belong',
      'state_id values must belong',
      'referenced entities must belong',
      'assigned entities must belong',
    ])
  ) {
    return messages.entityMismatch;
  }
  if (hasAny(normalizedMessage, ['assigned once per panel', 'duplicate suggested entities', 'duplicate assignment'])) {
    return messages.duplicateEntity;
  }
  if (hasAny(normalizedMessage, ['primary s3 key', 'primary_s3_key', 'selected s3 keys', 'selected_s3_keys'])) {
    return messages.referenceSelection;
  }
  if (hasAny(normalizedMessage, ['reference image not found', 'reference set not found'])) {
    return messages.referenceMissing;
  }
  if (hasAny(normalizedMessage, ['generated image before confirmation', 'exportable generated image', 'no generated pages are available'])) {
    return messages.pageNeedsImage;
  }
  if (hasAny(normalizedMessage, ['no generated pages are selected', 'select at least one generated page'])) {
    return messages.exportSelection;
  }
  if (hasAny(normalizedMessage, ['image file could not be read', 'failed to read blob', 'file too large', 'invalid file type'])) {
    return messages.imageFile;
  }
  if (hasAny(normalizedMessage, ['confirmed pages must be reopened', 'confirmed page', 'page is confirmed'])) {
    return messages.confirmedPage;
  }
  if (hasAny(normalizedMessage, ['already confirmed', 'only confirmed pages can be reopened'])) {
    return messages.alreadyDone;
  }
  if (hasAny(normalizedMessage, ['applying this template would delete panels'])) {
    return messages.layoutWouldDeletePanels;
  }
  if (hasAny(normalizedMessage, ['request body must be valid json', 'content length must be'])) {
    return messages.jsonBody;
  }

  return null;
}

function findMessageByStatus(status: number | null, normalizedCode: string): LocalizedMessage | null {
  if (status === 401) {
    return messages.authExpired;
  }
  if (status === 402) {
    return messages.credits;
  }
  if (status === 403) {
    return messages.forbidden;
  }
  if (status === 404) {
    return messages.notFound;
  }
  if (status === 400) {
    return messages.validation;
  }
  if (status === 409) {
    return messages.queueBusy;
  }
  if (status === 413) {
    return messages.storyTooLarge;
  }
  if (status === 422 || normalizedCode === 'VALIDATION_ERROR') {
    return messages.validation;
  }
  if (status === 429) {
    return messages.rateLimit;
  }
  if (status === 408 || status === 504) {
    return messages.timeout;
  }
  if (status !== null && status >= 500) {
    return messages.generic;
  }

  return null;
}

function shouldKeepBackendMessage(
  rawMessage: string,
  normalizedMessage: string,
  language: UserFacingErrorLanguage,
): boolean {
  if (language !== 'ja') {
    return !looksLikeDeveloperMessage(normalizedMessage);
  }

  return containsJapanese(rawMessage) && !looksLikeDeveloperMessage(normalizedMessage);
}

function looksLikeDeveloperMessage(normalizedMessage: string): boolean {
  return hasAny(normalizedMessage, [
    'api',
    'arn:',
    'aws',
    'compiler',
    'configuration',
    'database',
    'db ',
    'env',
    'json',
    'openai',
    'postgres',
    'runtime',
    'schema',
    'sqs',
    'stack',
    'token',
    'undefined',
    'uuid',
  ]);
}

function isErrorWithApiFields(error: unknown): error is ErrorWithApiFields {
  return error instanceof Error && ('status' in error || 'code' in error);
}

function normalizeErrorText(value: string): string {
  return value
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function containsJapanese(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);
}

function localize(message: LocalizedMessage, language: UserFacingErrorLanguage): string {
  return message[language];
}
