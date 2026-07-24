import { ConfigurationError } from '../../domain/errors/index.js';
import { PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS } from '../../domain/constants/generation.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type {
  PageGenerationInputImage,
  PageGenerationInputSnapshot,
  PersistedPageGenerationJobParams,
} from '../../domain/types/pageGeneration.js';
import type { PageStatus } from '../../domain/types/page.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import type {
  CompiledPagePrompt,
  PagePromptCompilerPort,
} from './PagePromptCompiler.js';
import type { PromptBuilderPort } from './PromptBuilder.js';
import type {
  CompletePageGenerationInput,
  PageGenerationExecutionRepository,
  SavePageGenerationInputSnapshotInput,
  TouchPageGenerationProgressInput,
} from '../../repositories/PageGenerationExecutionRepository.js';
import type { GenerationJobCancellationCheckpointPort } from '../../repositories/GenerationJobRepository.js';

export interface PageGenerationPlanInput {
  jobId: string;
  userId: string;
  organizationId?: string | null;
  pageId: string;
  requestKind: PersistedPageGenerationJobParams['request_kind'];
  generationMode: PersistedPageGenerationJobParams['generation_mode'];
  prompt: string;
}

export interface PagePromptCompilationMetadata {
  draftPrompt: string;
  compilerBrief: string;
  compiledPrompt: string;
  compiledPromptUsed: boolean;
  promptCompilerProvider: CompiledPagePrompt['compilerProvider'];
  compilerModel: string | null;
  compilerPromptVersion: string | null;
  compilerError: string | null;
}

export interface PageGenerationStageTimingsMs {
  prompt_build: number;
  prompt_compile: number;
  reference_images: number;
  planning: number;
  rendering: number;
  storage: number;
  total_before_persist: number;
}

interface CompiledPagePromptResult {
  compiledPrompt: CompiledPagePrompt;
  compilerError: string | null;
}

export interface PageGenerationPlannerPort {
  buildPlan(input: PageGenerationPlanInput): Promise<string>;
}

export interface RenderPageImageInput extends PageGenerationPlanInput {
  quality: PersistedPageGenerationJobParams['quality'];
  internalPlan: string | null;
  inputImages: PageGenerationInputImage[];
}

export interface RenderPageImageResult {
  imageData: Buffer;
  mimeType: string;
  openaiRequestId: string | null;
  costUsd: number | null;
}

export interface PageImageRendererPort {
  render(input: RenderPageImageInput): Promise<RenderPageImageResult>;
}

export interface StorePageImageInput {
  jobId: string;
  userId: string;
  organizationId?: string | null;
  pageId: string;
  imageData: Buffer;
  mimeType: string;
}

export interface StoredPageImage {
  s3Key: string;
  cdnUrl: string;
}

export interface PageImageStoragePort {
  store(input: StorePageImageInput): Promise<StoredPageImage>;
}

export interface ProcessPageGenerationJobResult {
  status: 'processed' | 'skipped' | 'retry';
  jobStatus?: 'completed' | 'failed' | 'canceled';
  reason?: string;
}

export interface BuildPageGenerationInputImagesInput {
  userId: string;
  organizationId?: string | null;
  pageId: string;
}

export interface PageGenerationInputImageBuilderPort {
  buildInputImages(input: BuildPageGenerationInputImagesInput): Promise<PageGenerationInputImage[]>;
}

export class PageGenerationWorkerService {
  public constructor(
    private readonly executionRepository: PageGenerationExecutionRepository,
    private readonly promptBuilder: PromptBuilderPort,
    private readonly promptCompiler: PagePromptCompilerPort,
    private readonly inputImageBuilder: PageGenerationInputImageBuilderPort,
    private readonly planner: PageGenerationPlannerPort,
    private readonly renderer: PageImageRendererPort,
    private readonly storage: PageImageStoragePort,
    private readonly creditService: CreditServicePort,
    private readonly generationEnabled = true,
    private readonly organizationService?: OrganizationServicePort,
    private readonly cancellationCheckpoint?: GenerationJobCancellationCheckpointPort,
  ) {}

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    if (!this.generationEnabled) {
      throw new ConfigurationError('Page generation worker is temporarily disabled');
    }

    const job = await this.executionRepository.claimQueuedPageGenerationJob(jobId);
    if (job === null) {
      return this.resolveUnclaimedJobResult(jobId);
    }
    if (await this.finalizeCancellationIfRequested(job)) {
      return { status: 'processed', jobStatus: 'canceled' };
    }

    const params = parsePersistedParams(job.params);
    const failureCompensation = extractFailureCompensation(job.params);
    if (params === null) {
      await this.failJob(job, failureCompensation, 'Page generation job params are invalid');
      return { status: 'processed', jobStatus: 'failed' };
    }

    try {
      const startedAtMs = Date.now();
      const stageTimingsMs = createEmptyPageGenerationStageTimings();
      await this.touchJobProgress(job, 'Building page prompt.');
      const builtPrompt = await measurePageGenerationStage(stageTimingsMs, 'prompt_build', () =>
        this.promptBuilder.buildPagePrompt({
          userId: job.userId,
          organizationId: job.organizationId ?? null,
          pageId: params.page_id,
          requestKind: params.request_kind,
          generationMode: params.generation_mode,
        }),
      );
      await this.saveInputSnapshot(job, builtPrompt.inputSnapshot);
      await this.touchJobProgress(job, 'Compiling page prompt.');
      const compiledPromptResult = await measurePageGenerationStage(stageTimingsMs, 'prompt_compile', () =>
        compilePromptSafely(this.promptCompiler, builtPrompt),
      );
      const compiledPrompt = compiledPromptResult.compiledPrompt;
      await this.touchJobProgress(job, 'Preparing reference images.');
      const inputImages = await measurePageGenerationStage(stageTimingsMs, 'reference_images', () =>
        this.inputImageBuilder.buildInputImages({
          userId: job.userId,
          organizationId: job.organizationId ?? null,
          pageId: params.page_id,
        }),
      );
      await this.saveInputSnapshot(job, appendInputImageSnapshot(builtPrompt.inputSnapshot, inputImages));

      const internalPlan = params.requires_planner
        ? normalizeOptionalInternalPlan(
            await measurePageGenerationStage(stageTimingsMs, 'planning', () =>
              this.withProgressHeartbeat(job, 'Planning page image generation.', () =>
              this.planner.buildPlan({
                jobId: job.id,
                userId: job.userId,
                organizationId: job.organizationId ?? null,
                pageId: params.page_id,
                requestKind: params.request_kind,
                generationMode: params.generation_mode,
                prompt: compiledPrompt.prompt,
              }),
              ),
            ),
          )
        : null;

      if (await this.finalizeCancellationIfRequested(job)) {
        return { status: 'processed', jobStatus: 'canceled' };
      }

      const renderResult = await measurePageGenerationStage(stageTimingsMs, 'rendering', () =>
        this.withProgressHeartbeat(job, 'Requesting page image from image model.', () =>
          this.renderer.render({
            jobId: job.id,
            userId: job.userId,
            organizationId: job.organizationId ?? null,
            pageId: params.page_id,
            requestKind: params.request_kind,
            generationMode: params.generation_mode,
            prompt: compiledPrompt.prompt,
            quality: params.quality,
            internalPlan,
            inputImages,
          }),
        ),
      );
      assertRenderedPageImage(renderResult);

      if (await this.finalizeCancellationIfRequested(job)) {
        return { status: 'processed', jobStatus: 'canceled' };
      }

      const storedImage = await measurePageGenerationStage(stageTimingsMs, 'storage', () =>
        this.withProgressHeartbeat(job, 'Storing generated page image.', () =>
          this.storage.store({
            jobId: job.id,
            userId: job.userId,
            organizationId: job.organizationId ?? null,
            pageId: params.page_id,
            imageData: renderResult.imageData,
            mimeType: renderResult.mimeType,
          }),
        ),
      );
      stageTimingsMs.total_before_persist = Date.now() - startedAtMs;

      if (await this.finalizeCancellationIfRequested(job)) {
        return { status: 'processed', jobStatus: 'canceled' };
      }
      await this.touchJobProgress(job, 'Saving generated page result.');
      const completed = await this.executionRepository.completePageGeneration(
        buildCompletionInput(job, params, storedImage, renderResult, {
          draftPrompt: builtPrompt.draftPrompt,
          compilerBrief: builtPrompt.compilerBrief,
          compiledPrompt: compiledPrompt.prompt,
          compiledPromptUsed: compiledPrompt.compilerProvider !== 'none',
          promptCompilerProvider: compiledPrompt.compilerProvider,
          compilerModel: compiledPrompt.compilerModel,
          compilerPromptVersion: compiledPrompt.compilerPromptVersion,
          compilerError: compiledPromptResult.compilerError,
        },
        stageTimingsMs),
      );
      if (!completed) {
        if (await this.finalizeCancellationIfRequested(job)) {
          return { status: 'processed', jobStatus: 'canceled' };
        }
        throw new ConfigurationError('Failed to persist generated page image');
      }

      await this.recordGenerationCompleted(job, params, builtPrompt.workId, renderResult, stageTimingsMs);
      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      await this.failJob(job, toFailureCompensation(params), toErrorMessage(error));
      return { status: 'processed', jobStatus: 'failed' };
    }
  }

  private async resolveUnclaimedJobResult(jobId: string): Promise<ProcessPageGenerationJobResult> {
    const existingJob = await this.executionRepository.findPageGenerationJob(jobId);
    if (existingJob === null) {
      return { status: 'skipped', reason: 'Page generation job no longer exists' };
    }

    if (existingJob.status === 'processing') {
      return { status: 'retry', reason: 'Page generation job is already processing' };
    }

    if (existingJob.status === 'queued') {
      return { status: 'retry', reason: 'Page generation job was not claimed yet' };
    }

    return { status: 'skipped', reason: `Page generation job is already ${existingJob.status}` };
  }

  private async touchJobProgress(job: GenerationJob, message: string): Promise<void> {
    const input: TouchPageGenerationProgressInput = {
      jobId: job.id,
      userId: job.userId,
      message,
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.executionRepository.touchPageGenerationProgress(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[page-generation-worker] failed to update progress for job ${job.id}: ${reason}`);
    }
  }

  private async saveInputSnapshot(
    job: GenerationJob,
    snapshot: SavePageGenerationInputSnapshotInput['snapshot'],
  ): Promise<void> {
    const input: SavePageGenerationInputSnapshotInput = {
      jobId: job.id,
      userId: job.userId,
      snapshot,
      savedAt: new Date().toISOString(),
    };

    try {
      await this.executionRepository.savePageGenerationInputSnapshot(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[page-generation-worker] failed to save input snapshot for job ${job.id}: ${reason}`);
    }
  }

  private async withProgressHeartbeat<T>(
    job: GenerationJob,
    message: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.touchJobProgress(job, message);
    const timer = setInterval(() => {
      void this.touchJobProgress(job, message);
    }, PAGE_GENERATION_HEARTBEAT_INTERVAL_MS);
    unrefTimer(timer);

    try {
      return await operation();
    } finally {
      clearInterval(timer);
    }
  }

  private async failJob(
    job: GenerationJob,
    compensation: FailureCompensation | null,
    errorMessage: string,
  ): Promise<void> {
    const failed = await this.executionRepository.failPageGeneration({
      jobId: job.id,
      userId: job.userId,
      organizationId: job.organizationId ?? null,
      errorMessage,
      pageId: compensation?.pageId,
      previousStatus: compensation?.previousStatus,
      previousGenerationMode: compensation?.previousGenerationMode,
    });
    if (!failed) {
      return;
    }

    if (job.creditCost > 0) {
      try {
        await this.refundFailedJobCredits(job);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(
          `[page-generation-worker] failed to refund failed job ${job.id}; recovery will retry missing refund ledger: ${reason}`,
        );
      }
    }

    await this.recordGenerationFailed(job, compensation, errorMessage);
  }

  private async finalizeCancellationIfRequested(job: GenerationJob): Promise<boolean> {
    return this.cancellationCheckpoint?.finalizeCancellationIfRequested(job.id) ?? false;
  }

  private async recordGenerationCompleted(
    job: GenerationJob,
    params: PersistedPageGenerationJobParams,
    workId: string,
    renderResult: RenderPageImageResult,
    stageTimingsMs: PageGenerationStageTimingsMs,
  ): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null || this.organizationService === undefined) {
      return;
    }

    try {
      await this.organizationService.recordGenerationCompleted({
        organizationId,
        userId: job.userId,
        workId,
        jobId: job.id,
        generationType: 'page_generate',
        metadata: {
          page_id: params.page_id,
          request_kind: params.request_kind,
          generation_mode: params.generation_mode,
          quality: params.quality,
          cost_usd: renderResult.costUsd,
          openai_request_id: renderResult.openaiRequestId,
          stage_timings_ms: stageTimingsMs,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[page-generation-worker] failed to record enterprise generation completion ${job.id}: ${reason}`);
    }
  }

  private async recordGenerationFailed(
    job: GenerationJob,
    compensation: FailureCompensation | null,
    errorMessage: string,
  ): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null || this.organizationService === undefined) {
      return;
    }

    try {
      await this.organizationService.recordGenerationFailed({
        organizationId,
        userId: job.userId,
        workId: compensation?.workId ?? null,
        jobId: job.id,
        generationType: 'page_generate',
        errorMessage,
        metadata: {
          page_id: compensation?.pageId ?? null,
          work_id: compensation?.workId ?? null,
          previous_status: compensation?.previousStatus ?? null,
          previous_generation_mode: compensation?.previousGenerationMode ?? null,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[page-generation-worker] failed to record enterprise generation failure ${job.id}: ${reason}`);
    }
  }

  private async refundFailedJobCredits(job: GenerationJob): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null) {
      await this.creditService.refundCredits({
        userId: job.userId,
        amount: job.creditCost,
        description: 'Refund for failed page generation job',
        jobId: job.id,
      });
      return;
    }

    if (this.organizationService === undefined) {
      throw new ConfigurationError('Organization service is required to refund enterprise page generation jobs');
    }

    await this.organizationService.refundCredits({
      organizationId,
      actorUserId: job.userId,
      amount: job.creditCost,
      description: 'Refund for failed page generation job',
      jobId: job.id,
    });
  }
}

const PAGE_GENERATION_HEARTBEAT_INTERVAL_MS = 60_000;

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    const unref = timer.unref;
    if (typeof unref === 'function') {
      unref.call(timer);
    }
  }
}

function createEmptyPageGenerationStageTimings(): PageGenerationStageTimingsMs {
  return {
    prompt_build: 0,
    prompt_compile: 0,
    reference_images: 0,
    planning: 0,
    rendering: 0,
    storage: 0,
    total_before_persist: 0,
  };
}

async function measurePageGenerationStage<T>(
  timings: PageGenerationStageTimingsMs,
  stage: keyof Omit<PageGenerationStageTimingsMs, 'total_before_persist'>,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAtMs = Date.now();
  try {
    return await operation();
  } finally {
    timings[stage] = Date.now() - startedAtMs;
  }
}

function assertRenderedPageImage(renderResult: RenderPageImageResult): void {
  if (renderResult.imageData.length === 0) {
    throw new ConfigurationError('Page image renderer returned empty image data');
  }
}

interface FailureCompensation {
  pageId: string;
  workId: string | null;
  previousStatus: PageStatus;
  previousGenerationMode: PersistedPageGenerationJobParams['previous_generation_mode'];
}

function buildCompletionInput(
  job: GenerationJob,
  params: PersistedPageGenerationJobParams,
  storedImage: StoredPageImage,
  renderResult: RenderPageImageResult,
  promptMetadata: PagePromptCompilationMetadata,
  stageTimingsMs: PageGenerationStageTimingsMs,
): CompletePageGenerationInput {
  return {
    jobId: job.id,
    userId: job.userId,
    organizationId: job.organizationId ?? null,
    pageId: params.page_id,
    generationMode: params.generation_mode,
    requestKind: params.request_kind,
    s3Key: storedImage.s3Key,
    cdnUrl: storedImage.cdnUrl,
    generatedAt: new Date().toISOString(),
    costUsd: renderResult.costUsd,
    openaiRequestId: renderResult.openaiRequestId,
    promptMetadata,
    stageTimingsMs,
  };
}

function appendInputImageSnapshot(
  snapshot: PageGenerationInputSnapshot,
  inputImages: PageGenerationInputImage[],
): PageGenerationInputSnapshot {
  return {
    ...snapshot,
    inputImages: inputImages.map((image) => ({
      role: image.role,
      label: image.label,
    })),
  };
}

async function compilePromptSafely(
  compiler: PagePromptCompilerPort,
  builtPrompt: Awaited<ReturnType<PromptBuilderPort['buildPagePrompt']>>,
): Promise<CompiledPagePromptResult> {
  if (shouldUseDraftPromptDirectly(builtPrompt.compilerBrief)) {
    return {
      compiledPrompt: {
        prompt: builtPrompt.draftPrompt,
        compilerProvider: 'none',
        compilerModel: null,
        compilerPromptVersion: null,
      },
      compilerError: 'Page prompt compiler skipped because deterministic panel locks are present',
    };
  }

  try {
    const compiledPrompt = await compiler.compilePrompt({
      draftPrompt: builtPrompt.draftPrompt,
      compilerBrief: builtPrompt.compilerBrief,
    });
    const missingDialogueLocks = findMissingDialogueLocks(builtPrompt.compilerBrief, compiledPrompt.prompt);
    const missingVisualLocks = findMissingVisualLocks(builtPrompt.compilerBrief, compiledPrompt.prompt);
    if (missingDialogueLocks.length > 0 || missingVisualLocks.length > 0) {
      const issues = [
        missingDialogueLocks.length === 0
          ? null
          : `compiled prompt dropped required dialogue lines: ${missingDialogueLocks.join(' / ')}`,
        missingVisualLocks.length === 0
          ? null
          : `compiled prompt dropped required visual locks: ${missingVisualLocks.join(' / ')}`,
      ].filter((value): value is string => value !== null);
      return {
        compiledPrompt: {
          prompt: builtPrompt.draftPrompt,
          compilerProvider: 'none',
          compilerModel: null,
          compilerPromptVersion: null,
        },
        compilerError: issues.join(' | '),
      };
    }

    return {
      compiledPrompt,
      compilerError: null,
    };
  } catch (error) {
    if (!(error instanceof ConfigurationError)) {
      throw error;
    }

    return {
      compiledPrompt: {
        prompt: builtPrompt.draftPrompt,
        compilerProvider: 'none',
        compilerModel: null,
        compilerPromptVersion: null,
      },
      compilerError: sanitizePersistedErrorMessage(error, 'Page prompt compiler failed'),
    };
  }
}

function shouldUseDraftPromptDirectly(compilerBrief: string): boolean {
  return extractRequiredDialogueLocks(compilerBrief).length > 0 || extractRequiredVisualLocks(compilerBrief).length > 0;
}

function findMissingDialogueLocks(compilerBrief: string, compiledPrompt: string): string[] {
  const locks = extractRequiredDialogueLocks(compilerBrief);
  if (locks.length === 0) {
    return [];
  }

  return locks.flatMap((lock) => {
    const missingText = !compiledPrompt.includes(lock.text);
    const missingSpeaker = lock.speaker !== null && !compiledPrompt.includes(lock.speaker);
    if (!missingText && !missingSpeaker) {
      return [];
    }

    return [lock.speaker === null ? lock.text : `${lock.speaker}:${lock.text}`];
  });
}

interface RequiredDialogueLock {
  speaker: string | null;
  text: string;
}

function extractRequiredDialogueLocks(compilerBrief: string): RequiredDialogueLock[] {
  const locks: RequiredDialogueLock[] = [];
  const lines = compilerBrief.split('\n');

  for (const line of lines) {
    if (!line.includes('Dialogue lock:')) {
      continue;
    }

    const speakerMatches = Array.from(
      line.matchAll(/must stay assigned to (.+?) exactly as written: "(.+?)"/gu),
    );
    for (const match of speakerMatches) {
      locks.push({
        speaker: match[1] ?? null,
        text: match[2] ?? '',
      });
    }

    const narrationMatches = Array.from(
      line.matchAll(/must remain narration, not character speech: "(.+?)"/gu),
    );
    for (const match of narrationMatches) {
      locks.push({
        speaker: null,
        text: match[1] ?? '',
      });
    }
  }

  return locks.filter((lock) => lock.text.length > 0);
}

interface RequiredVisualLock {
  panelOrder: number;
  subjects: string[];
  situationCue: string | null;
  shot: string | null;
  angle: string | null;
  backgroundCue: string | null;
}

function findMissingVisualLocks(compilerBrief: string, compiledPrompt: string): string[] {
  const locks = extractRequiredVisualLocks(compilerBrief);
  if (locks.length === 0) {
    return [];
  }

  const normalizedPrompt = compiledPrompt.toLowerCase();
  return locks.flatMap((lock) => {
    const missingSubjects = lock.subjects.filter((subject) => !normalizedPrompt.includes(subject.toLowerCase()));
    const missingShot =
      lock.shot !== null && !normalizedPrompt.includes(humanizeToken(lock.shot).toLowerCase()) ? lock.shot : null;
    const missingAngle =
      lock.angle !== null && !normalizedPrompt.includes(humanizeToken(lock.angle).toLowerCase()) ? lock.angle : null;
    const missingSituation =
      lock.situationCue !== null && !normalizedPrompt.includes(lock.situationCue.toLowerCase())
        ? lock.situationCue
        : null;
    const missingBackground =
      lock.backgroundCue !== null && !normalizedPrompt.includes(lock.backgroundCue.toLowerCase())
        ? lock.backgroundCue
        : null;

    if (
      missingSubjects.length === 0 &&
      missingShot === null &&
      missingAngle === null &&
      missingSituation === null &&
      missingBackground === null
    ) {
      return [];
    }

    const fragments = [
      missingSubjects.length === 0 ? null : `subjects=${missingSubjects.join('|')}`,
      missingShot === null ? null : `shot=${humanizeToken(missingShot)}`,
      missingAngle === null ? null : `angle=${humanizeToken(missingAngle)}`,
      missingSituation === null ? null : `situation=${missingSituation}`,
      missingBackground === null ? null : `background=${missingBackground}`,
    ].filter((value): value is string => value !== null);

    return [`panel ${lock.panelOrder} (${fragments.join(', ')})`];
  });
}

function extractRequiredVisualLocks(compilerBrief: string): RequiredVisualLock[] {
  const locks: RequiredVisualLock[] = [];
  const lines = compilerBrief.split('\n');

  for (const line of lines) {
    if (!line.includes('Visual lock:')) {
      continue;
    }

    const match = line.match(
      /Visual lock for panel (\d+): subjects=(.*?);(?: situation cue="(.*?)";)? shot=(.*?); angle=(.*?); background cue="(.*?)"\./u,
    );
    if (match === null) {
      continue;
    }

    const panelOrder = Number(match[1]);
    const subjects =
      match[2] === '(none)'
        ? []
        : match[2]
            .split('|')
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
    const situationCue = match[3] === undefined || match[3] === '(none)' ? null : match[3];
    const shot = match[4] === 'unspecified' ? null : match[4];
    const angle = match[5] === 'unspecified' ? null : match[5];
    const backgroundCue = match[6] === '(none)' ? null : match[6];

    locks.push({
      panelOrder,
      subjects,
      situationCue,
      shot,
      angle,
      backgroundCue,
    });
  }

  return locks;
}

function humanizeToken(value: string): string {
  return value.replace(/_/gu, ' ');
}

function parsePersistedParams(value: Record<string, unknown>): PersistedPageGenerationJobParams | null {
  const pageId = value.page_id;
  const workId = value.work_id;
  const requestKind = value.request_kind;
  const generationMode = value.generation_mode;
  const quality = value.quality;
  const requiresPlanner = value.requires_planner;
  const previousPageStatus = value.previous_page_status;
  const previousGenerationMode = value.previous_generation_mode;

  if (
    typeof pageId !== 'string' ||
    (requestKind !== 'initial' && requestKind !== 'regenerate') ||
    (generationMode !== 'standard' && generationMode !== 'thinking') ||
    (quality !== 'medium' && quality !== 'high') ||
    typeof requiresPlanner !== 'boolean' ||
    !isPageStatus(previousPageStatus) ||
    !(previousGenerationMode === null || previousGenerationMode === 'standard' || previousGenerationMode === 'thinking')
  ) {
    return null;
  }

  return {
    page_id: pageId,
    work_id: typeof workId === 'string' && workId.length > 0 ? workId : null,
    request_kind: requestKind,
    generation_mode: generationMode,
    quality,
    requires_planner: requiresPlanner,
    previous_page_status: previousPageStatus,
    previous_generation_mode: previousGenerationMode,
  };
}

function normalizeOptionalInternalPlan(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length <= PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS - 3).trimEnd()}...`;
}

function extractFailureCompensation(value: Record<string, unknown>): FailureCompensation | null {
  const pageId = value.page_id;
  const workId = value.work_id;
  const previousPageStatus = value.previous_page_status;
  const previousGenerationMode = value.previous_generation_mode;

  if (
    typeof pageId !== 'string' ||
    !isPageStatus(previousPageStatus) ||
    !(previousGenerationMode === null || previousGenerationMode === 'standard' || previousGenerationMode === 'thinking')
  ) {
    return null;
  }

  return {
    pageId,
    workId: typeof workId === 'string' && workId.length > 0 ? workId : null,
    previousStatus: previousPageStatus,
    previousGenerationMode,
  };
}

function toFailureCompensation(params: PersistedPageGenerationJobParams): FailureCompensation {
  return {
    pageId: params.page_id,
    workId: typeof params.work_id === 'string' && params.work_id.length > 0 ? params.work_id : null,
    previousStatus: params.previous_page_status,
    previousGenerationMode: params.previous_generation_mode,
  };
}

function isPageStatus(value: unknown): value is PageStatus {
  return (
    value === 'designing' ||
    value === 'generating' ||
    value === 'generated' ||
    value === 'editing' ||
    value === 'confirmed'
  );
}

function toErrorMessage(error: unknown): string {
  return sanitizePersistedErrorMessage(error, 'Page generation failed');
}
