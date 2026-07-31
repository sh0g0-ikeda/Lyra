import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import type { Env } from '../../lib/env.js';
import { PostgresCreditRepository } from '../../repositories/CreditRepository.js';
import { PostgresStorePurchaseRepository } from '../../repositories/StorePurchaseRepository.js';
import { MobileStorePurchaseService } from '../../services/billing/MobileStorePurchaseService.js';
import { AppStoreServerClient } from '../apple/AppStoreServerClient.js';
import { GooglePlayDeveloperClient } from '../google/GooglePlayDeveloperClient.js';
import { GooglePubSubPushVerifier } from '../google/GooglePubSubPushVerifier.js';
import { createMobileStoreBillingConfig } from './MobileStoreBillingConfig.js';

export interface MobileStoreBillingIntegration {
  mobileStorePurchaseService: MobileStorePurchaseService;
  googlePubSubPushVerifier: GooglePubSubPushVerifier;
}

export function createMobileStoreBillingIntegration(
  env: Env,
  database: DatabaseClient & TransactionRunner,
  isProduction: boolean,
): MobileStoreBillingIntegration | null {
  const config = createMobileStoreBillingConfig(env, isProduction);
  if (config === null) {
    return null;
  }

  const storePurchaseRepository = new PostgresStorePurchaseRepository(
    database,
    database,
  );
  const creditRepository = new PostgresCreditRepository(database, database);
  const appleVerifier = new AppStoreServerClient(config.apple);
  const googleVerifier = GooglePlayDeveloperClient.fromServiceAccount({
    packageName: config.google.packageName,
    serviceAccountJsonBase64: config.google.serviceAccountJsonBase64,
    timeoutMs: config.google.timeoutMs,
  });

  return {
    mobileStorePurchaseService: new MobileStorePurchaseService({
      storePurchaseRepository,
      creditRepository,
      productCatalog: config.productCatalog,
      appleVerifier,
      googleVerifier,
      identifierSecret: config.identifierSecret,
      allowAppleSandbox: config.apple.allowSandbox,
      allowGoogleTestPurchases: config.google.allowTestPurchases,
      googlePackageName: config.google.packageName,
    }),
    googlePubSubPushVerifier: new GooglePubSubPushVerifier({
      audience: config.google.pubSubAudience,
      serviceAccountEmail: config.google.pubSubServiceAccountEmail,
    }),
  };
}
