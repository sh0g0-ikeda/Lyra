import type { SupabaseJwtClaims } from '../../domain/types/user.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { PostgresUserRepository } from '../../repositories/UserRepository.js';
import { PostgresCreditRepository } from '../../repositories/CreditRepository.js';
import { PostgresAccountDeletionRepository } from '../../repositories/AccountDeletionRepository.js';
import { bindTransaction } from '../../repositories/TransactionBoundDatabase.js';
import { CreditService } from '../credit/CreditService.js';
import { AccountDeletionIdentityGuard } from '../account/AccountDeletionIdentityGuard.js';
import { UserProvisioningService, type ProvisionedUser, type UserProvisioningPort } from './UserProvisioningService.js';

/** Account creation and its single signup grant share the actual API transaction. */
export class TransactionalUserProvisioningService implements UserProvisioningPort {
  public constructor(
    private readonly database: DatabaseClient & TransactionRunner,
    private readonly identityHashSecret?: string,
  ) {}

  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    return this.database.transaction(async (client) => {
      const transaction = bindTransaction(client);
      const guard = this.identityHashSecret === undefined ? undefined
        : new AccountDeletionIdentityGuard(
          new PostgresAccountDeletionRepository(transaction, transaction),
          this.identityHashSecret,
        );
      const users = new PostgresUserRepository(transaction);
      const credits = new CreditService(new PostgresCreditRepository(transaction, transaction));
      return new UserProvisioningService(users, credits, guard).provisionFromSupabaseClaims(claims);
    });
  }
}
