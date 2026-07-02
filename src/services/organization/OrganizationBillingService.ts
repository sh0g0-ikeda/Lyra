import {
  ENTERPRISE_PLAN_DEFINITIONS,
  type CreditPackageCode,
  type EnterprisePlanCode,
  getBillingPlanRank,
} from '../../domain/constants/billing.js';
import { ConflictError, ConfigurationError, NotFoundError } from '../../domain/errors/index.js';
import type {
  CreditCheckoutResult,
  CustomerPortalResult,
  OrganizationSubscriptionSummary,
  PaymentRecord,
  SubscriptionCheckoutResult,
  SubscriptionPlanCatalogEntry,
} from '../../domain/types/billing.js';
import type { Organization } from '../../domain/types/organization.js';
import type { AuthenticatedUser } from '../../domain/types/user.js';
import type { StripeBillingClientPort } from '../../infrastructure/stripe/StripeBillingClient.js';
import type { BillingRepository } from '../../repositories/BillingRepository.js';
import type { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { OrganizationServicePort } from './OrganizationService.js';

export interface OrganizationBillingServiceConfig {
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
  subscriptionPriceIds: Record<EnterprisePlanCode, string | undefined>;
  creditPackagePriceIds: Record<CreditPackageCode, string>;
}

export interface OrganizationBillingServicePort {
  createSubscriptionCheckoutSession(
    user: AuthenticatedUser,
    organizationId: string,
    planCode: EnterprisePlanCode,
  ): Promise<SubscriptionCheckoutResult>;
  createCreditCheckoutSession(
    user: AuthenticatedUser,
    organizationId: string,
    packageCode: CreditPackageCode,
  ): Promise<CreditCheckoutResult>;
  createCustomerPortalSession(userId: string, organizationId: string): Promise<CustomerPortalResult>;
  getOrganizationSubscriptionSummary(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationSubscriptionSummary | null>;
  listOrganizationInvoices(userId: string, organizationId: string): Promise<PaymentRecord[]>;
  getEnterprisePlanCatalog(): SubscriptionPlanCatalogEntry[];
}

/**
 * OrganizationBillingService keeps enterprise Stripe sessions scoped to an
 * organization workspace. Personal billing remains handled by BillingService.
 */
export class OrganizationBillingService implements OrganizationBillingServicePort {
  public constructor(
    private readonly organizationService: OrganizationServicePort,
    private readonly organizationRepository: OrganizationRepository,
    private readonly billingRepository: BillingRepository,
    private readonly stripeClient: StripeBillingClientPort,
    private readonly config: OrganizationBillingServiceConfig,
  ) {}

  public async createSubscriptionCheckoutSession(
    user: AuthenticatedUser,
    organizationId: string,
    planCode: EnterprisePlanCode,
  ): Promise<SubscriptionCheckoutResult> {
    await this.organizationService.requireMembership(organizationId, user.id, 'manage_billing');
    const organization = await this.requireOrganization(organizationId);
    if (organization.planKey === planCode && organization.stripeSubscriptionId !== null) {
      throw new ConflictError('Requested organization plan is already active');
    }

    const priceId = this.requireSubscriptionPriceId(planCode);
    const customerId = await this.ensureStripeCustomer(user, organization);

    if (organization.stripeSubscriptionId !== null) {
      return this.createPaidOrganizationPlanChangeSession(organization, customerId, planCode, priceId);
    }

    const session = await this.stripeClient.createCheckoutSession({
      customerId,
      priceId,
      mode: 'subscription',
      successUrl: this.config.successUrl,
      cancelUrl: this.config.cancelUrl,
      userId: user.id,
      organizationId,
      planCode,
    });

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  public async createCreditCheckoutSession(
    user: AuthenticatedUser,
    organizationId: string,
    packageCode: CreditPackageCode,
  ): Promise<CreditCheckoutResult> {
    await this.organizationService.requireMembership(organizationId, user.id, 'manage_billing');
    const organization = await this.requireOrganization(organizationId);
    const customerId = await this.ensureStripeCustomer(user, organization);
    const session = await this.stripeClient.createCheckoutSession({
      customerId,
      priceId: this.config.creditPackagePriceIds[packageCode],
      mode: 'payment',
      successUrl: this.config.successUrl,
      cancelUrl: this.config.cancelUrl,
      userId: user.id,
      organizationId,
      packageCode,
    });

    return {
      sessionId: session.id,
      url: session.url,
      packageCode,
    };
  }

  public async createCustomerPortalSession(userId: string, organizationId: string): Promise<CustomerPortalResult> {
    await this.organizationService.requireMembership(organizationId, userId, 'manage_billing');
    const organization = await this.requireOrganization(organizationId);
    if (organization.stripeCustomerId === null) {
      throw new ConflictError('Stripe customer is not registered for this organization yet');
    }

    const session = await this.stripeClient.createCustomerPortalSession({
      customerId: organization.stripeCustomerId,
      returnUrl: this.config.portalReturnUrl,
    });
    await this.organizationRepository.insertAuditLog({
      organizationId,
      actorUserId: userId,
      action: 'billing.portal_opened',
      targetType: 'billing',
      targetId: null,
      metadata: { stripe_customer_id: organization.stripeCustomerId },
    });
    return { url: session.url };
  }

  public async getOrganizationSubscriptionSummary(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationSubscriptionSummary | null> {
    await this.organizationService.requireMembership(organizationId, userId, 'view_billing');
    return this.billingRepository.findLatestSubscriptionForOrganization(organizationId);
  }

  public async listOrganizationInvoices(userId: string, organizationId: string): Promise<PaymentRecord[]> {
    await this.organizationService.requireMembership(organizationId, userId, 'view_billing');
    return this.billingRepository.listPaymentRecordsByOrganizationId(organizationId, 100);
  }

  public getEnterprisePlanCatalog(): SubscriptionPlanCatalogEntry[] {
    return (Object.keys(ENTERPRISE_PLAN_DEFINITIONS) as EnterprisePlanCode[]).map((planCode) => {
      const plan = ENTERPRISE_PLAN_DEFINITIONS[planCode];
      return {
        planCode,
        displayNameJa: plan.displayNameJa,
        displayNameEn: displayNameEnForEnterprisePlan(planCode),
        monthlyCredits: plan.monthlyCredits,
        amountJpy: plan.amountJpy,
        minimumContractMonths: plan.minimumContractMonths,
        trialDays: plan.trialDays,
        isEnterprise: true,
        configured: !isBlank(this.config.subscriptionPriceIds[planCode] ?? ''),
      };
    });
  }

  private async createPaidOrganizationPlanChangeSession(
    organization: Organization,
    customerId: string,
    planCode: EnterprisePlanCode,
    priceId: string,
  ): Promise<SubscriptionCheckoutResult> {
    if (getBillingPlanRank(planCode) <= getBillingPlanRank(organization.planKey)) {
      throw new ConflictError('Organization plan downgrades must be managed through the customer portal');
    }

    if (organization.stripeSubscriptionId === null) {
      throw new ConflictError('Active Stripe subscription was not found for this organization');
    }

    const stripeSubscription = await this.stripeClient.retrieveSubscription(organization.stripeSubscriptionId);
    const stripeCustomerId = getStripeSubscriptionCustomerId(stripeSubscription.customer);
    if (stripeCustomerId !== customerId) {
      throw new ConflictError('Active Stripe subscription does not match the organization');
    }

    if (stripeSubscription.status !== 'active' && stripeSubscription.status !== 'trialing') {
      throw new ConflictError('Only active organization subscriptions can be changed automatically');
    }

    if (stripeSubscription.items.data.length !== 1) {
      throw new ConflictError('Subscriptions with multiple items must be managed through the customer portal');
    }

    const subscriptionItem = stripeSubscription.items.data[0];
    if (subscriptionItem === undefined) {
      throw new ConflictError('Stripe subscription item was not found');
    }

    const session = await this.stripeClient.createSubscriptionUpdatePortalSession({
      customerId,
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

  private async requireOrganization(organizationId: string): Promise<Organization> {
    const organization = await this.organizationRepository.findOrganizationById(organizationId);
    if (organization === null) {
      throw new NotFoundError('Organization not found');
    }
    return organization;
  }

  private async ensureStripeCustomer(user: AuthenticatedUser, organization: Organization): Promise<string> {
    if (organization.stripeCustomerId !== null) {
      return organization.stripeCustomerId;
    }

    const customer = await this.stripeClient.createCustomer({
      userId: user.id,
      organizationId: organization.id,
      email: organization.billingEmail ?? user.email,
      name: organization.legalName ?? organization.name,
    });
    const updated = await this.organizationRepository.updateOrganization(organization.id, {
      stripeCustomerId: customer.id,
    });
    if (updated === null || updated.stripeCustomerId !== customer.id) {
      throw new ConfigurationError('Failed to persist organization Stripe customer');
    }

    return customer.id;
  }

  private requireSubscriptionPriceId(planCode: EnterprisePlanCode): string {
    const priceId = this.config.subscriptionPriceIds[planCode]?.trim();
    if (priceId === undefined || isBlank(priceId)) {
      throw new ConfigurationError(`Enterprise subscription plan is not available for checkout yet: ${planCode}`);
    }
    return priceId;
  }
}

export function assertOrganizationBillingConfig(
  config: OrganizationBillingServiceConfig,
): OrganizationBillingServiceConfig {
  if (
    isBlank(config.successUrl) ||
    isBlank(config.cancelUrl) ||
    isBlank(config.portalReturnUrl) ||
    Object.values(config.creditPackagePriceIds).some(isBlank)
  ) {
    throw new ConfigurationError('Organization Stripe billing configuration is incomplete');
  }
  return config;
}

function displayNameEnForEnterprisePlan(planCode: EnterprisePlanCode): string {
  switch (planCode) {
    case 'enterprise_a':
      return 'Enterprise Plan A';
    case 'enterprise_b':
      return 'Enterprise Plan B';
    case 'enterprise_c':
      return 'Enterprise Plan C';
  }
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function getStripeSubscriptionCustomerId(customer: string | { id?: string } | null): string | null {
  if (typeof customer === 'string') {
    return customer;
  }

  return typeof customer?.id === 'string' ? customer.id : null;
}
