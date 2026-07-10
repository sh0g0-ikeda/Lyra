import { describe, expect, it } from 'vitest';
import type { EmailDeliveryPort, SendEmailInput, SendEmailResult } from '../../../../src/services/email/EmailDeliveryPort.js';
import {
  OrganizationInvitationEmailService,
} from '../../../../src/services/organization/OrganizationInvitationEmailService.js';
import type {
  Organization,
  OrganizationInvitation,
} from '../../../../src/domain/types/organization.js';

describe('OrganizationInvitationEmailService', () => {
  it('メール送信が無効な場合は招待状態を変更しない', async () => {
    const repository = new FakeInvitationRepository();
    const emailDelivery = new FakeEmailDelivery({ provider: 'disabled', messageId: null });
    const service = new OrganizationInvitationEmailService(
      repository as never,
      emailDelivery,
      false,
    );

    const result = await service.deliverInvitation({
      organization: buildOrganization(),
      invitation: buildInvitation(),
      invitationUrl: 'https://app.lyra-editor.com/invite/token',
    });

    expect(result).toEqual({ status: 'disabled' });
    expect(emailDelivery.sentInputs).toHaveLength(0);
    expect(repository.sendStatusUpdates).toHaveLength(0);
    expect(repository.emailDeliveryLogs).toHaveLength(0);
  });

  it('送信プロバイダーが無効な場合は送信中から未送信に戻す', async () => {
    const repository = new FakeInvitationRepository();
    const emailDelivery = new FakeEmailDelivery({ provider: 'disabled', messageId: null });
    const service = new OrganizationInvitationEmailService(
      repository as never,
      emailDelivery,
      true,
    );

    const result = await service.deliverInvitation({
      organization: buildOrganization(),
      invitation: buildInvitation(),
      invitationUrl: 'https://app.lyra-editor.com/invite/token',
    });

    expect(result).toEqual({ status: 'disabled' });
    expect(repository.sendStatusUpdates.map((update) => update.sendStatus)).toEqual(['sending', 'not_sent']);
    expect(repository.emailDeliveryLogs[0]).toMatchObject({
      provider: 'disabled',
      status: 'disabled',
    });
  });

  it('SES送信が成功した場合は送信済み状態と監査ログを残す', async () => {
    const repository = new FakeInvitationRepository();
    const emailDelivery = new FakeEmailDelivery({ provider: 'ses', messageId: 'ses-message-1' });
    const service = new OrganizationInvitationEmailService(
      repository as never,
      emailDelivery,
      true,
    );

    const result = await service.deliverInvitation({
      organization: buildOrganization({ name: 'Studio Alpha' }),
      invitation: buildInvitation({ email: 'member@example.com' }),
      invitationUrl: 'https://app.lyra-editor.com/invite/token',
    });

    expect(result).toEqual({ status: 'sent' });
    expect(emailDelivery.sentInputs[0]).toMatchObject({
      to: 'member@example.com',
      subject: 'Lyraワークスペースへの招待 / Invitation to Studio Alpha',
      tags: {
        template: 'organization_invitation',
        organizationId: 'org-1',
        invitationId: 'invitation-1',
      },
    });
    expect(emailDelivery.sentInputs[0]?.textBody).toContain('Lyraワークスペースへの招待');
    expect(emailDelivery.sentInputs[0]?.textBody).toContain('Studio Alpha has invited you to Lyra.');
    expect(repository.sendStatusUpdates.map((update) => update.sendStatus)).toEqual(['sending', 'sent']);
    expect(repository.emailDeliveryLogs[0]).toMatchObject({
      provider: 'ses',
      status: 'sent',
      providerMessageId: 'ses-message-1',
    });
    expect(repository.auditLogs[0]).toMatchObject({
      action: 'member.invitation_email_sent',
      targetId: 'invitation-1',
    });
  });

  it('SES送信が失敗した場合は失敗状態と理由を残す', async () => {
    const repository = new FakeInvitationRepository();
    const emailDelivery = new FakeEmailDelivery(new Error('SES rejected recipient'));
    const service = new OrganizationInvitationEmailService(
      repository as never,
      emailDelivery,
      true,
    );

    const result = await service.deliverInvitation({
      organization: buildOrganization(),
      invitation: buildInvitation(),
      invitationUrl: 'https://app.lyra-editor.com/invite/token',
    });

    expect(result).toEqual({ status: 'failed', errorMessage: 'SES rejected recipient' });
    expect(repository.sendStatusUpdates.map((update) => update.sendStatus)).toEqual(['sending', 'failed']);
    expect(repository.emailDeliveryLogs[0]).toMatchObject({
      provider: 'ses',
      status: 'failed',
      errorMessage: 'SES rejected recipient',
    });
    expect(repository.auditLogs[0]).toMatchObject({
      action: 'member.invitation_email_failed',
      targetId: 'invitation-1',
    });
  });
});

class FakeEmailDelivery implements EmailDeliveryPort {
  public readonly sentInputs: SendEmailInput[] = [];

  public constructor(private readonly result: SendEmailResult | Error) {}

  public async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sentInputs.push(input);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

class FakeInvitationRepository {
  public readonly sendStatusUpdates: Array<{
    sendStatus: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    sentAt?: Date | null;
    lastSentAt?: Date | null;
  }> = [];
  public readonly emailDeliveryLogs: unknown[] = [];
  public readonly auditLogs: unknown[] = [];

  public async updateInvitationSendStatus(
    _invitationId: string,
    input: {
      sendStatus: string;
      errorCode?: string | null;
      errorMessage?: string | null;
      sentAt?: Date | null;
      lastSentAt?: Date | null;
    },
  ): Promise<OrganizationInvitation> {
    this.sendStatusUpdates.push(input);
    return buildInvitation({ sendStatus: input.sendStatus as OrganizationInvitation['sendStatus'] });
  }

  public async insertEmailDeliveryLog(input: unknown): Promise<unknown> {
    this.emailDeliveryLogs.push(input);
    return input;
  }

  public async insertAuditLog(input: unknown): Promise<void> {
    this.auditLogs.push(input);
  }
}

function buildOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    type: 'business',
    name: 'Lyra Studio',
    legalName: null,
    status: 'active',
    planKey: 'enterprise_a',
    billingEmail: 'billing@example.com',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdByUserId: 'owner-user',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildInvitation(overrides: Partial<OrganizationInvitation> = {}): OrganizationInvitation {
  return {
    id: 'invitation-1',
    organizationId: 'org-1',
    email: 'member@example.com',
    role: 'editor',
    status: 'pending',
    sendStatus: 'not_sent',
    sendErrorCode: null,
    sendErrorMessage: null,
    sentAt: null,
    lastSentAt: null,
    resendCount: 0,
    invitedByUserId: 'owner-user',
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
