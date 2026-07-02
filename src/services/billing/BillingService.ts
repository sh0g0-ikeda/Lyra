import type { ConsumerPaidPlanCode, CreditPackageCode, PaidPlanCode } from '../../domain/constants/billing.js';
import {
  CREDIT_PACKAGE_DEFINITIONS,
  ENTERPRISE_PLAN_DEFINITIONS,
  getBillingPlanRank,
  isEnterprisePlanCode,
  PAID_PLAN_CODES,
  SUBSCRIPTION_PLAN_DEFINITIONS,
} from '../../domain/constants/billing.js';
import { ConflictError, ConfigurationError, NotFoundError } from '../../domain/errors/index.js';
import type {
  BillingUserProfile,
  CreditCheckoutResult,
  CustomerPortalResult,
  SubscriptionCheckoutResult,
  SubscriptionPlanCatalogEntry,
} from '../../domain/types/billing.js';
import type { AuthenticatedUser } from '../../domain/types/user.js';
import type { StripeBillingClientPort } from '../../infrastructure/stripe/StripeBillingClient.js';
import type { BillingRepository } from '../../repositories/BillingRepository.js';

export interface BillingServiceConfig {
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
  subscriptionPriceIds: Record<PaidPlanCode, string | undefined>;
  creditPackagePriceIds: Record<CreditPackageCode, string>;
}

export interface BillingServicePort {
  createSubscriptionCheckoutSession(
    user: AuthenticatedUser,
    planCode: PaidPlanCode,
  ): Promise<SubscriptionCheckoutResult>;
  createCreditCheckoutSession(user: AuthenticatedUser, packageCode: CreditPackageCode): Promise<CreditCheckoutResult>;
  createCustomerPortalSession(userId: string): Promise<CustomerPortalResult>;
  getSubscriptionPlanCatalog(): SubscriptionPlanCatalogEntry[];
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
    if (isEnterprisePlanCode(planCode)) {
      throw new ConflictError('Enterprise subscriptions must be managed from an organization workspace');
    }

    const billingUser = await this.requireBillingUser(user.id);
    if (billingUser.planCode === planCode) {
      throw new ConflictError('Requested plan is already active');
    }

    const priceId = this.requireSubscriptionPriceId(planCode);
    if (billingUser.planCode !== 'free') {
      return this.createPaidPlanChangeSession(billingUser, planCode, priceId);
    }

    const customerId = await this.ensureStripeCustomer(billingUser);
    const session = await this.stripeClient.createCheckoutSession({
      customerId,
      priceId,
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
    priceId: string,
  ): Promise<SubscriptionCheckoutResult> {
    if (getBillingPlanRank(planCode) <= getBillingPlanRank(billingUser.planCode)) {
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
      priceId,
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

  public getSubscriptionPlanCatalog(): SubscriptionPlanCatalogEntry[] {
    return PAID_PLAN_CODES.filter((planCode) => !isEnterprisePlanCode(planCode)).map((planCode) => ({
      planCode,
      displayNameJa: displayNameJaForPlan(planCode),
      displayNameEn: displayNameEnForPlan(planCode),
      monthlyCredits: getMonthlyCreditsForPlan(planCode),
      amountJpy: getAmountJpyForPlan(planCode),
      minimumContractMonths: minimumContractMonthsForPlan(planCode),
      trialDays: trialDaysForPlan(planCode),
      isEnterprise: false,
      configured: !isBlank(this.config.subscriptionPriceIds[planCode] ?? ''),
    }));
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

  private requireSubscriptionPriceId(planCode: PaidPlanCode): string {
    const priceId = this.config.subscriptionPriceIds[planCode]?.trim();
    if (priceId === undefined || isBlank(priceId)) {
      throw new ConfigurationError(`Subscription plan is not available for checkout yet: ${planCode}`);
    }

    return priceId;
  }
}

export function assertBillingConfig(config: BillingServiceConfig): BillingServiceConfig {
  const requiredConsumerPriceIds: Record<ConsumerPaidPlanCode, string | undefined> = {
    standard: config.subscriptionPriceIds.standard,
    premium: config.subscriptionPriceIds.premium,
  };

  if (
    isBlank(config.successUrl) ||
    isBlank(config.cancelUrl) ||
    isBlank(config.portalReturnUrl) ||
    Object.values(requiredConsumerPriceIds).some((value) => isBlank(value ?? '')) ||
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

function getMonthlyCreditsForPlan(planCode: PaidPlanCode): number {
  if (isEnterprisePlanCode(planCode)) {
    return ENTERPRISE_PLAN_DEFINITIONS[planCode].monthlyCredits;
  }

  return SUBSCRIPTION_PLAN_DEFINITIONS[planCode].monthlyCredits;
}

function getAmountJpyForPlan(planCode: PaidPlanCode): number {
  if (isEnterprisePlanCode(planCode)) {
    return ENTERPRISE_PLAN_DEFINITIONS[planCode].amountJpy;
  }

  return SUBSCRIPTION_PLAN_DEFINITIONS[planCode].amountJpy;
}

function minimumContractMonthsForPlan(planCode: PaidPlanCode): number {
  if (isEnterprisePlanCode(planCode)) {
    return ENTERPRISE_PLAN_DEFINITIONS[planCode].minimumContractMonths;
  }

  return 1;
}

function trialDaysForPlan(planCode: PaidPlanCode): number {
  if (isEnterprisePlanCode(planCode)) {
    return ENTERPRISE_PLAN_DEFINITIONS[planCode].trialDays;
  }

  return 0;
}

function displayNameJaForPlan(planCode: PaidPlanCode): string {
  switch (planCode) {
    case 'standard':
      return '\u30b9\u30bf\u30f3\u30c0\u30fc\u30c9';
    case 'premium':
      return '\u30d7\u30ec\u30df\u30a2\u30e0';
    case 'enterprise_a':
    case 'enterprise_b':
    case 'enterprise_c':
      return ENTERPRISE_PLAN_DEFINITIONS[planCode].displayNameJa;
  }
}

function displayNameEnForPlan(planCode: PaidPlanCode): string {
  switch (planCode) {
    case 'standard':
      return 'Standard';
    case 'premium':
      return 'Premium';
    case 'enterprise_a':
      return 'Enterprise Plan A';
    case 'enterprise_b':
      return 'Enterprise Plan B';
    case 'enterprise_c':
      return 'Enterprise Plan C';
  }
}

function getStripeSubscriptionCustomerId(customer: string | { id?: string } | null): string | null {
  if (typeof customer === 'string') {
    return customer;
  }

  return typeof customer?.id === 'string' ? customer.id : null;
}
