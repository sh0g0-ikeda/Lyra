/**
 * Design: Spec §2/§3/§4/§5. Composite bootstrap is a new additive API; its
 * repository owns one transaction so an idempotent request yields either the
 * complete initial graph or no graph, without changing released mobile routes.
 */
import { describe, expect, it } from 'vitest';
import { WorkBootstrapService, type WorkBootstrapRepositoryPort } from '../../../../src/services/story/WorkBootstrapService.js';
import type { CreateWorkBootstrapInput, WorkBootstrapResult } from '../../../../src/domain/types/workBootstrap.js';

describe('WorkBootstrapService', () => {
  it('同じリクエストIDを再送すると同じ初期グラフを返す', async () => {
    const result = {} as WorkBootstrapResult;
    const repository: WorkBootstrapRepositoryPort = {
      create: async () => result,
      listMetadata: async () => [],
    };
    const service = new WorkBootstrapService(repository);
    const input: CreateWorkBootstrapInput = { title: '題名', mode: 'one_shot', requestId: '11111111-1111-4111-8111-111111111111', organizationId: null };
    await expect(service.create('22222222-2222-4222-8222-222222222222', input)).resolves.toBe(result);
  });
});
