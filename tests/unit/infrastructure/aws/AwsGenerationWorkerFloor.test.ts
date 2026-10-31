import { DescribeScalableTargetsCommand, RegisterScalableTargetCommand } from '@aws-sdk/client-application-auto-scaling';
import { describe, expect, it } from 'vitest';
import { AwsGenerationWorkerFloor, type WorkerScalingClient } from '../../../../src/infrastructure/aws/AwsGenerationWorkerFloor.js';

function setup(minimum = 0, suspended = true): { floor: AwsGenerationWorkerFloor; commands: Array<DescribeScalableTargetsCommand | RegisterScalableTargetCommand> } {
  const commands: Array<DescribeScalableTargetsCommand | RegisterScalableTargetCommand> = [];
  const client: WorkerScalingClient = { send: async (command) => {
    commands.push(command);
    return command instanceof DescribeScalableTargetsCommand ? {
      ScalableTargets: [{ ResourceId: 'service/test/worker', MinCapacity: minimum, MaxCapacity: 5, SuspendedState: { ScheduledScalingSuspended: suspended } }],
    } : {};
  } };
  return { floor: new AwsGenerationWorkerFloor(client), commands };
}
describe('AwsGenerationWorkerFloor', () => {
  it('既存上限や現在台数を送らず最低台数だけを変更する', async () => {
    const { floor, commands } = setup();
    await floor.applyFloor('service/test/worker', 1, null);
    expect(commands[1]).toBeInstanceOf(RegisterScalableTargetCommand);
    expect(commands[1]?.input).toEqual({ ServiceNamespace: 'ecs', ResourceId: 'service/test/worker', ScalableDimension: 'ecs:service:DesiredCount', MinCapacity: 1 });
  });
  it('既存scheduleが有効な場合は二重制御を開始しない', async () => {
    const { floor, commands } = setup(0, false);
    await expect(floor.applyFloor('service/test/worker', 1, null)).rejects.toThrow();
    expect(commands).toHaveLength(1);
  });
  it('自身が設定していない最低台数を停止へ下げない', async () => {
    const { floor, commands } = setup(1);
    await expect(floor.applyFloor('service/test/worker', 0, null)).rejects.toThrow();
    expect(commands).toHaveLength(1);
  });
  it('運用者が2台以上へ引き上げた最低台数を下げない', async () => {
    const { floor, commands } = setup(2);
    await expect(floor.applyFloor('service/test/worker', 0, 1)).rejects.toThrow();
    expect(commands).toHaveLength(1);
  });
  it('同じ最低台数なら更新APIを発行しない', async () => {
    const { floor, commands } = setup(1);
    await floor.applyFloor('service/test/worker', 1, 1);
    expect(commands).toHaveLength(1);
  });
});
