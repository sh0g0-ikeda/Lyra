import { ConfigurationError } from '../../domain/errors/index.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type {
  PageGenerationInputImage,
  PersistedPageGenerationJobParams,
} from '../../domain/types/pageGeneration.js';
import type { PageStatus } from '../../domain/types/page.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { PromptBuilderPort } from './PromptBuilder.js';
import type {
  CompletePageGenerationInput,
  PageGenerationExecutionRepository,
} from '../../repositories/PageGenerationExecutionRepository.js';

export interface PageGenerationPlanInput {
  jobId: string;
  userId: string;
  pageId: string;
  requestKind: PersistedPageGenerationJobParams['request_kind'];
  generationMode: PersistedPageGenerationJobParams['generation_mode'];
  prompt: string;
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
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed';
}

export interface BuildPageGenerationInputImagesInput {
  userId: string;
  pageId: string;
}

export interface PageGenerationInputImageBuilderPort {
  buildInputImages(input: BuildPageGenerationInputImagesInput): Promise<PageGenerationInputImage[]>;
}

export class PageGenerationWorkerService {
  public constructor(
    private readonly executionRepository: PageGenerationExecutionRepository,
    private readonly promptBuilder: PromptBuilderPort,
    private readonly inputImageBuilder: PageGenerationInputImageBuilderPort,
    private readonly planner: PageGenerationPlannerPort,
    private readonly renderer: PageImageRendererPort,
    private readonly storage: PageImageStoragePort,
    private readonly creditService: CreditServicePort,
  ) {}

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    const job = await this.executionRepository.claimQueuedPageGenerationJob(jobId);
    if (job === null) {
      return { status: 'skipped' };
    }

    const params = parsePersistedParams(job.params);
    const failureCompensation = extractFailureCompensation(job.params);
    if (params === null) {
      await this.failJob(job, failureCompensation, 'Page generation job params are invalid');
      return { status: 'processed', jobStatus: 'failed' };
    }

    try {
      const builtPrompt = await this.promptBuilder.buildPagePrompt({
        userId: job.userId,
        pageId: params.page_id,
        requestKind: params.request_kind,
        generationMode: params.generation_mode,
      });
      const inputImages = await this.inputImageBuilder.buildInputImages({
        userId: job.userId,
        pageId: params.page_id,
      });

      const internalPlan = params.requires_planner
        ? await this.planner.buildPlan({
            jobId: job.id,
            userId: job.userId,
            pageId: params.page_id,
            requestKind: params.request_kind,
            generationMode: params.generation_mode,
            prompt: builtPrompt.prompt,
          })
        : null;

      const renderResult = await this.renderer.render({
        jobId: job.id,
        userId: job.userId,
        pageId: params.page_id,
        requestKind: params.request_kind,
        generationMode: params.generation_mode,
        prompt: builtPrompt.prompt,
        quality: params.quality,
        internalPlan,
        inputImages,
      });

      const storedImage = await this.storage.store({
        jobId: job.id,
        userId: job.userId,
        pageId: params.page_id,
        imageData: renderResult.imageData,
        mimeType: renderResult.mimeType,
      });

      const completed = await this.executionRepository.completePageGeneration(
        buildCompletionInput(job, params, storedImage, renderResult),
      );
      if (!completed) {
        throw new ConfigurationError('Failed to persist generated page image');
      }

      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      await this.failJob(job, toFailureCompensation(params), toErrorMessage(error));
      return { status: 'processed', jobStatus: 'failed' };
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
      errorMessage,
      pageId: compensation?.pageId,
      previousStatus: compensation?.previousStatus,
      previousGenerationMode: compensation?.previousGenerationMode,
    });

    if (!failed) {
      throw new ConfigurationError('Failed to mark page generation job as failed');
    }

    await this.creditService.refundCredits({
      userId: job.userId,
      amount: job.creditCost,
      description: 'Refund for failed page generation job',
      jobId: job.id,
    });
  }
}

interface FailureCompensation {
  pageId: string;
  previousStatus: PageStatus;
  previousGenerationMode: PersistedPageGenerationJobParams['previous_generation_mode'];
}

function buildCompletionInput(
  job: GenerationJob,
  params: PersistedPageGenerationJobParams,
  storedImage: StoredPageImage,
  renderResult: RenderPageImageResult,
): CompletePageGenerationInput {
  return {
    jobId: job.id,
    userId: job.userId,
    pageId: params.page_id,
    generationMode: params.generation_mode,
    requestKind: params.request_kind,
    s3Key: storedImage.s3Key,
    cdnUrl: storedImage.cdnUrl,
    generatedAt: new Date().toISOString(),
    costUsd: renderResult.costUsd,
    openaiRequestId: renderResult.openaiRequestId,
  };
}

function parsePersistedParams(value: Record<string, unknown>): PersistedPageGenerationJobParams | null {
  const pageId = value.page_id;
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
    request_kind: requestKind,
    generation_mode: generationMode,
    quality,
    requires_planner: requiresPlanner,
    previous_page_status: previousPageStatus,
    previous_generation_mode: previousGenerationMode,
  };
}

function extractFailureCompensation(value: Record<string, unknown>): FailureCompensation | null {
  const pageId = value.page_id;
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
    previousStatus: previousPageStatus,
    previousGenerationMode,
  };
}

function toFailureCompensation(params: PersistedPageGenerationJobParams): FailureCompensation {
  return {
    pageId: params.page_id,
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
  return error instanceof Error ? error.message : 'Page generation failed';
}
