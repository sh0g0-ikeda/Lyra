import { ApplicationAutoScalingClient, DescribeScalableTargetsCommand, RegisterScalableTargetCommand, type ScalableTarget } from '@aws-sdk/client-application-auto-scaling';
import { ConfigurationError } from '../../domain/errors/index.js';
import { GENERATION_WORKER_AWS_TIMEOUT_MS } from '../../domain/generation/GenerationWorkerWarmPolicy.js';
import type { GenerationWorkerFloorPort } from '../../services/generation/GenerationWorkerWarmService.js';

export interface WorkerScalingClient {
  send(command: DescribeScalableTargetsCommand | RegisterScalableTargetCommand, options?: { abortSignal: AbortSignal }): Promise<{ ScalableTargets?: Array<Pick<ScalableTarget, 'ResourceId' | 'MinCapacity' | 'MaxCapacity' | 'SuspendedState'>> }>;
}

export function createWorkerScalingClient(region: string): WorkerScalingClient {
  const client = new ApplicationAutoScalingClient({ region, maxAttempts: 1 });
  return {
    send: async (command, options) => {
      if (command instanceof DescribeScalableTargetsCommand) return client.send(command, options);
      await client.send(command, options);
      return {};
    },
  };
}

export class AwsGenerationWorkerFloor implements GenerationWorkerFloorPort {
  public constructor(private readonly client: WorkerScalingClient) {}

  public async applyFloor(resourceId: string, floor: 0 | 1, previousFloor: 0 | 1 | null): Promise<void> {
    const identity = { ServiceNamespace: 'ecs' as const, ResourceId: resourceId, ScalableDimension: 'ecs:service:DesiredCount' as const };
    const result = await this.client.send(new DescribeScalableTargetsCommand({
      ServiceNamespace: identity.ServiceNamespace, ResourceIds: [resourceId], ScalableDimension: identity.ScalableDimension,
    }), { abortSignal: AbortSignal.timeout(GENERATION_WORKER_AWS_TIMEOUT_MS) });
    const target = result.ScalableTargets?.find((item) => item.ResourceId === resourceId);
    if (target === undefined || target.MaxCapacity === undefined || target.MaxCapacity < 1) {
      throw new ConfigurationError('Generation worker scalable target is not configured');
    }
    if (target.SuspendedState?.ScheduledScalingSuspended !== true || target.SuspendedState.DynamicScalingInSuspended === true || target.SuspendedState.DynamicScalingOutSuspended === true) {
      throw new ConfigurationError('Generation worker scaling ownership is not configured');
    }
    const current = target.MinCapacity;
    if (current === floor) return;
    if (current === undefined || current > 1 || (floor === 0 && previousFloor !== current)) {
      throw new ConfigurationError('Generation worker minimum capacity was overridden');
    }
    // Updating only MinCapacity preserves the existing maximum and never forces
    // a scaled-out desired count back to one. Do not register a missing target.
    await this.client.send(new RegisterScalableTargetCommand({ ...identity, MinCapacity: floor }), {
      abortSignal: AbortSignal.timeout(GENERATION_WORKER_AWS_TIMEOUT_MS),
    });
  }
}
