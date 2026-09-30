import { AccountLinkRequiredError, UnauthorizedError } from '../../domain/errors/index.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../domain/types/user.js';
import { isUniqueViolation, type UserRepository } from '../../repositories/UserRepository.js';
import type { CreditServicePort } from '../credit/CreditService.js';

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

    const userByEmail = await this.userRepository.findByEmail(email);
    if (userByEmail !== null) {
      throw new AccountLinkRequiredError();
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
        throw new AccountLinkRequiredError();
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

}
