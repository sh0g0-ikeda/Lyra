import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { GenerationJobType } from '../../domain/types/job.js';
import { toSanitizedAwsErrorMessage } from './AwsErrorMessage.js';
import type { GenerationWorkerWarmPort } from '../../services/generation/GenerationWorkerWarmService.js';

export interface EnqueueGenerationJobInput {
  jobId: string;
  jobType: GenerationJobType;
}

export interface GenerationQueueClient {
  send(command: SendMessageCommand,options?:{abortSignal?:AbortSignal}): Promise<{
    MessageId?: string;
  }>;
}

export interface EnqueueGenerationJobOptions {deferWake?:boolean}
const GENERATION_QUEUE_SEND_TIMEOUT_MS=15_000;

export class SqsGenerationQueue {
  public constructor(
    private readonly client: GenerationQueueClient,
    private readonly queueUrl: string,
    private readonly warm: GenerationWorkerWarmPort | null = null,
    private readonly sendTimeoutMs: number = GENERATION_QUEUE_SEND_TIMEOUT_MS,
  ) {}

  public async enqueueJob(input: EnqueueGenerationJobInput,options:EnqueueGenerationJobOptions={}): Promise<{ messageId: string | null }> {
    try {
      const response = await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({
            job_id: input.jobId,
            job_type: input.jobType,
          }),
        }),{abortSignal:AbortSignal.timeout(this.sendTimeoutMs)},
      );

      // Durable acceptance must survive a failed capacity-control request.
      if(options.deferWake!==true)await this.wakeWorker();
      return {
        messageId: response.MessageId ?? null,
      };
    } catch (error) {
      throw new ConfigurationError(
        toSanitizedAwsErrorMessage(error, 'Failed to enqueue generation job'),
      );
    }
  }

  public async wakeWorker():Promise<void>{
    if(this.warm===null)return;
    try{await this.warm.requestWarm();}
    catch{console.warn('[generation-worker-warm] enqueue wake unavailable; durable queue fallback remains active');}
  }
}

export function createGenerationQueueClient(region?: string): SQSClient {
  return new SQSClient(region === undefined ? {} : { region });
}
