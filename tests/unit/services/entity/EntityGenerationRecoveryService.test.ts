import { describe, expect, it } from 'vitest';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { EntityGenerationExecutionRepository } from '../../../../src/repositories/EntityGenerationExecutionRepository.js';
import type {
  EntityGenerationRecoveryRepository,
  FailedEntityGenerationJobMissingRefund,
  StaleEntityGenerationJob,
} from '../../../../src/repositories/EntityGenerationRecoveryRepository.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';
import type {
  GrantOrganizationCreditsRequest,
  OrganizationServicePort,
} from '../../../../src/services/organization/OrganizationService.js';
import { EntityGenerationRecoveryService } from '../../../../src/services/entity/EntityGenerationRecoveryService.js';

class FakeRecoveryRepository implements EntityGenerationRecoveryRepository {
  public jobs: StaleEntityGenerationJob[] = [];
  public failedJobsMissingRefund: FailedEntityGenerationJobMissingRefund[] = [];
  public entityStaleLookup: { userId: string; entityId: string; organizationId: string | null } | null = null;
  public entityFailedLookup: { userId: string; entityId: string; organizationId: string | null } | null = null;

  public async listStaleProcessingJobs(): Promise<StaleEntityGenerationJob[]> {
    return [...this.jobs];
  }

  public async listStaleProcessingJobsForEntity(
    userId: string,
    entityId: string,
    _cutoff?: Date,
    _limit?: number,
    organizationId: string | null = null,
  ): Promise<StaleEntityGenerationJob[]> {
    this.entityStaleLookup = { userId, entityId, organizationId };
    return this.jobs.filter(
      (job) =>
        job.userId === userId &&
        job.entityId === entityId &&
        (organizationId === null ? job.organizationId == null : job.organizationId === organizationId),
    );
  }

  public async listFailedJobsMissingRefund(): Promise<FailedEntityGenerationJobMissingRefund[]> {
    return [...this.failedJobsMissingRefund];
  }

  public async listFailedJobsMissingRefundForEntity(
    userId: string,
    entityId: string,
    _limit?: number,
    organizationId: string | null = null,
  ): Promise<FailedEntityGenerationJobMissingRefund[]> {
    this.entityFailedLookup = { userId, entityId, organizationId };
    return this.failedJobsMissingRefund.filter(
      (job) =>
        job.userId === userId &&
        job.entityId === entityId &&
        (organizationId === null ? job.organizationId == null : job.organizationId === organizationId),
    );
  }
}

class FakeExecutionRepository implements EntityGenerationExecutionRepository {
  public failedJobIds: string[] = [];
  public staleBeforeByJobId = new Map<string, Date | undefined>();
  public shouldRecover = true;

  public async claimQueuedEntityGenerationJob(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async touchEntityGenerationProgress(): Promise<boolean> {
    throw new Error('not used');
  }

  public async completeEntityGeneration(): Promise<boolean> {
    throw new Error('not used');
  }

  public async failEntityGeneration(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
    staleBefore?: Date;
  }): Promise<boolean> {
    if (!this.shouldRecover) {
      return false;
    }

    this.failedJobIds.push(input.jobId);
    this.staleBeforeByJobId.set(input.jobId, input.staleBefore);
    return true;
  }
}

class FakeCreditService implements CreditServicePort {
  public refunds: RefundCreditsParams[] = [];
  public shouldFailRefund = false;
  public failedRefundJobIds = new Set<string>();

  public async getBalance(): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async consumeCredits(_params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    this.refunds.push(params);
    if (this.shouldFailRefund || (params.jobId !== undefined && this.failedRefundJobIds.has(params.jobId))) {
      throw new Error('refund unavailable');
    }

    return this.getBalance();
  }
}

class FakeOrganizationService {
  public refunds: Array<GrantOrganizationCreditsRequest & { jobId?: string | null }> = [];

  public async refundCredits(
    params: GrantOrganizationCreditsRequest & { jobId?: string | null },
  ): Promise<unknown> {
    this.refunds.push(params);
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }
}

describe('EntityGenerationRecoveryService', () => {
  it('stale processing jobs を failed に戻して refund する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.jobs = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-1',
        staleAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverAllStaleJobs();

    expect(recoveredCount).toBe(1);
    expect(executionRepository.failedJobIds).toEqual(['job-1']);
    expect(creditService.refunds).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        amount: 1,
        jobId: 'job-1',
      }),
    ]);
  });

  it('対象 entity に紐づく stale job だけ回収する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.jobs = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-1',
        staleAt: new Date('2026-06-03T00:00:00.000Z'),
      },
      {
        jobId: 'job-2',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-2',
        staleAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverStaleJobsForEntity('user-1', 'entity-2');

    expect(recoveredCount).toBe(1);
    expect(executionRepository.failedJobIds).toEqual(['job-2']);
  });

  it('failed 化済みで refund 台帳がない entity job を再返金する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.failedJobsMissingRefund = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-1',
        completedAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverAllStaleJobs();

    expect(recoveredCount).toBe(1);
    expect(executionRepository.failedJobIds).toEqual([]);
    expect(creditService.refunds[0]).toMatchObject({
      userId: 'user-1',
      amount: 1,
      description: 'Refund for failed entity generation job missing refund ledger',
      jobId: 'job-1',
    });
  });

  it('entity 指定回収では該当 entity の未返金 failed job だけ再返金する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.failedJobsMissingRefund = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-1',
        completedAt: null,
      },
      {
        jobId: 'job-2',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-2',
        completedAt: null,
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverStaleJobsForEntity('user-1', 'entity-2');

    expect(recoveredCount).toBe(1);
    expect(creditService.refunds).toEqual([
      expect.objectContaining({
        jobId: 'job-2',
      }),
    ]);
  });

  it('creditCost が 0 の stale entity job は refund を呼ばずに回収する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.jobs = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 0,
        entityId: 'entity-1',
        staleAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverAllStaleJobs();

    expect(recoveredCount).toBe(1);
    expect(executionRepository.failedJobIds).toEqual(['job-1']);
    expect(creditService.refunds).toEqual([]);
  });

  it('返金が失敗しても後続の stale entity job を復旧する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.jobs = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-1',
        staleAt: new Date('2026-06-03T00:00:00.000Z'),
      },
      {
        jobId: 'job-2',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-2',
        staleAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    creditService.failedRefundJobIds.add('job-1');
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverAllStaleJobs();

    expect(recoveredCount).toBe(2);
    expect(creditService.refunds.map((refund) => refund.jobId)).toEqual(['job-1', 'job-2']);
    expect(executionRepository.failedJobIds).toEqual(['job-1', 'job-2']);
    expect(executionRepository.staleBeforeByJobId.get('job-1')).toBeInstanceOf(Date);
  });

  it('stale entity job の failed 化が競合で失敗した場合は refund しない', async () => {
    const repository = new FakeRecoveryRepository();
    repository.jobs = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 1,
        entityId: 'entity-1',
        staleAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    executionRepository.shouldRecover = false;
    const creditService = new FakeCreditService();
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverAllStaleJobs();

    expect(recoveredCount).toBe(0);
    expect(executionRepository.failedJobIds).toEqual([]);
    expect(creditService.refunds).toEqual([]);
  });

  it('法人 stale entity job は組織残高へ返金する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.jobs = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        organizationId: 'org-1',
        creditCost: 1,
        entityId: 'entity-1',
        staleAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const organizationService = new FakeOrganizationService();
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
      50,
      organizationService as unknown as OrganizationServicePort,
    );

    const recoveredCount = await service.recoverAllStaleJobs();

    expect(recoveredCount).toBe(1);
    expect(creditService.refunds).toEqual([]);
    expect(organizationService.refunds).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        amount: 1,
        jobId: 'job-1',
      }),
    ]);
  });

  it('法人 entity 指定回収では organizationId を条件にして未返金 failed job を組織残高へ戻す', async () => {
    const repository = new FakeRecoveryRepository();
    repository.failedJobsMissingRefund = [
      {
        jobId: 'job-personal',
        userId: 'user-1',
        organizationId: null,
        creditCost: 1,
        entityId: 'entity-1',
        completedAt: null,
      },
      {
        jobId: 'job-org',
        userId: 'user-1',
        organizationId: 'org-1',
        creditCost: 2,
        entityId: 'entity-1',
        completedAt: null,
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const organizationService = new FakeOrganizationService();
    const service = new EntityGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
      50,
      organizationService as unknown as OrganizationServicePort,
    );

    const recoveredCount = await service.recoverStaleJobsForEntity('user-1', 'entity-1', 'org-1');

    expect(recoveredCount).toBe(1);
    expect(repository.entityStaleLookup).toEqual({ userId: 'user-1', entityId: 'entity-1', organizationId: 'org-1' });
    expect(repository.entityFailedLookup).toEqual({ userId: 'user-1', entityId: 'entity-1', organizationId: 'org-1' });
    expect(creditService.refunds).toEqual([]);
    expect(organizationService.refunds).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        amount: 2,
        jobId: 'job-org',
      }),
    ]);
  });
});
