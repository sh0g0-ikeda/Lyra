import type {
  EntityRecord,
  GenerationJobRecord,
  PageRecord,
  PanelFrameRecord,
  PanelRecord,
} from '../types/api.js';

export type GenerationReadinessTarget =
  | 'story'
  | 'entities'
  | 'pages'
  | 'billing'
  | 'layout'
  | 'references';

export interface LocalizedText {
  en: string;
  ja: string;
}

export interface GenerationBlocker {
  code: string;
  severity: 'error' | 'warning';
  title: LocalizedText;
  detail: LocalizedText;
  actionLabel: LocalizedText;
  target: GenerationReadinessTarget;
}

export interface PageGenerationReadinessInput {
  page: PageRecord | null;
  panels: PanelRecord[];
  frames: PanelFrameRecord[];
  entities: EntityRecord[];
  activePageJob: GenerationJobRecord | null;
  availableCredits: number | null;
}

export interface EntityReferenceGenerationReadinessInput {
  entity: EntityRecord | null;
  activeEntityJob: GenerationJobRecord | null;
  availableCredits: number | null;
}

export interface ReferenceConfirmationReadinessInput {
  selectedCandidateTokens: string[];
  primaryCandidateToken: string;
}

export interface PageSkeletonReadinessInput {
  episodeSelected: boolean;
  activeStoryJob: GenerationJobRecord | null;
  activeSkeletonJob: GenerationJobRecord | null;
}

export interface StoryApplyReadinessInput {
  episodeSelected: boolean;
  pages: PageRecord[];
  activeStoryJob: GenerationJobRecord | null;
  activeSkeletonJob: GenerationJobRecord | null;
}

const ENTITY_GENERATION_COST = 1;
const PAGE_GENERATION_BASE_COST = 3;
const PAGE_GENERATION_INCLUDED_REFERENCES = 3;
const PAGE_GENERATION_EXTRA_REFERENCE_COST = 1;
const MAX_PAGE_REFERENCE_IMAGES = 12;

export function calculatePageGenerationCreditCost(referenceCount: number): number {
  const normalizedReferenceCount = Math.max(0, Math.floor(referenceCount));
  const extraReferenceCount = Math.max(0, normalizedReferenceCount - PAGE_GENERATION_INCLUDED_REFERENCES);
  return PAGE_GENERATION_BASE_COST + extraReferenceCount * PAGE_GENERATION_EXTRA_REFERENCE_COST;
}

export function getPageGenerationBlockers(input: PageGenerationReadinessInput): GenerationBlocker[] {
  const blockers: GenerationBlocker[] = [];
  if (input.page === null) {
    blockers.push(blocker({
      code: 'page.not_selected',
      title: text('No page selected', 'ページが選択されていません'),
      detail: text('Select a page before generating.', '生成するページを選択してください。'),
      actionLabel: text('Open pages', 'ページを開く'),
      target: 'pages',
    }));
    return blockers;
  }

  if (isActiveJob(input.activePageJob)) {
    blockers.push(blocker({
      code: 'page.job_active',
      title: text('Page generation is already running', 'ページ生成が実行中です'),
      detail: text('Wait for the current page generation job to finish.', '現在のページ生成が終わってからもう一度実行してください。'),
      actionLabel: text('Check jobs', 'ジョブを確認'),
      target: 'pages',
    }));
  }

  if (input.page.status === 'confirmed') {
    blockers.push(blocker({
      code: 'page.confirmed',
      title: text('Reopen this page before regenerating', '再生成前にページを再オープンしてください'),
      detail: text('Confirmed pages are locked so finished images are not overwritten by mistake.', '確定済みページは誤って上書きされないようロックされています。'),
      actionLabel: text('Reopen page', 'ページを再オープン'),
      target: 'pages',
    }));
  }

  if (input.frames.length === 0 || input.page.frame_count === 0) {
    blockers.push(blocker({
      code: 'page.frames_missing',
      title: text('Panel layout is missing', 'コマ割りがありません'),
      detail: text('Apply a panel layout before generating the page image.', 'ページ画像を作る前に、コマ割りを設定してください。'),
      actionLabel: text('Go to panel layout', 'コマ割りへ移動'),
      target: 'layout',
    }));
  }

  if (input.panels.length === 0 || input.page.panel_count === 0) {
    blockers.push(blocker({
      code: 'page.panels_missing',
      title: text('Panel content is missing', 'コマ内容がありません'),
      detail: text('Create panel content before generating the page image.', 'ページ画像を作る前に、コマ内容を作成してください。'),
      actionLabel: text('Open panels', 'コマを確認'),
      target: 'pages',
    }));
  }

  if (input.frames.length !== input.panels.length || input.page.frame_count !== input.page.panel_count) {
    blockers.push(blocker({
      code: 'page.frame_panel_mismatch',
      title: text('Panel layout and panel content do not match', 'コマ割りとコマ内容の数が一致していません'),
      detail: text(
        `Current count: frames ${input.frames.length} / panels ${input.panels.length}. Sync the layout before generating.`,
        `現在の数: コマ枠 ${input.frames.length} / コマ内容 ${input.panels.length}。生成前にコマ割りを揃えてください。`,
      ),
      actionLabel: text('Go to panel layout', 'コマ割りへ移動'),
      target: 'layout',
    }));
  }

  const assignedCharacterIds = collectAssignedCharacterIds(input.panels, input.entities);
  if (assignedCharacterIds.length > MAX_PAGE_REFERENCE_IMAGES) {
    blockers.push(blocker({
      code: 'page.too_many_references',
      title: text('Too many character references', 'キャラ参照画像が多すぎます'),
      detail: text(
        `A page can use up to ${MAX_PAGE_REFERENCE_IMAGES} character reference images. Reduce characters or split the scene.`,
        `1ページで使えるキャラ参照画像は最大${MAX_PAGE_REFERENCE_IMAGES}枚です。登場キャラを減らすか、場面を分けてください。`,
      ),
      actionLabel: text('Review panel characters', 'コマ内キャラを確認'),
      target: 'pages',
    }));
  }

  const missingReferenceNames = input.entities
    .filter((entity) => assignedCharacterIds.includes(entity.id) && entity.status !== 'ready')
    .map((entity) => entity.name);
  if (missingReferenceNames.length > 0) {
    blockers.push(blocker({
      code: 'page.missing_character_references',
      title: text('Some characters need confirmed images', '確定画像がないキャラがいます'),
      detail: text(
        `Confirm character reference images for: ${missingReferenceNames.join(', ')}.`,
        `次のキャラの全身プレビューを生成し、確定してください: ${missingReferenceNames.join('、')}。`,
      ),
      actionLabel: text('Open characters', 'キャラクターを開く'),
      target: 'entities',
    }));
  }

  const requiredCredits = calculatePageGenerationCreditCost(assignedCharacterIds.length);
  if (input.availableCredits !== null && input.availableCredits < requiredCredits) {
    blockers.push(blocker({
      code: 'page.insufficient_credits',
      title: text('Not enough credits', 'クレジットが足りません'),
      detail: text(
        `This page needs about ${requiredCredits} credits. Current balance is ${input.availableCredits}.`,
        `このページ生成には約${requiredCredits}クレジット必要です。現在の残高は${input.availableCredits}です。`,
      ),
      actionLabel: text('Open billing', 'クレジットを確認'),
      target: 'billing',
    }));
  }

  return blockers;
}

export function getEntityReferenceGenerationBlockers(
  input: EntityReferenceGenerationReadinessInput,
): GenerationBlocker[] {
  const blockers: GenerationBlocker[] = [];
  if (input.entity === null) {
    blockers.push(blocker({
      code: 'entity.not_selected',
      title: text('No character selected', 'キャラが選択されていません'),
      detail: text('Create or select a character before generating a preview.', 'プレビュー生成前に、キャラを作成または選択してください。'),
      actionLabel: text('Open characters', 'キャラクターを開く'),
      target: 'entities',
    }));
    return blockers;
  }

  if (isActiveJob(input.activeEntityJob)) {
    blockers.push(blocker({
      code: 'entity.job_active',
      title: text('Preview generation is already running', 'プレビュー生成が実行中です'),
      detail: text('Wait for the current preview generation job to finish.', '現在のプレビュー生成が終わってからもう一度実行してください。'),
      actionLabel: text('Check jobs', 'ジョブを確認'),
      target: 'entities',
    }));
  }

  if (input.availableCredits !== null && input.availableCredits < ENTITY_GENERATION_COST) {
    blockers.push(blocker({
      code: 'entity.insufficient_credits',
      title: text('Not enough credits', 'クレジットが足りません'),
      detail: text('Character preview generation needs 1 credit.', 'キャラのプレビュー生成には1クレジット必要です。'),
      actionLabel: text('Open billing', 'クレジットを確認'),
      target: 'billing',
    }));
  }

  return blockers;
}

export function getReferenceConfirmationBlockers(input: ReferenceConfirmationReadinessInput): GenerationBlocker[] {
  const blockers: GenerationBlocker[] = [];
  if (input.selectedCandidateTokens.length === 0) {
    blockers.push(blocker({
      code: 'reference.no_selection',
      title: text('No preview selected', '候補画像が選択されていません'),
      detail: text('Select at least one preview image before confirming.', '確定する前に、候補画像を1枚以上選択してください。'),
      actionLabel: text('Select preview', '候補を選択'),
      target: 'references',
    }));
  }

  if (input.primaryCandidateToken.trim().length === 0) {
    blockers.push(blocker({
      code: 'reference.no_primary',
      title: text('No primary image selected', 'メイン画像が選択されていません'),
      detail: text('Choose which selected image should be the main character reference.', '選択した候補のうち、メインにする画像を選んでください。'),
      actionLabel: text('Select primary image', 'メイン画像を選択'),
      target: 'references',
    }));
    return blockers;
  }

  if (!input.selectedCandidateTokens.includes(input.primaryCandidateToken)) {
    blockers.push(blocker({
      code: 'reference.primary_not_selected',
      title: text('Primary image is not selected', 'メイン画像が候補に含まれていません'),
      detail: text('The primary image must also be checked as a selected preview.', 'メイン画像は、候補画像としても選択されている必要があります。'),
      actionLabel: text('Select primary image', 'メイン画像を選択'),
      target: 'references',
    }));
  }

  return blockers;
}

export function getPageSkeletonBlockers(input: PageSkeletonReadinessInput): GenerationBlocker[] {
  const blockers: GenerationBlocker[] = [];
  if (!input.episodeSelected) {
    blockers.push(blocker({
      code: 'skeleton.episode_missing',
      title: text('No episode selected', '話が選択されていません'),
      detail: text('Select or create an episode before generating a page plan.', 'ページ骨格を作る前に、話を選択または作成してください。'),
      actionLabel: text('Open story', 'ストーリーを開く'),
      target: 'story',
    }));
  }

  if (isActiveJob(input.activeSkeletonJob) || isActiveJob(input.activeStoryJob)) {
    blockers.push(blocker({
      code: 'skeleton.job_active',
      title: text('Story generation is already running', 'ストーリー系の生成が実行中です'),
      detail: text('Wait for the current page planning or story application job to finish.', '現在のページ骨格生成または話全体反映が終わってから実行してください。'),
      actionLabel: text('Check jobs', 'ジョブを確認'),
      target: 'story',
    }));
  }

  return blockers;
}

export function getStoryApplyBlockers(input: StoryApplyReadinessInput): GenerationBlocker[] {
  const blockers: GenerationBlocker[] = [];
  if (!input.episodeSelected) {
    blockers.push(blocker({
      code: 'story.episode_missing',
      title: text('No episode selected', '話が選択されていません'),
      detail: text('Select or create an episode before applying the story to pages.', '話全体を反映する前に、話を選択または作成してください。'),
      actionLabel: text('Open story', 'ストーリーを開く'),
      target: 'story',
    }));
    return blockers;
  }

  if (isActiveJob(input.activeStoryJob) || isActiveJob(input.activeSkeletonJob)) {
    blockers.push(blocker({
      code: 'story.job_active',
      title: text('Story application is already running', '話全体の反映が実行中です'),
      detail: text('Wait for the current page planning or story application job to finish.', '現在のページ骨格生成または話全体反映が終わってから実行してください。'),
      actionLabel: text('Check jobs', 'ジョブを確認'),
      target: 'story',
    }));
  }

  if (input.pages.length === 0) {
    blockers.push(blocker({
      code: 'story.pages_missing',
      title: text('Page plan is missing', 'ページ骨格がありません'),
      detail: text('Generate the page plan first, then apply the story to panels.', '先にページ骨格を生成してから、話全体をコマへ反映してください。'),
      actionLabel: text('Generate page plan', 'ページ骨格を生成'),
      target: 'story',
    }));
  }

  const confirmedPages = input.pages.filter((page) => page.status === 'confirmed');
  if (confirmedPages.length > 0) {
    blockers.push(blocker({
      code: 'story.confirmed_pages',
      title: text('Some pages are confirmed', '確定済みページがあります'),
      detail: text(
        'Reopen confirmed pages before applying the story, so their panel data can be updated.',
        '話全体を反映する前に、確定済みページを再オープンしてください。確定中のページはコマ情報を上書きできません。',
      ),
      actionLabel: text('Open pages', 'ページを開く'),
      target: 'pages',
    }));
  }

  return blockers;
}

export function hasBlockingErrors(blockers: GenerationBlocker[]): boolean {
  return blockers.some((blockerItem) => blockerItem.severity === 'error');
}

export function pickLocalizedText(language: 'ja' | 'en', value: LocalizedText): string {
  return language === 'ja' ? value.ja : value.en;
}

function collectAssignedCharacterIds(panels: PanelRecord[], entities: EntityRecord[]): string[] {
  const characterIds = new Set(
    entities.filter((entity) => entity.entity_type === 'character').map((entity) => entity.id),
  );
  const assignedIds = new Set<string>();
  for (const panel of panels) {
    for (const assignment of panel.entities) {
      if (characterIds.has(assignment.entity_id)) {
        assignedIds.add(assignment.entity_id);
      }
    }
  }
  return Array.from(assignedIds);
}

function isActiveJob(job: GenerationJobRecord | null): boolean {
  return job?.status === 'queued' || job?.status === 'processing';
}

function text(en: string, ja: string): LocalizedText {
  return { en, ja };
}

function blocker(input: Omit<GenerationBlocker, 'severity'> & { severity?: GenerationBlocker['severity'] }): GenerationBlocker {
  return {
    ...input,
    severity: input.severity ?? 'error',
  };
}
