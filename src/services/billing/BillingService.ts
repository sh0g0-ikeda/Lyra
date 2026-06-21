import type { CreditPackageCode, PaidPlanCode } from '../../domain/constants/billing.js';
import { CREDIT_PACKAGE_DEFINITIONS } from '../../domain/constants/billing.js';
import { ConflictError, ConfigurationError, NotFoundError } from '../../domain/errors/index.js';
import type {
  BillingUserProfile,
  CreditCheckoutResult,
  CustomerPortalResult,
  SubscriptionCheckoutResult,
} from '../../domain/types/billing.js';
import type { AuthenticatedUser } from '../../domain/types/user.js';
import type { StripeBillingClientPort } from '../../infrastructure/stripe/StripeBillingClient.js';
import type { BillingRepository } from '../../repositories/BillingRepository.js';

export interface BillingServiceConfig {
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
  subscriptionPriceIds: Record<PaidPlanCode, string>;
  creditPackagePriceIds: Record<CreditPackageCode, string>;
}

export interface BillingServicePort {
  createSubscriptionCheckoutSession(
    user: AuthenticatedUser,
    planCode: PaidPlanCode,
  ): Promise<SubscriptionCheckoutResult>;
  createCreditCheckoutSession(user: AuthenticatedUser, packageCode: CreditPackageCode): Promise<CreditCheckoutResult>;
  createCustomerPortalSession(userId: string): Promise<CustomerPortalResult>;
}

export class BillingService implements BillingServicePort {
  public constructor(
    private readonly billingRepository: BillingRepository,
    private readonly stripeClient: StripeBillingClientPort,
    private readonly config: BillingServiceConfig,
  ) {}

  public async createSubscriptionCheckoutSession(
    user: AuthenticatedUser,
    planCode: PaidPlanCode,
  ): Promise<SubscriptionCheckoutResult> {
    const billingUser = await this.requireBillingUser(user.id);
    if (billingUser.planCode === planCode) {
      throw new ConflictError('Requested plan is already active');
    }

    if (billingUser.planCode !== 'free') {
      return this.createPaidPlanChangeSession(billingUser, planCode);
    }

    const customerId = await this.ensureStripeCustomer(billingUser);
    const session = await this.stripeClient.createCheckoutSession({
      customerId,
      priceId: this.config.subscriptionPriceIds[planCode],
      mode: 'subscription',
      successUrl: this.config.successUrl,
      cancelUrl: this.config.cancelUrl,
      userId: user.id,
      planCode,
    });

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  private async createPaidPlanChangeSession(
    billingUser: BillingUserProfile,
    planCode: PaidPlanCode,
  ): Promise<SubscriptionCheckoutResult> {
    if (billingUser.planCode !== 'standard' || planCode !== 'premium') {
      throw new ConflictError('Paid plan downgrades must be managed through the customer portal');
    }

    if (billingUser.stripeCustomerId === null) {
      throw new ConflictError('Stripe customer is not registered yet');
    }

    const activeSubscription = await this.billingRepository.findLatestActiveSubscriptionForUser(billingUser.userId);
    if (activeSubscription === null) {
      throw new ConflictError('Active Stripe subscription was not found');
    }

    const stripeSubscription = await this.stripeClient.retrieveSubscription(activeSubscription.stripeSubscriptionId);
    const stripeCustomerId = getStripeSubscriptionCustomerId(stripeSubscription.customer);
    if (stripeCustomerId !== billingUser.stripeCustomerId) {
      throw new ConflictError('Active Stripe subscription does not match the billing user');
    }

    if (stripeSubscription.status !== 'active' && stripeSubscription.status !== 'trialing') {
      throw new ConflictError('Only active subscriptions can be changed automatically');
    }

    if (stripeSubscription.items.data.length !== 1) {
      throw new ConflictError('Subscriptions with multiple items must be managed through the customer portal');
    }

    const subscriptionItem = stripeSubscription.items.data[0];
    if (subscriptionItem === undefined) {
      throw new ConflictError('Stripe subscription item was not found');
    }

    const session = await this.stripeClient.createSubscriptionUpdatePortalSession({
      customerId: billingUser.stripeCustomerId,
      subscriptionId: stripeSubscription.id,
      subscriptionItemId: subscriptionItem.id,
      priceId: this.config.subscriptionPriceIds[planCode],
      quantity: subscriptionItem.quantity ?? 1,
      returnUrl: this.config.portalReturnUrl,
    });

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  public async createCreditCheckoutSession(
    user: AuthenticatedUser,
    packageCode: CreditPackageCode,
  ): Promise<CreditCheckoutResult> {
    const billingUser = await this.requireBillingUser(user.id);
    const customerId = await this.ensureStripeCustomer(billingUser);
    const session = await this.stripeClient.createCheckoutSession({
      customerId,
      priceId: this.config.creditPackagePriceIds[packageCode],
      mode: 'payment',
      successUrl: this.config.successUrl,
      cancelUrl: this.config.cancelUrl,
      userId: user.id,
      packageCode,
    });

    return {
      sessionId: session.id,
      url: session.url,
      packageCode,
    };
  }

  public async createCustomerPortalSession(userId: string): Promise<CustomerPortalResult> {
    const billingUser = await this.requireBillingUser(userId);
    if (billingUser.stripeCustomerId === null) {
      throw new ConflictError('Stripe customer is not registered yet');
    }

    const session = await this.stripeClient.createCustomerPortalSession({
      customerId: billingUser.stripeCustomerId,
      returnUrl: this.config.portalReturnUrl,
    });

    return {
      url: session.url,
    };
  }

  private async requireBillingUser(userId: string): Promise<BillingUserProfile> {
    const billingUser = await this.billingRepository.findBillingUserProfile(userId);
    if (billingUser === null) {
      throw new NotFoundError('User not found');
    }

    return billingUser;
  }

  private async ensureStripeCustomer(user: BillingUserProfile): Promise<string> {
    if (user.stripeCustomerId !== null) {
      return user.stripeCustomerId;
    }

    const customer = await this.stripeClient.createCustomer({
      userId: user.userId,
      email: user.email,
    });
    const persistedCustomerId = await this.billingRepository.setStripeCustomerId(user.userId, customer.id);

    if (persistedCustomerId === null) {
      throw new ConfigurationError('Failed to persist Stripe customer');
    }

    return persistedCustomerId;
  }
}

export function assertBillingConfig(config: BillingServiceConfig): BillingServiceConfig {
  if (
    isBlank(config.successUrl) ||
    isBlank(config.cancelUrl) ||
    isBlank(config.portalReturnUrl) ||
    Object.values(config.subscriptionPriceIds).some(isBlank) ||
    Object.values(config.creditPackagePriceIds).some(isBlank)
  ) {
    throw new ConfigurationError('Stripe billing configuration is incomplete');
  }

  return config;
}

export function getPurchasedCreditsForPackage(packageCode: CreditPackageCode): number {
  return CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function getStripeSubscriptionCustomerId(
  customer: string | { id?: string } | null,
): string | null {
  if (typeof customer === 'string') {
    return customer;
  }

  return typeof customer?.id === 'string' ? customer.id : null;
}
