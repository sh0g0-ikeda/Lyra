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
    if (user.planCode !== 'free') {
      throw new ConflictError('Paid plans must be managed through the customer portal');
    }

    const billingUser = await this.requireBillingUser(user.id);
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
    config.successUrl.length === 0 ||
    config.cancelUrl.length === 0 ||
    config.portalReturnUrl.length === 0 ||
    Object.values(config.subscriptionPriceIds).some((value) => value.length === 0) ||
    Object.values(config.creditPackagePriceIds).some((value) => value.length === 0)
  ) {
    throw new ConfigurationError('Stripe billing configuration is incomplete');
  }

  return config;
}

export function getPurchasedCreditsForPackage(packageCode: CreditPackageCode): number {
  return CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits;
}
