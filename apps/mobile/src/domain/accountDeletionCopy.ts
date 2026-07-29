import type { AccountDeletionResultRecord } from '@/domain/types';
import { t } from '@/lib/i18n';

interface SubscriptionDeletionAcknowledgementInput {
  activeStripeSubscriptionCount: number;
  activeMobileStoreSubscriptionCount: number;
  language: 'ja' | 'en';
}

export function subscriptionDeletionAcknowledgement({
  activeStripeSubscriptionCount,
  activeMobileStoreSubscriptionCount,
  language
}: SubscriptionDeletionAcknowledgementInput): string {
  if (activeMobileStoreSubscriptionCount === 0) {
    return t(language, 'screen.account.acknowledgeSubscriptionCancellation', {
      subscriptionCount: activeStripeSubscriptionCount
    });
  }
  if (activeStripeSubscriptionCount === 0) {
    return t(language, 'screen.account.acknowledgeMobileSubscriptionCancellation', {
      mobileCount: activeMobileStoreSubscriptionCount
    });
  }
  return t(language, 'screen.account.acknowledgeMixedSubscriptionCancellation', {
    mobileCount: activeMobileStoreSubscriptionCount,
    stripeCount: activeStripeSubscriptionCount
  });
}

export function deletionResultMessage(
  result: AccountDeletionResultRecord,
  language: 'ja' | 'en'
): string {
  switch (result.status) {
    case 'blocked': {
      const ownerBlocker = result.blockers.find(
        (blocker) => blocker.code === 'UNIQUE_ORGANIZATION_OWNER'
      );
      if (ownerBlocker?.code === 'UNIQUE_ORGANIZATION_OWNER') {
        const names = ownerBlocker.organizations
          .map((organization) => organization.name)
          .join(language === 'ja' ? '、' : ', ');
        return t(language, 'shared.accountDeletion.uniqueOwner', { names });
      }
      return t(language, 'shared.accountDeletion.blocked');
    }
    case 'in_progress':
      return t(language, 'shared.accountDeletion.inProgress');
    case 'pending_external_action':
      return t(language, 'shared.accountDeletion.pendingExternalAction');
    case 'completed':
      return t(language, 'shared.accountDeletion.completed');
  }
}
