import { AccountLinkRequiredError, UnauthorizedError } from '../../domain/errors/index.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../domain/types/user.js';
import { isUniqueViolation, type UserRepository } from '../../repositories/UserRepository.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import {
  assertAccountIdentityIsProvisionable,
  type AccountDeletionIdentityGuardPort,
} from '../account/AccountDeletionIdentityGuard.js';

export interface ProvisionedUser {
  user: AuthenticatedUser;
  isNewUser: boolean;
}

export interface UserProvisioningPort {
  provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser>;
}

export class UserProvisioningService implements UserProvisioningPort {
  public constructor(
    private readonly userRepository: UserRepository,
    private readonly creditService: CreditServicePort,
    private readonly accountDeletionIdentityGuard?: AccountDeletionIdentityGuardPort,
  ) {}

  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    const supabaseId = claims.sub.trim();
    const email = claims.email.trim().toLowerCase();
    if (supabaseId.length === 0 || email.length === 0) {
      throw new UnauthorizedError('Auth token is missing required user claims');
    }

    const existingUser = await this.userRepository.findBySupabaseId(supabaseId);
    if (existingUser !== null) {
      return {
        user: await this.syncUserEmail(existingUser, supabaseId, email),
        isNewUser: false,
      };
    }

    await assertAccountIdentityIsProvisionable(
      this.accountDeletionIdentityGuard,
      supabaseId,
    );

    const userByEmail = await this.userRepository.findByEmail(email);
    if (userByEmail !== null) {
      // Verified email is not proof that a different authentication subject owns
      // the existing account. Genuine provider migrations use an approved offline
      // mapping; ordinary login never reassigns assets, balances or identities.
      throw new AccountLinkRequiredError();
    }

    let insertedUser: AuthenticatedUser;
    try {
      insertedUser = await this.userRepository.insertSupabaseUser(supabaseId, email);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const userCreatedByConcurrentRequest = await this.userRepository.findBySupabaseId(supabaseId);
      if (userCreatedByConcurrentRequest !== null) {
        return {
          user: await this.syncUserEmail(userCreatedByConcurrentRequest, supabaseId, email),
          isNewUser: false,
        };
      }

      const existingEmailUser = await this.userRepository.findByEmail(email);
      if (existingEmailUser !== null) throw new AccountLinkRequiredError();

      throw error;
    }

    // Only a user-insert conflict is a concurrent signup. Any credit failure,
    // including a uniqueness failure, must abort the outer API transaction.
    await this.creditService.grantSignupBonus(insertedUser.id);
    return { user: insertedUser, isNewUser: true };
  }

  private async syncUserEmail(
    user: AuthenticatedUser,
    supabaseId: string,
    email: string,
  ): Promise<AuthenticatedUser> {
    return user.email === email ? user : await this.userRepository.updateEmail(supabaseId, email);
  }

}
