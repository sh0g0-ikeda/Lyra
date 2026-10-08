import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
const state = ({
  attest: vi.fn(),
  attestExpanded: vi.fn(),
  construct: vi.fn(),
  enqueue: vi.fn(),
});

vi.mock('../../../src/lib/production44RuntimeSchemaAttestation.js', () => ({
  attestProduction44RuntimeSchema: state.attest,
}));
vi.mock('../../../src/lib/production44ExpandedRuntimeSchemaAttestation.js', () => ({
  attestProduction44ExpandedRuntimeSchema: state.attestExpanded,
}));
vi.mock('../../../src/repositories/PushNotificationOutboxRepository.js', () => ({
  PostgresPushNotificationOutboxRepository: class {
    public constructor(runner: unknown) { state.construct(runner); }
    public enqueueForTerminalJob(jobId: string): Promise<unknown> { return state.enqueue(jobId); }
  },
}));
vi.mock('../../../src/repositories/PushNotificationOutboxRepository.js?terminal-repository-suite', () => ({
  PostgresPushNotificationOutboxRepository: class {
    public constructor(runner: unknown) { state.construct(runner); }
    public enqueueForTerminalJob(jobId: string): Promise<unknown> { return state.enqueue(jobId); }
  },
}));
const terminalGenerationNotificationRecoveryRepository = await import(
  /* @vite-ignore */ ['../../../src/repositories/TerminalGenerationNotificationRecoveryRepository.js','?terminal-repository-suite'].join('')
) as typeof import('../../../src/repositories/TerminalGenerationNotificationRecoveryRepository.js');
const {
  createTerminalGenerationNotificationRecoveryRepository,
} = terminalGenerationNotificationRecoveryRepository;

const query = vi.fn();
const database: DatabaseClient & TransactionRunner = {
  query,
  transaction: async work => work({ query }),
};
const cutover = '2026-10-07T00:00:00.000Z';
const jobId = '00000000-0000-0000-0000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  state.attest.mockResolvedValue('production44_pg18_v1');
  query.mockResolvedValue({ rows: [] });
});
afterAll(restoreBunModuleMocks);

describe('終端生成通知recovery repository', () => {
  it('expandedは専用exact attestorをawaitして同profileのrepositoryを返す', async () => {
    state.attestExpanded.mockResolvedValue('production44_expanded_pg18_v1');
    const repository=await createTerminalGenerationNotificationRecoveryRepository(database,'production44_expanded_pg18_v1');
    expect(state.attestExpanded).toHaveBeenCalledTimes(1);
    expect(state.attestExpanded).toHaveBeenCalledWith(database);
    expect(state.attest).not.toHaveBeenCalled();
    expect(repository.profile).toBe('production44_expanded_pg18_v1');
    state.attestExpanded.mockRejectedValue(new Error('SCHEMA_UNSUPPORTED'));
    await expect(createTerminalGenerationNotificationRecoveryRepository(database,'production44_expanded_pg18_v1')).rejects.toThrow('SCHEMA_UNSUPPORTED');
  });
  it('production44文字列だけではSQLを許可せずexact attestation後に同DB outboxを固定生成する', async () => {
    let finish!: () => void;
    state.attest.mockReturnValue(new Promise(resolve => { finish = () => resolve('production44_pg18_v1'); }));
    const pending = createTerminalGenerationNotificationRecoveryRepository(database, 'production44_pg18_v1');
    await Promise.resolve();
    expect(state.construct).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(state.attest).toHaveBeenCalledTimes(1);
    expect(state.attest).toHaveBeenCalledWith(database);
    expect(state.construct).toHaveBeenCalledTimes(1);
    expect(state.construct).toHaveBeenCalledWith(database);
  });

  it.each([undefined, 'canonical', 'legacy_2debe_v1', 'unknown'])('未検証profile %sはattestationとSQLの前に拒否する', async profile => {
    await expect(createTerminalGenerationNotificationRecoveryRepository(database, profile)).rejects.toThrow();
    expect(state.attest).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('cutoverとUUID cursorとlimitをparameter bindingして候補だけを返す', async () => {
    query.mockResolvedValue({ rows: [{ id: jobId }] });
    const repository = await createTerminalGenerationNotificationRecoveryRepository(database, 'production44_pg18_v1');
    await expect(repository.scanBatch({ cutover, afterId: null, limit: 17 })).resolves.toEqual([{ jobId }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([cutover, null, 17]);
  });

  it.each([
    { cutover: '2026-10-07', afterId: null, limit: 1 },
    { cutover: '2026-10-07T00:00:00Z', afterId: null, limit: 1 },
    { cutover, afterId: 'not-a-uuid', limit: 1 },
    { cutover, afterId: null, limit: 0 },
    { cutover, afterId: null, limit: 101 },
  ])('不正な固定境界・cursor・limitをSQL前に拒否する %#', async input => {
    const repository = await createTerminalGenerationNotificationRecoveryRepository(database, 'production44_pg18_v1');
    await expect(repository.scanBatch(input)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('job再lock結果をinserted・existing・deferredへ欠落なく分類する', async () => {
    const repository = await createTerminalGenerationNotificationRecoveryRepository(database, 'production44_pg18_v1');
    state.enqueue
      .mockResolvedValueOnce({ outboxId: jobId, terminalStatus: 'failed', created: true, deliveryCount: 1 })
      .mockResolvedValueOnce({ outboxId: jobId, terminalStatus: 'failed', created: false, deliveryCount: 0 })
      .mockResolvedValueOnce(null);
    await expect(repository.enqueueCurrentTerminal(jobId)).resolves.toBe('inserted');
    await expect(repository.enqueueCurrentTerminal(jobId)).resolves.toBe('existing');
    await expect(repository.enqueueCurrentTerminal(jobId)).resolves.toBe('deferred');
    expect(state.enqueue).toHaveBeenCalledTimes(3);
  });

  it('不正job IDはoutbox transaction前に拒否する', async () => {
    const repository = await createTerminalGenerationNotificationRecoveryRepository(database, 'production44_pg18_v1');
    await expect(repository.enqueueCurrentTerminal('bad')).rejects.toThrow();
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});

async function restoreBunModuleMocks(): Promise<void> {
  if (!('Bun' in globalThis)) return;
  const bunTest = await import(/* @vite-ignore */ ['bun', 'test'].join(':')) as { mock: { restore(): void } };
  bunTest.mock.restore();
}
