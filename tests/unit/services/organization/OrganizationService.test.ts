import { describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError } from '../../../../src/domain/errors/index.js';
import type {
  Organization,
  OrganizationAuditLog,
  OrganizationCreditBalance,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationUsageEvent,
} from '../../../../src/domain/types/organization.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type {
  CreateOrganizationRecord,
  OrganizationRepository,
} from '../../../../src/repositories/OrganizationRepository.js';
import { OrganizationService } from '../../../../src/services/organization/OrganizationService.js';
import type {
  InvitationEmailDeliveryResult,
  OrganizationInvitationEmailServicePort,
} from '../../../../src/services/organization/OrganizationInvitationEmailService.js';

interface AuditLogInput {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata?: Record<string, unknown>;
}

interface UsageEventInput {
  organizationId: string;
  userId: string | null;
  workId: string | null;
  generationJobId: string | null;
  eventType: string;
  creditAmount: number;
  metadata?: Record<string, unknown>;
}

const fakeClient = {
  query: async () => ({ rows: [] }),
} as unknown as DatabaseClient;

describe('OrganizationService', () => {
  it('法人Workspace作成時は契約プランを初期値に固定する', async () => {
    const repository = new InMemoryOrganizationRepository();
    const service = buildService(repository);

    const workspace = await service.createOrganization('owner-user', {
      name: 'New Studio',
      legalName: null,
      billingEmail: 'billing@example.com',
    });

    expect(workspace.organization).toMatchObject({
      name: 'New Studio',
      planKey: 'enterprise_a',
      createdByUserId: 'owner-user',
    });
    expect(repository.createdOrganizations[0]).toMatchObject({
      name: 'New Studio',
      planKey: 'enterprise_a',
      createdByUserId: 'owner-user',
    });
  });

  it('通常の法人Workspace更新では契約プランと状態を変更しない', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.organization = buildOrganization({
      name: 'Before',
      status: 'active',
      planKey: 'enterprise_a',
    });
    repository.setMember(buildMember({ userId: 'owner-user', role: 'owner' }));
    const service = buildService(repository);

    const organization = await service.updateOrganization('owner-user', 'org-1', {
      name: 'After',
      status: 'suspended',
      planKey: 'enterprise_c',
    } as unknown as Parameters<typeof service.updateOrganization>[2]);

    expect(organization).toMatchObject({
      name: 'After',
      status: 'active',
      planKey: 'enterprise_a',
    });
    expect(repository.insertedAuditLogs.at(-1)).toMatchObject({
      action: 'organization.updated',
      metadata: { fields: ['name'] },
    });
  });

  it('管理者の法人契約変更を監査ログに残す', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.organization = buildOrganization({
      status: 'past_due',
      planKey: 'enterprise_a',
      billingEmail: 'old@example.com',
    });
    const service = buildService(repository);

    const organization = await service.adminUpdateOrganizationContract('admin-user', 'org-1', {
      planKey: 'enterprise_c',
      status: 'active',
      billingEmail: 'new@example.com',
    });

    expect(organization).toMatchObject({
      planKey: 'enterprise_c',
      status: 'active',
      billingEmail: 'new@example.com',
    });
    expect(repository.insertedAuditLogs).toEqual([
      expect.objectContaining({
        action: 'organization.contract_updated',
        actorUserId: 'admin-user',
        targetType: 'organization',
        targetId: 'org-1',
        metadata: {
          from_plan_key: 'enterprise_a',
          to_plan_key: 'enterprise_c',
          from_status: 'past_due',
          to_status: 'active',
          billing_email_changed: true,
        },
      }),
    ]);
  });

  it('管理者の法人クレジット手動付与は指定された残高枠へ反映する', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.balance = buildBalance({ monthlyCredits: 100, purchasedCredits: 20 });
    const service = buildService(repository);

    const monthly = await service.adminGrantCredits({
      organizationId: 'org-1',
      actorUserId: 'admin-user',
      bucket: 'monthly',
      amount: 600,
      description: 'manual monthly correction',
    });
    const purchased = await service.adminGrantCredits({
      organizationId: 'org-1',
      actorUserId: 'admin-user',
      bucket: 'purchased',
      amount: 50,
      description: 'manual purchased correction',
      packageCode: null,
    });

    expect(monthly).toMatchObject({
      monthlyCredits: 600,
      purchasedCredits: 20,
    });
    expect(purchased).toMatchObject({
      monthlyCredits: 600,
      purchasedCredits: 70,
    });
    expect(repository.insertedAuditLogs.map((log) => log.metadata?.grant_type)).toEqual([
      'monthly',
      'purchased',
    ]);
  });

  it('請求担当者は請求情報だけ見られ、作品閲覧権限と利用履歴権限は持たない', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-billing', userId: 'billing-user', role: 'billing' }));

    const service = buildService(repository);

    await expect(service.requireMembership('org-1', 'billing-user', 'view_billing')).resolves.toMatchObject({
      role: 'billing',
    });
    await expect(service.requireMembership('org-1', 'billing-user', 'view_work')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.requireMembership('org-1', 'billing-user', 'view_usage')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('法人共有残高はWorkspace所属メンバーなら確認できる', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-editor', userId: 'editor-user', role: 'editor' }));
    repository.balance = buildBalance({ monthlyCredits: 40, purchasedCredits: 12 });

    const service = buildService(repository);

    await expect(service.getCreditBalance('editor-user', 'org-1')).resolves.toMatchObject({
      monthlyCredits: 40,
      purchasedCredits: 12,
    });
  });

  it('停止中の法人Workspaceでも所属確認と残高確認はできる', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.organization = buildOrganization({ status: 'suspended' });
    repository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));
    repository.balance = buildBalance({ monthlyCredits: 0, purchasedCredits: 7 });

    const service = buildService(repository);

    await expect(service.getOrganization('owner-user', 'org-1')).resolves.toMatchObject({
      organization: expect.objectContaining({ status: 'suspended' }),
      balance: expect.objectContaining({ purchasedCredits: 7 }),
    });
    await expect(service.getCreditBalance('owner-user', 'org-1')).resolves.toMatchObject({
      purchasedCredits: 7,
    });
  });

  it('停止中の法人Workspaceでは請求復旧以外の操作を拒否する', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.organization = buildOrganization({ status: 'suspended' });
    repository.setMember(buildMember({ role: 'owner' }));

    const service = buildService(repository);

    await expect(service.requireMembership('org-1', 'user-1', 'manage_billing')).resolves.toMatchObject({
      role: 'owner',
    });
    await expect(service.requireMembership('org-1', 'user-1', 'view_work')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.requireMembership('org-1', 'user-1', 'generate')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('支払い遅延中の法人Workspaceでは生成を止めるが履歴確認は許可する', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.organization = buildOrganization({ status: 'past_due' });
    repository.setMember(buildMember({ role: 'owner' }));

    const service = buildService(repository);

    await expect(service.requireMembership('org-1', 'user-1', 'view_usage')).resolves.toMatchObject({
      role: 'owner',
    });
    await expect(service.requireMembership('org-1', 'user-1', 'generate')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('請求担当者の監査ログは課金系イベントだけに制限される', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-billing', userId: 'billing-user', role: 'billing' }));
    repository.auditLogs = [
      buildAuditLog('billing.portal_opened'),
      buildAuditLog('member.invited'),
      buildAuditLog('credit.consumed'),
      buildAuditLog('subscription.updated'),
    ];

    const service = buildService(repository);

    const logs = await service.listAuditLogs('billing-user', 'org-1');

    expect(logs.map((log) => log.action)).toEqual([
      'billing.portal_opened',
      'credit.consumed',
      'subscription.updated',
    ]);
    expect(repository.prefixRequests).toEqual([['billing.', 'credit.', 'subscription.']]);
    expect(repository.usedFullAuditLogAccess).toBe(false);
  });

  it('最後のownerを降格できない', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.activeOwnerCount = 1;
    repository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));

    const service = buildService(repository);

    await expect(service.updateMember('owner-user', 'org-1', 'member-owner', { role: 'admin' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(repository.insertedAuditLogs).toHaveLength(0);
  });

  it('admin cannot demote or remove an owner', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.activeOwnerCount = 2;
    repository.setMember(buildMember({ id: 'member-admin', userId: 'admin-user', role: 'admin' }));
    repository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));

    const service = buildService(repository);

    await expect(service.updateMember('admin-user', 'org-1', 'member-owner', { role: 'admin' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.updateMember('admin-user', 'org-1', 'member-owner', { status: 'removed' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repository.insertedAuditLogs).toHaveLength(0);
  });

  it('admin cannot promote a member to owner', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-admin', userId: 'admin-user', role: 'admin' }));
    repository.setMember(buildMember({ id: 'member-editor', userId: 'editor-user', role: 'editor' }));

    const service = buildService(repository);

    await expect(service.updateMember('admin-user', 'org-1', 'member-editor', { role: 'owner' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repository.insertedAuditLogs).toHaveLength(0);
  });

  it('メンバーの権限変更を監査ログに残す', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));
    repository.setMember(buildMember({ id: 'member-editor', userId: 'editor-user', role: 'editor' }));

    const service = buildService(repository);

    await service.updateMember('owner-user', 'org-1', 'member-editor', { role: 'viewer' });

    expect(repository.insertedAuditLogs).toEqual([
      expect.objectContaining({
        action: 'member.role_updated',
        actorUserId: 'owner-user',
        targetId: 'member-editor',
        metadata: { from_role: 'editor', to_role: 'viewer' },
      }),
    ]);
  });

  it('メンバー停止と復帰を監査ログに残す', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));
    repository.setMember(buildMember({ id: 'member-editor', userId: 'editor-user', role: 'editor' }));

    const service = buildService(repository);

    await service.updateMember('owner-user', 'org-1', 'member-editor', { status: 'suspended' });
    await service.updateMember('owner-user', 'org-1', 'member-editor', { status: 'active' });

    expect(repository.insertedAuditLogs).toEqual([
      expect.objectContaining({
        action: 'member.suspended',
        actorUserId: 'owner-user',
        targetId: 'member-editor',
        metadata: { from_status: 'active', to_status: 'suspended' },
      }),
      expect.objectContaining({
        action: 'member.reactivated',
        actorUserId: 'owner-user',
        targetId: 'member-editor',
        metadata: { from_status: 'suspended', to_status: 'active' },
      }),
    ]);
  });

  it('汎用監査イベントを本文なしの最小メタデータで記録できる', async () => {
    const repository = new InMemoryOrganizationRepository();
    const service = buildService(repository);

    await service.recordAuditEvent({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      action: 'episode.updated',
      targetType: 'episode',
      targetId: 'episode-1',
      metadata: {
        fields: ['title', 'story_full_draft'],
        skipped: undefined,
      },
    });

    expect(repository.insertedAuditLogs).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        action: 'episode.updated',
        targetType: 'episode',
        targetId: 'episode-1',
        metadata: { fields: ['title', 'story_full_draft'] },
      }),
    ]);
  });

  it('法人生成の完了を利用履歴と監査ログに残す', async () => {
    const repository = new InMemoryOrganizationRepository();
    const service = buildService(repository);

    await service.recordGenerationCompleted({
      organizationId: 'org-1',
      userId: 'user-1',
      workId: 'work-1',
      jobId: 'job-1',
      generationType: 'page_generate',
      metadata: { page_id: 'page-1' },
    });

    expect(repository.insertedUsageEvents).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        workId: 'work-1',
        generationJobId: 'job-1',
        eventType: 'generation.completed',
        creditAmount: 0,
        metadata: {
          action_type: 'generation',
          generation_type: 'page_generate',
          status: 'completed',
          credits_used: 0,
          page_id: 'page-1',
        },
      }),
    ]);
    expect(repository.insertedAuditLogs).toEqual([
      expect.objectContaining({
        action: 'generation.completed',
        targetType: 'generation_job',
        targetId: 'job-1',
        metadata: {
          work_id: 'work-1',
          action_type: 'generation',
          generation_type: 'page_generate',
          status: 'completed',
          credits_used: 0,
          page_id: 'page-1',
        },
      }),
    ]);
  });

  it('法人生成の失敗理由を利用履歴と監査ログに残す', async () => {
    const repository = new InMemoryOrganizationRepository();
    const service = buildService(repository);

    await service.recordGenerationFailed({
      organizationId: 'org-1',
      userId: 'user-1',
      workId: null,
      jobId: 'job-1',
      generationType: 'entity_generate',
      errorMessage: 'renderer failed',
    });

    expect(repository.insertedUsageEvents[0]).toMatchObject({
      eventType: 'generation.failed',
      metadata: {
        action_type: 'generation',
        generation_type: 'entity_generate',
        status: 'failed',
        credits_used: 0,
        error_message: 'renderer failed',
      },
    });
    expect(repository.insertedAuditLogs[0]).toMatchObject({
      action: 'generation.failed',
      targetId: 'job-1',
      metadata: {
        work_id: null,
        action_type: 'generation',
        generation_type: 'entity_generate',
        status: 'failed',
        credits_used: 0,
        error_message: 'renderer failed',
      },
    });
  });

  it('法人生成開始時は消費履歴とgeneration.started監査ログを残す', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-editor', userId: 'editor-user', role: 'editor' }));
    repository.balance = buildBalance({ monthlyCredits: 10 });
    const service = buildService(repository);

    await service.consumeCredits({
      organizationId: 'org-1',
      userId: 'editor-user',
      workId: 'work-1',
      jobId: 'job-1',
      cost: 3,
      description: 'Page generation',
      eventType: 'generation.started',
    });

    expect(repository.insertedUsageEvents[0]).toMatchObject({
      organizationId: 'org-1',
      userId: 'editor-user',
      workId: 'work-1',
      generationJobId: 'job-1',
      eventType: 'generation.started',
      creditAmount: 3,
      metadata: {
        action_type: 'generation',
        generation_type: 'page_generate',
        status: 'started',
        credits_used: 3,
        description: 'Page generation',
      },
    });
    expect(repository.insertedAuditLogs.map((log) => log.action)).toEqual([
      'generation.started',
      'credit.consumed',
    ]);
  });

  it('法人生成返金は利用履歴にも残すが消費集計は増やさない', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.balance = buildBalance({ purchasedCredits: 2 });
    const service = buildService(repository);

    await service.refundCredits({
      organizationId: 'org-1',
      actorUserId: 'editor-user',
      amount: 3,
      description: 'Refund failed generation',
      jobId: 'job-1',
    });

    expect(repository.insertedUsageEvents[0]).toMatchObject({
      eventType: 'credit.refunded',
      creditAmount: 0,
      metadata: {
        action_type: 'refund',
        status: 'refunded',
        credits_refunded: 3,
        description: 'Refund failed generation',
      },
    });
    expect(repository.insertedAuditLogs[0]).toMatchObject({
      action: 'credit.refunded',
      targetId: 'job-1',
    });
  });

  it('法人月額クレジットは更新時に蓄積せず規定値へリセットする', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.balance = buildBalance({ monthlyCredits: 240, purchasedCredits: 12 });
    const service = buildService(repository);

    const balance = await service.grantMonthlyCredits({
      organizationId: 'org-1',
      actorUserId: 'billing-user',
      amount: 600,
      description: 'Monthly enterprise grant',
      stripeEventId: 'evt-monthly',
    });

    expect(balance).toMatchObject({
      monthlyCredits: 600,
      purchasedCredits: 12,
    });
    expect(repository.balance).toMatchObject({
      monthlyCredits: 600,
      purchasedCredits: 12,
    });
    expect(repository.insertedAuditLogs[0]).toMatchObject({
      action: 'credit.granted',
      metadata: {
        grant_type: 'monthly',
        amount: 600,
        monthly_after: 600,
        purchased_after: 12,
        stripe_event_id: 'evt-monthly',
      },
    });
  });

  it('法人作品のエクスポートを利用履歴と監査ログに残す', async () => {
    const repository = new InMemoryOrganizationRepository();
    const service = buildService(repository);

    await service.recordWorkExported({
      organizationId: 'org-1',
      userId: 'user-1',
      workId: 'work-1',
      pageId: 'page-1',
    });

    expect(repository.insertedUsageEvents[0]).toMatchObject({
      eventType: 'work.exported',
      creditAmount: 0,
      workId: 'work-1',
      metadata: { page_id: 'page-1' },
    });
    expect(repository.insertedAuditLogs[0]).toMatchObject({
      action: 'work.exported',
      targetType: 'work',
      targetId: 'work-1',
      metadata: { page_id: 'page-1' },
    });
  });
  it('招待作成時に招待URLとメール送信結果を返す', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));
    const emailService = new FakeInvitationEmailService({ status: 'sent' });
    const service = buildService(repository, emailService);

    const result = await service.inviteMember('owner-user', 'org-1', {
      email: 'New.Member@Example.com',
      role: 'editor',
    });

    expect(result.invitation).toMatchObject({
      email: 'new.member@example.com',
      role: 'editor',
      status: 'pending',
    });
    expect(result.invitationUrl).toContain('/invite/');
    expect(result.emailDelivery).toEqual({ status: 'sent' });
    expect(emailService.deliveries[0]).toMatchObject({
      organization: expect.objectContaining({ id: 'org-1' }),
      invitation: expect.objectContaining({ email: 'new.member@example.com' }),
    });
    expect(repository.insertedAuditLogs).toEqual([
      expect.objectContaining({
        action: 'member.invited',
        targetType: 'invitation',
      }),
    ]);
  });

  it('招待再送ではtokenを作り直し再送回数を増やす', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));
    // Duplicate pending invites should be recoverable from the same invite form.
    // A failed delivery from an earlier attempt must not force the user into a hidden manual cleanup path.
    {
      const duplicateRepository = new InMemoryOrganizationRepository();
      duplicateRepository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));
      duplicateRepository.invitations = [
        buildInvitation({
          id: 'duplicate-invitation-1',
          email: 'new.member@example.com',
          status: 'pending',
          resendCount: 0,
          sendStatus: 'failed',
          sendErrorCode: 'old_error',
          sendErrorMessage: 'old failure',
        }),
      ];
      const duplicateEmailService = new FakeInvitationEmailService({ status: 'sent' });
      const duplicateService = buildService(duplicateRepository, duplicateEmailService);

      const duplicateResult = await duplicateService.inviteMember('owner-user', 'org-1', {
        email: 'New.Member@Example.com',
        role: 'viewer',
      });

      expect(duplicateRepository.invitations).toHaveLength(1);
      expect(duplicateResult.invitation).toMatchObject({
        id: 'duplicate-invitation-1',
        email: 'new.member@example.com',
        role: 'viewer',
        status: 'pending',
        resendCount: 1,
        sendStatus: 'not_sent',
        sendErrorCode: null,
        sendErrorMessage: null,
      });
      expect(duplicateResult.emailDelivery).toEqual({ status: 'sent' });
      expect(duplicateRepository.insertedAuditLogs).toEqual([
        expect.objectContaining({
          action: 'member.invitation_resent',
          targetId: 'duplicate-invitation-1',
        }),
      ]);
    }

    repository.invitations = [buildInvitation({ id: 'invitation-1', resendCount: 0 })];
    const emailService = new FakeInvitationEmailService({ status: 'disabled' });
    const service = buildService(repository, emailService);

    const result = await service.resendInvitation('owner-user', 'org-1', 'invitation-1');

    expect(result.invitationUrl).toContain('/invite/');
    expect(result.emailDelivery).toEqual({ status: 'disabled' });
    expect(result.invitation).toMatchObject({
      id: 'invitation-1',
      resendCount: 1,
      sendStatus: 'not_sent',
    });
    expect(repository.invitations[0]).toMatchObject({
      id: 'invitation-1',
      resendCount: 1,
      sendStatus: 'not_sent',
      sendErrorCode: null,
      sendErrorMessage: null,
    });
    expect(repository.insertedAuditLogs).toEqual([
      expect.objectContaining({
        action: 'member.invitation_resent',
      }),
    ]);
  });

  it('pending招待を取り消すと受諾不能な状態にする', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.setMember(buildMember({ id: 'member-owner', userId: 'owner-user', role: 'owner' }));
    repository.invitations = [buildInvitation({ id: 'invitation-1', status: 'pending' })];
    const service = buildService(repository);

    const invitation = await service.revokeInvitation('owner-user', 'org-1', 'invitation-1');

    expect(invitation).toMatchObject({
      id: 'invitation-1',
      status: 'revoked',
      revokedByUserId: 'owner-user',
    });
    expect(repository.insertedAuditLogs).toEqual([
      expect.objectContaining({
        action: 'member.invitation_revoked',
      }),
    ]);
  });

  it('期限切れpending招待のpreviewはexpiredへ正規化する', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.invitations = [
      buildInvitation({
        id: 'invitation-1',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ];
    const service = buildService(repository);

    const preview = await service.previewInvitation('raw-token');

    expect(preview.invitation.status).toBe('expired');
    expect(repository.invitations[0]?.status).toBe('expired');
  });
});

function buildService(
  repository: InMemoryOrganizationRepository,
  invitationEmailService?: OrganizationInvitationEmailServicePort,
): OrganizationService {
  return new OrganizationService(repository as unknown as OrganizationRepository, invitationEmailService);
}

class FakeInvitationEmailService implements OrganizationInvitationEmailServicePort {
  public readonly deliveries: Array<{
    organization: Organization;
    invitation: OrganizationInvitation;
    invitationUrl: string;
  }> = [];

  public constructor(private readonly result: InvitationEmailDeliveryResult) {}

  public async deliverInvitation(input: {
    organization: Organization;
    invitation: OrganizationInvitation;
    invitationUrl: string;
  }): Promise<InvitationEmailDeliveryResult> {
    this.deliveries.push(input);
    return this.result;
  }
}

class InMemoryOrganizationRepository {
  public readonly members = new Map<string, OrganizationMember>();
  public organization: Organization = buildOrganization();
  public auditLogs: OrganizationAuditLog[] = [];
  public usageEvents: OrganizationUsageEvent[] = [];
  public insertedAuditLogs: AuditLogInput[] = [];
  public insertedUsageEvents: UsageEventInput[] = [];
  public createdOrganizations: CreateOrganizationRecord[] = [];
  public invitations: OrganizationInvitation[] = [];
  public emailDeliveryLogs: unknown[] = [];
  public prefixRequests: string[][] = [];
  public usedFullAuditLogAccess = false;
  public activeOwnerCount = 1;
  public balance: OrganizationCreditBalance = buildBalance();

  public setMember(member: OrganizationMember): void {
    this.members.set(memberKey(member.organizationId, member.userId), member);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(fakeClient);
  }

  public async createOrganization(input: CreateOrganizationRecord): Promise<Organization> {
    this.createdOrganizations.push(input);
    this.organization = buildOrganization({
      name: input.name,
      legalName: input.legalName,
      billingEmail: input.billingEmail,
      planKey: input.planKey,
      createdByUserId: input.createdByUserId,
    });
    return this.organization;
  }

  public async updateOrganization(
    organizationId: string,
    input: {
      name?: string;
      legalName?: string | null;
      billingEmail?: string | null;
      status?: Organization['status'];
      planKey?: Organization['planKey'];
    },
  ): Promise<Organization | null> {
    if (organizationId !== this.organization.id) {
      return null;
    }
    this.organization = {
      ...this.organization,
      name: input.name ?? this.organization.name,
      legalName: input.legalName === undefined ? this.organization.legalName : input.legalName,
      billingEmail: input.billingEmail === undefined ? this.organization.billingEmail : input.billingEmail,
      status: input.status ?? this.organization.status,
      planKey: input.planKey ?? this.organization.planKey,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    return this.organization;
  }

  public async createOrUpdateMember(input: {
    organizationId: string;
    userId: string;
    role: OrganizationMemberRole;
    status: OrganizationMemberStatus;
    invitedByUserId: string | null;
    joinedAt: Date | null;
  }): Promise<OrganizationMember> {
    const member = buildMember({
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      status: input.status,
      invitedByUserId: input.invitedByUserId,
      joinedAt: input.joinedAt,
    });
    this.setMember(member);
    return member;
  }

  public async findMemberByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    return this.members.get(memberKey(organizationId, userId)) ?? null;
  }

  public async findOrganizationById(organizationId: string): Promise<Organization | null> {
    return this.organization.id === organizationId ? this.organization : null;
  }

  public async findMemberById(organizationId: string, memberId: string): Promise<OrganizationMember | null> {
    return (
      Array.from(this.members.values()).find(
        (member) => member.organizationId === organizationId && member.id === memberId,
      ) ?? null
    );
  }

  public async updateMember(
    organizationId: string,
    memberId: string,
    input: { role?: OrganizationMemberRole; status?: OrganizationMemberStatus },
  ): Promise<OrganizationMember | null> {
    const current = await this.findMemberById(organizationId, memberId);
    if (current === null) {
      return null;
    }
    const updated: OrganizationMember = {
      ...current,
      role: input.role ?? current.role,
      status: input.status ?? current.status,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    this.setMember(updated);
    return updated;
  }

  public async countActiveOwners(): Promise<number> {
    return this.activeOwnerCount;
  }

  public async createInvitation(input: {
    organizationId: string;
    email: string;
    role: OrganizationMemberRole;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<OrganizationInvitation> {
    void input.tokenHash;
    const invitation = buildInvitation({
      organizationId: input.organizationId,
      email: input.email.toLowerCase(),
      role: input.role,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
    });
    this.invitations.unshift(invitation);
    return invitation;
  }

  public async listInvitations(organizationId: string): Promise<OrganizationInvitation[]> {
    return this.invitations.filter((invitation) => invitation.organizationId === organizationId);
  }

  public async findPendingInvitationByEmail(
    organizationId: string,
    email: string,
  ): Promise<OrganizationInvitation | null> {
    return (
      this.invitations.find(
        (invitation) =>
          invitation.organizationId === organizationId &&
          invitation.email === email.toLowerCase() &&
          invitation.status === 'pending',
      ) ?? null
    );
  }

  public async findInvitationByTokenHash(): Promise<OrganizationInvitation | null> {
    return this.invitations[0] ?? null;
  }

  public async findInvitationById(
    organizationId: string,
    invitationId: string,
  ): Promise<OrganizationInvitation | null> {
    return (
      this.invitations.find(
        (invitation) => invitation.organizationId === organizationId && invitation.id === invitationId,
      ) ?? null
    );
  }

  public async updateInvitation(
    invitationId: string,
    input: { status: OrganizationInvitation['status']; acceptedByUserId?: string | null; acceptedAt?: Date | null },
  ): Promise<OrganizationInvitation | null> {
    return this.updateStoredInvitation(invitationId, {
      status: input.status,
      acceptedByUserId: input.acceptedByUserId,
      acceptedAt: input.acceptedAt,
    });
  }

  public async updateInvitationToken(
    invitationId: string,
    input: { tokenHash: string; expiresAt: Date; role?: OrganizationMemberRole },
  ): Promise<OrganizationInvitation | null> {
    void input.tokenHash;
    return this.updateStoredInvitation(invitationId, {
      expiresAt: input.expiresAt,
      ...(input.role === undefined ? {} : { role: input.role }),
      status: 'pending',
    });
  }

  public async updateInvitationSendStatus(
    invitationId: string,
    input: {
      sendStatus: OrganizationInvitation['sendStatus'];
      errorCode?: string | null;
      errorMessage?: string | null;
      incrementResendCount?: boolean;
      sentAt?: Date | null;
      lastSentAt?: Date | null;
    },
  ): Promise<OrganizationInvitation | null> {
    const current = await this.findInvitationById('org-1', invitationId);
    return this.updateStoredInvitation(invitationId, {
      sendStatus: input.sendStatus,
      sendErrorCode: input.errorCode === undefined ? current?.sendErrorCode : input.errorCode,
      sendErrorMessage: input.errorMessage === undefined ? current?.sendErrorMessage : input.errorMessage,
      sentAt: input.sentAt === undefined ? current?.sentAt : input.sentAt,
      lastSentAt: input.lastSentAt === undefined ? current?.lastSentAt : input.lastSentAt,
      resendCount: (current?.resendCount ?? 0) + (input.incrementResendCount === true ? 1 : 0),
    });
  }

  public async revokeInvitation(
    invitationId: string,
    input: { revokedByUserId: string; revokedAt: Date },
  ): Promise<OrganizationInvitation | null> {
    return this.updateStoredInvitation(invitationId, {
      status: 'revoked',
      revokedByUserId: input.revokedByUserId,
      revokedAt: input.revokedAt,
    });
  }

  public async insertEmailDeliveryLog(input: unknown): Promise<unknown> {
    this.emailDeliveryLogs.push(input);
    return input;
  }

  public async getCreditBalance(): Promise<OrganizationCreditBalance> {
    return this.balance;
  }

  public async getCreditBalanceForUpdate(): Promise<OrganizationCreditBalance> {
    return this.balance;
  }

  public async createCreditBalance(organizationId: string): Promise<OrganizationCreditBalance> {
    this.balance = buildBalance({ organizationId });
    return this.balance;
  }

  public async updateCreditBalance(balance: OrganizationCreditBalance): Promise<OrganizationCreditBalance> {
    this.balance = { ...balance };
    return this.balance;
  }

  public async listAuditLogs(organizationId: string, limit: number): Promise<OrganizationAuditLog[]> {
    this.usedFullAuditLogAccess = true;
    return this.auditLogs.filter((log) => log.organizationId === organizationId).slice(0, limit);
  }

  public async listAuditLogsByActionPrefixes(
    organizationId: string,
    actionPrefixes: readonly string[],
    limit: number,
  ): Promise<OrganizationAuditLog[]> {
    this.prefixRequests.push([...actionPrefixes]);
    return this.auditLogs
      .filter(
        (log) =>
          log.organizationId === organizationId &&
          actionPrefixes.some((actionPrefix) => log.action.startsWith(actionPrefix)),
      )
      .slice(0, limit);
  }

  public async insertAuditLog(input: AuditLogInput): Promise<void> {
    this.insertedAuditLogs.push(input);
  }

  public async insertUsageEvent(input: UsageEventInput): Promise<void> {
    this.insertedUsageEvents.push(input);
  }

  private updateStoredInvitation(
    invitationId: string,
    patch: Partial<OrganizationInvitation>,
  ): OrganizationInvitation | null {
    const index = this.invitations.findIndex((invitation) => invitation.id === invitationId);
    if (index < 0) {
      return null;
    }
    const updated = {
      ...this.invitations[index],
      ...patch,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    this.invitations[index] = updated;
    return updated;
  }
}

function memberKey(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}

function buildMember(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  return {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    email: 'user@example.com',
    displayName: null,
    role: 'owner',
    status: 'active',
    invitedByUserId: null,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    type: 'business',
    name: 'Lyra Studio',
    legalName: 'Lyra Studio Inc.',
    status: 'active',
    planKey: 'enterprise_a',
    billingEmail: 'billing@example.com',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildBalance(overrides: Partial<OrganizationCreditBalance> = {}): OrganizationCreditBalance {
  return {
    organizationId: 'org-1',
    monthlyCredits: 0,
    purchasedCredits: 0,
    monthlyExpiresAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildInvitation(overrides: Partial<OrganizationInvitation> = {}): OrganizationInvitation {
  return {
    id: 'invitation-1',
    organizationId: 'org-1',
    email: 'invited@example.com',
    role: 'editor',
    status: 'pending',
    sendStatus: 'not_sent',
    sendErrorCode: null,
    sendErrorMessage: null,
    sentAt: null,
    lastSentAt: null,
    resendCount: 0,
    invitedByUserId: 'user-1',
    acceptedByUserId: null,
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    revokedByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildAuditLog(action: string): OrganizationAuditLog {
  return {
    id: `audit-${action}`,
    organizationId: 'org-1',
    actorUserId: 'owner-user',
    action,
    targetType: 'organization',
    targetId: 'org-1',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
