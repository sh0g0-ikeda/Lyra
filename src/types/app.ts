import type { AuthenticatedUser } from '../domain/types/user.js';

export interface AppEnv {
  Variables: {
    user: AuthenticatedUser;
  };
}
