import { ApiError } from '@/lib/api';
import { MobileFileTransferError } from '@/lib/fileTransferError';
import { t } from '@/lib/i18n';

type UiLanguage = 'ja' | 'en';

const includesAny = (value: string, needles: string[]): boolean => needles.some((needle) => value.includes(needle));

export const userErrorMessage = (error: unknown, language: UiLanguage): string => {
  if (error instanceof MobileFileTransferError) {
    if (error.code === 'DOWNLOAD_INTERRUPTED') {
      return t(language, "generated.lib.userMessages.the.download.was.interrupted.check.your.b88e90a0");
    }
    if (error.code === 'STORAGE_FULL') {
      return t(language, "generated.lib.userMessages.the.device.does.not.have.enough.free.sto.b8b322dd");
    }
    return t(language, "generated.lib.userMessages.sharing.is.unavailable.on.this.device.ch.53712059");
  }

  if (error instanceof ApiError) {
    const normalizedMessage = error.message.trim().toLowerCase();
    const normalizedCode = error.code?.trim().toLowerCase() ?? '';
    if (normalizedCode === 'network_offline') {
      return t(language, 'shared.error.offline');
    }
    if (normalizedCode === 'request_timeout') {
      return t(language, 'shared.error.timeout');
    }
    if (error.code === 'INSUFFICIENT_CREDITS') {
      return t(language, 'shared.error.insufficientCredits');
    }
    if (error.code === 'RESOURCE_STALE') {
      return t(language, "generated.lib.userMessages.another.edit.changed.this.resource.your.41a03cd9");
    }
    if (
      normalizedMessage.includes('permission for this organization action') ||
      normalizedMessage.includes('organization workspace is unavailable') ||
      normalizedMessage.includes('organization service is not configured') ||
      normalizedMessage.includes('organization support is not configured') ||
      normalizedCode.includes('organization_permission') ||
      normalizedCode.includes('workspace_permission')
    ) {
      return t(language, 'shared.error.workspacePermission');
    }
    if (includesAny(normalizedMessage, ['already queued', 'already running', 'active generation job'])) {
      return t(language, 'shared.error.activeJob');
    }
    if (includesAny(normalizedMessage, ['generation capacity', 'queue is full', 'queue capacity'])) {
      return t(language, "generated.lib.userMessages.generation.requests.are.crowded.wait.a.f.39873c07");
    }
    if (includesAny(normalizedMessage, ['frame count and panel count', 'panel count and frame count'])) {
      return t(language, 'shared.error.frameMismatch');
    }
    if (includesAny(normalizedMessage, ['would delete existing panels', 'allow_panel_truncation'])) {
      return t(language, "generated.lib.userMessages.this.layout.would.remove.existing.panels.56881d1e");
    }
    if (includesAny(normalizedMessage, ['speaker is required', 'entity_id is required for speaker'])) {
      return t(language, "generated.lib.userMessages.speech.thought.shout.and.whisper.lines.r.45dec02d");
    }
    if (includesAny(normalizedMessage, ['reference image could not be found', 'reference not found'])) {
      return t(language, 'shared.error.missingReference');
    }
    if (includesAny(normalizedMessage, ['page is confirmed', 'confirmed page'])) {
      return t(language, "generated.lib.userMessages.this.page.is.confirmed.reopen.it.before.48113df4");
    }
    if (includesAny(normalizedMessage, ['already has pages', 'page skeleton already exists'])) {
      return t(language, "generated.lib.userMessages.this.episode.already.has.pages.review.th.61e8ced1");
    }
    if (error.status === 401) {
      return t(language, 'shared.error.sessionExpired');
    }
    if (error.status === 403) {
      return t(language, 'shared.error.workspacePermission');
    }
    if (error.status === 404) {
      return t(language, "generated.lib.userMessages.the.target.data.was.not.found.refresh.an.ae54ed76");
    }
    if (error.status === 409) {
      return t(language, "generated.lib.userMessages.the.operation.conflicts.with.the.current.198f037a");
    }
    if (error.status === 413 || error.status === 415) {
      return t(language, "generated.lib.userMessages.choose.a.jpeg.png.or.webp.image.under.5.81d6cb43");
    }
    if (error.status === 422 || error.status === 400) {
      return t(language, "generated.lib.userMessages.some.input.is.incomplete.or.inconsistent.40e2b25c");
    }
    if (error.status === 429) {
      return t(language, "generated.lib.userMessages.the.action.failed.try.again.d935b0f9");
    }
    if (error.status >= 500) {
      return t(language, 'shared.error.server');
    }
    return t(language, "generated.lib.userMessages.the.action.failed.check.your.input.e4dfa160");
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return t(language, 'shared.error.timeout');
    }
    if (error.message.includes('Cognito')) {
      return t(language, "generated.lib.userMessages.sign.in.failed.close.the.browser.and.try.60dfd275");
    }
    if (error.message.includes('cancelled')) {
      return t(language, "generated.lib.userMessages.sign.in.was.cancelled.988a4878");
    }
    const normalizedMessage = error.message.trim().toLowerCase();
    if (
      normalizedMessage.includes('network request failed') ||
      normalizedMessage.includes('failed to fetch') ||
      normalizedMessage.includes('networkerror')
    ) {
      return t(language, "generated.lib.userMessages.you.may.be.offline.check.your.connection.a3d7a44e");
    }
    return t(language, "generated.lib.userMessages.the.action.failed.check.your.connection.bf79c2dd");
  }

  return t(language, "generated.lib.userMessages.the.action.failed.try.again.d935b0f9");
};
