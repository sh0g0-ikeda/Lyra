import { UnauthorizedError } from '../../domain/errors/index.js';
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
    if (claims.sub.length === 0 || claims.email.length === 0) {
      throw new UnauthorizedError('Supabase JWT is missing required user claims');
    }

    const existingUser = await this.userRepository.findBySupabaseId(claims.sub);
    if (existingUser !== null) {
      const user =
        existingUser.email === claims.email
          ? existingUser
          : await this.userRepository.updateEmail(claims.sub, claims.email);

      return { user, isNewUser: false };
    }

    try {
      const user = await this.userRepository.insertSupabaseUser(claims.sub, claims.email);
      await this.creditService.grantSignupBonus(user.id);
      return { user, isNewUser: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const user = await this.userRepository.updateEmail(claims.sub, claims.email);
      return { user, isNewUser: false };
    }
  }
}
