import type { AuthTokens } from '../domain/auth';
import { AuthError } from './auth';
import type { MobileAuthSessionPort } from './api';

export interface AuthWorkflowPort {
  signIn(): Promise<AuthTokens>;
  refresh(tokens: AuthTokens): Promise<AuthTokens>;
  signOut(): Promise<void>;
}

export interface AuthTokenStoragePort {
  save(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

type AuthStateListener = (tokens: AuthTokens | null) => void;

export class AuthSessionCoordinator implements MobileAuthSessionPort {
  private tokens: AuthTokens | null = null;
  private generation = 0;

  public constructor(
    private readonly workflow: AuthWorkflowPort,
    private readonly storage: AuthTokenStoragePort,
    private readonly onStateChanged?: AuthStateListener,
  ) {}

  public hydrate(tokens: AuthTokens | null): void {
    this.generation += 1;
    this.updateTokens(tokens);
  }

  public async signIn(): Promise<AuthTokens> {
    const generation = this.generation + 1;
    this.generation = generation;
    const signedIn = await this.workflow.signIn();
    if (generation !== this.generation) {
      await this.restoreCurrentAuthentication();
      throw this.sessionChangedError();
    }
    this.updateTokens(signedIn);
    return signedIn;
  }

  public async signOut(): Promise<void> {
    this.generation += 1;
    try {
      await this.workflow.signOut();
    } catch (error: unknown) {
      if (
        error instanceof AuthError
        && error.code === 'REMOTE_LOGOUT_FAILED'
      ) {
        this.updateTokens(null);
      }
      throw error;
    }
    this.updateTokens(null);
  }

  public async getTokens(): Promise<AuthTokens | null> {
    return this.tokens;
  }

  public async refreshTokens(): Promise<AuthTokens> {
    const current = this.tokens;
    if (current === null) {
      throw new AuthError(
        'REFRESH_UNAVAILABLE',
        'The session cannot be refreshed.',
        true,
      );
    }
    const generation = this.generation;

    let refreshed: AuthTokens;
    try {
      refreshed = await this.workflow.refresh(current);
    } catch (error: unknown) {
      if (error instanceof AuthError && error.fatal) {
        this.generation += 1;
        await this.storage.clear();
        this.updateTokens(null);
      }
      throw error;
    }

    if (generation !== this.generation) {
      await this.restoreCurrentAuthentication();
      throw this.sessionChangedError();
    }

    await this.storage.save(refreshed);
    if (generation !== this.generation) {
      await this.restoreCurrentAuthentication();
      throw this.sessionChangedError();
    }
    this.updateTokens(refreshed);
    return refreshed;
  }

  private updateTokens(tokens: AuthTokens | null): void {
    this.tokens = tokens;
    this.onStateChanged?.(tokens);
  }

  private async restoreCurrentAuthentication(): Promise<void> {
    if (this.tokens === null) {
      await this.storage.clear();
      return;
    }
    await this.storage.save(this.tokens);
  }

  private sessionChangedError(): AuthError {
    return new AuthError(
      'SESSION_CHANGED',
      'The authentication state changed while the request was running.',
      false,
    );
  }
}
