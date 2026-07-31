import { UnauthorizedError } from '../../domain/errors/index.js';
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
      return {
        user: await this.linkExistingEmailUser(userByEmail, supabaseId, email),
        isNewUser: false,
      };
    }

    try {
      const user = await this.userRepository.insertSupabaseUser(supabaseId, email);
      await this.creditService.grantSignupBonus(user.id);
      return { user, isNewUser: true };
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
      if (existingEmailUser !== null) {
        return {
          user: await this.linkExistingEmailUser(existingEmailUser, supabaseId, email),
          isNewUser: false,
        };
      }

      throw error;
    }
  }

  private async syncUserEmail(
    user: AuthenticatedUser,
    supabaseId: string,
    email: string,
  ): Promise<AuthenticatedUser> {
    return user.email === email ? user : await this.userRepository.updateEmail(supabaseId, email);
  }

  private async linkExistingEmailUser(
    user: AuthenticatedUser,
    supabaseId: string,
    email: string,
  ): Promise<AuthenticatedUser> {
    // Cognito/Supabase migrations can change the provider subject while the
    // verified email remains the same. Keep the existing Lyra user id so works,
    // credits, subscriptions, and generated assets stay attached to the account.
    if (user.supabaseId === supabaseId) {
      return this.syncUserEmail(user, supabaseId, email);
    }

    try {
      return await this.userRepository.linkSupabaseIdByEmail(email, supabaseId);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const linkedByConcurrentRequest = await this.userRepository.findBySupabaseId(supabaseId);
      if (linkedByConcurrentRequest !== null) {
        return this.syncUserEmail(linkedByConcurrentRequest, supabaseId, email);
      }

      throw error;
    }
  }
}
