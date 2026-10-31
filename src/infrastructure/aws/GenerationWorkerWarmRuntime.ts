import { ConfigurationError } from '../../domain/errors/index.js';
import { GENERATION_WORKER_RECONCILE_INTERVAL_MS } from '../../domain/generation/GenerationWorkerWarmPolicy.js';
import { db } from '../../lib/db.js';
import { env } from '../../lib/env.js';
import { PostgresGenerationWorkerWarmRepository } from '../../repositories/GenerationWorkerWarmRepository.js';
import { GenerationWorkerWarmService } from '../../services/generation/GenerationWorkerWarmService.js';
import { AwsGenerationWorkerFloor, createWorkerScalingClient } from './AwsGenerationWorkerFloor.js';

let service: GenerationWorkerWarmService | null | undefined;

export function resolveGenerationWorkerWarmService(): GenerationWorkerWarmService | null {
  if (!env.GENERATION_WORKER_WARM_ENABLED) return null;
  if (service !== undefined) return service;
  if (env.AWS_REGION === undefined || env.GENERATION_WORKER_SCALABLE_RESOURCE_ID === undefined || env.SQS_QUEUE_URL_GENERATION === undefined) {
    throw new ConfigurationError('Generation worker warm control configuration is incomplete');
  }
  service = new GenerationWorkerWarmService(
    new PostgresGenerationWorkerWarmRepository(db),
    new AwsGenerationWorkerFloor(createWorkerScalingClient(env.AWS_REGION)),
    env.GENERATION_WORKER_SCALABLE_RESOURCE_ID,
  );
  return service;
}

export function startGenerationWorkerWarmReconciler(): () => void {
  const warm = resolveGenerationWorkerWarmService();
  if (warm === null) return () => undefined;
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try { await warm.reconcile(); }
    catch { console.warn('[generation-worker-warm] reconcile unavailable; capacity is not reduced'); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, GENERATION_WORKER_RECONCILE_INTERVAL_MS);
  timer.unref();
  return () => { clearInterval(timer); };
}
