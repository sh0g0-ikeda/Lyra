import type { EmailDeliveryPort } from '../email/EmailDeliveryPort.js';
import type { Organization, OrganizationInvitation } from '../../domain/types/organization.js';
import { sanitizeExternalErrorMessage } from '../../lib/errorSanitizer.js';
import type { OrganizationRepository } from '../../repositories/OrganizationRepository.js';

export type InvitationEmailDeliveryStatus = 'disabled' | 'sent' | 'failed';

export interface InvitationEmailDeliveryResult {
  status: InvitationEmailDeliveryStatus;
  errorMessage?: string;
}

export interface OrganizationInvitationEmailServicePort {
  deliverInvitation(input: {
    organization: Organization;
    invitation: OrganizationInvitation;
    invitationUrl: string;
  }): Promise<InvitationEmailDeliveryResult>;
}

export class OrganizationInvitationEmailService implements OrganizationInvitationEmailServicePort {
  public constructor(
    private readonly repository: OrganizationRepository,
    private readonly emailDelivery: EmailDeliveryPort,
    private readonly enabled: boolean,
  ) {}

  public async deliverInvitation(input: {
    organization: Organization;
    invitation: OrganizationInvitation;
    invitationUrl: string;
  }): Promise<InvitationEmailDeliveryResult> {
    if (!this.enabled) {
      return { status: 'disabled' };
    }

    await this.repository.updateInvitationSendStatus(input.invitation.id, {
      sendStatus: 'sending',
      errorCode: null,
      errorMessage: null,
      lastSentAt: new Date(),
    });

    try {
      const result = await this.emailDelivery.send({
        to: input.invitation.email,
        subject: `Lyraワークスペースへの招待 / Invitation to ${input.organization.name}`,
        textBody: buildInvitationTextBody(input.organization, input.invitation, input.invitationUrl),
        htmlBody: buildInvitationHtmlBody(input.organization, input.invitation, input.invitationUrl),
        tags: {
          template: 'organization_invitation',
          organizationId: input.organization.id,
          invitationId: input.invitation.id,
        },
      });

      if (result.provider === 'disabled') {
        await this.repository.updateInvitationSendStatus(input.invitation.id, {
          sendStatus: 'not_sent',
          errorCode: null,
          errorMessage: null,
          lastSentAt: new Date(),
        });
        await this.repository.insertEmailDeliveryLog({
          organizationId: input.organization.id,
          invitationId: input.invitation.id,
          recipientEmail: input.invitation.email,
          templateKey: 'organization_invitation',
          provider: result.provider,
          status: 'disabled',
          providerMessageId: result.messageId,
        });
        return { status: 'disabled' };
      }

      const sentAt = new Date();
      await this.repository.updateInvitationSendStatus(input.invitation.id, {
        sendStatus: 'sent',
        errorCode: null,
        errorMessage: null,
        sentAt,
        lastSentAt: sentAt,
      });
      await this.repository.insertEmailDeliveryLog({
        organizationId: input.organization.id,
        invitationId: input.invitation.id,
        recipientEmail: input.invitation.email,
        templateKey: 'organization_invitation',
        provider: result.provider,
        status: 'sent',
        providerMessageId: result.messageId,
      });
      await this.repository.insertAuditLog({
        organizationId: input.organization.id,
        actorUserId: input.invitation.invitedByUserId,
        action: 'member.invitation_email_sent',
        targetType: 'invitation',
        targetId: input.invitation.id,
        metadata: {
          email: input.invitation.email,
          provider: result.provider,
        },
      });
      return { status: 'sent' };
    } catch (error) {
      const rawErrorMessage = error instanceof Error ? error.message : 'Invitation email delivery failed';
      const errorMessage = sanitizeExternalErrorMessage(rawErrorMessage);
      await this.repository.updateInvitationSendStatus(input.invitation.id, {
        sendStatus: 'failed',
        errorCode: error instanceof Error ? error.name : 'EmailDeliveryError',
        errorMessage,
        lastSentAt: new Date(),
      });
      await this.repository.insertEmailDeliveryLog({
        organizationId: input.organization.id,
        invitationId: input.invitation.id,
        recipientEmail: input.invitation.email,
        templateKey: 'organization_invitation',
        provider: 'ses',
        status: 'failed',
        errorCode: error instanceof Error ? error.name : 'EmailDeliveryError',
        errorMessage,
      });
      await this.repository.insertAuditLog({
        organizationId: input.organization.id,
        actorUserId: input.invitation.invitedByUserId,
        action: 'member.invitation_email_failed',
        targetType: 'invitation',
        targetId: input.invitation.id,
        metadata: {
          email: input.invitation.email,
          reason: errorMessage,
        },
      });
      return { status: 'failed', errorMessage };
    }
  }
}

function buildInvitationTextBody(
  organization: Organization,
  invitation: OrganizationInvitation,
  invitationUrl: string,
): string {
  return [
    'Lyraワークスペースへの招待',
    '',
    `${organization.name} からLyraワークスペースへ招待されています。`,
    '',
    `権限: ${invitation.role}`,
    `有効期限: ${invitation.expiresAt.toISOString()}`,
    '',
    '参加するには、以下のリンクを開いてください。',
    invitationUrl,
    '',
    'この招待に心当たりがない場合は、このメールを無視してください。',
    '',
    '---',
    '',
    `${organization.name} has invited you to Lyra.`,
    `Role: ${invitation.role}`,
    `Invitation expires: ${invitation.expiresAt.toISOString()}`,
    '',
    'Open this link to join:',
    invitationUrl,
    '',
    'If you did not expect this invitation, you can ignore this email.',
  ].join('\n');
}

function buildInvitationHtmlBody(
  organization: Organization,
  invitation: OrganizationInvitation,
  invitationUrl: string,
): string {
  const safeOrganizationName = escapeHtml(organization.name);
  const safeRole = escapeHtml(invitation.role);
  const safeInvitationUrl = escapeHtml(invitationUrl);
  const safeExpiresAt = escapeHtml(invitation.expiresAt.toISOString());
  return [
    '<!doctype html>',
    '<html><body>',
    '<h1>Lyraワークスペースへの招待</h1>',
    `<p><strong>${safeOrganizationName}</strong> からLyraワークスペースへ招待されています。</p>`,
    `<p>権限: ${safeRole}</p>`,
    `<p>有効期限: ${safeExpiresAt}</p>`,
    `<p><a href="${safeInvitationUrl}">Lyraワークスペースに参加する</a></p>`,
    '<p>この招待に心当たりがない場合は、このメールを無視してください。</p>',
    '<hr>',
    `<p><strong>${safeOrganizationName}</strong> has invited you to Lyra.</p>`,
    `<p>Role: ${safeRole}</p>`,
    `<p>Invitation expires: ${safeExpiresAt}</p>`,
    `<p><a href="${safeInvitationUrl}">Join Lyra workspace</a></p>`,
    '<p>If you did not expect this invitation, you can ignore this email.</p>',
    '</body></html>',
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
