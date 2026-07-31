import { describe, expect, it } from 'vitest';
import type { AuthTokens } from '../src/domain/auth';
import { AuthError } from '../src/lib/auth';
import {
  AuthSessionCoordinator,
  type AuthTokenStoragePort,
  type AuthWorkflowPort,
} from '../src/lib/authSessionCoordinator';

describe('AuthSessionCoordinator', () => {
  it('logout後に遅れて完了したrefreshを保存せず破棄する', async () => {
    const workflow = new FakeAuthWorkflow();
    const storage = new FakeAuthStorage();
    const coordinator = new AuthSessionCoordinator(workflow, storage);
    coordinator.hydrate(buildTokens('old-token'));
    const refresh = coordinator.refreshTokens();
    const rejection = expect(refresh).rejects.toMatchObject({
      code: 'SESSION_CHANGED',
    });

    await coordinator.signOut();
    workflow.resolveRefresh(buildTokens('late-token'));

    await rejection;
    await expect(coordinator.getTokens()).resolves.toBeNull();
    expect(storage.saved).toEqual([]);
    expect(storage.clearCalls).toBe(1);
  });

  it('端末tokenの削除に失敗した場合は認証状態を保持して再試行可能にする', async () => {
    const workflow = new FakeAuthWorkflow();
    workflow.signOutError = new Error('secure storage unavailable');
    const coordinator = new AuthSessionCoordinator(
      workflow,
      new FakeAuthStorage(),
    );
    const tokens = buildTokens('old-token');
    coordinator.hydrate(tokens);

    await expect(coordinator.signOut()).rejects.toThrow(
      'secure storage unavailable',
    );
    await expect(coordinator.getTokens()).resolves.toEqual(tokens);
  });

  it('remote logoutだけが失敗した場合は端末の認証状態を破棄する', async () => {
    const workflow = new FakeAuthWorkflow();
    workflow.signOutError = new AuthError(
      'REMOTE_LOGOUT_FAILED',
      'network',
      false,
    );
    const coordinator = new AuthSessionCoordinator(
      workflow,
      new FakeAuthStorage(),
    );
    coordinator.hydrate(buildTokens('old-token'));

    await expect(coordinator.signOut()).rejects.toMatchObject({
      code: 'REMOTE_LOGOUT_FAILED',
    });
    await expect(coordinator.getTokens()).resolves.toBeNull();
  });
});

class FakeAuthWorkflow implements AuthWorkflowPort {
  public signOutError: Error | null = null;
  private refreshResolver: ((tokens: AuthTokens) => void) | null = null;

  public async signIn(): Promise<AuthTokens> {
    return buildTokens('signed-in-token');
  }

  public async refresh(_tokens: AuthTokens): Promise<AuthTokens> {
    return await new Promise<AuthTokens>((resolve) => {
      this.refreshResolver = resolve;
    });
  }

  public async signOut(): Promise<void> {
    if (this.signOutError !== null) {
      throw this.signOutError;
    }
  }

  public resolveRefresh(tokens: AuthTokens): void {
    this.refreshResolver?.(tokens);
  }
}

class FakeAuthStorage implements AuthTokenStoragePort {
  public readonly saved: AuthTokens[] = [];
  public clearCalls = 0;

  public async save(tokens: AuthTokens): Promise<void> {
    this.saved.push(tokens);
  }

  public async clear(): Promise<void> {
    this.clearCalls += 1;
  }
}

function buildTokens(idToken: string): AuthTokens {
  return {
    idToken,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 1_800_000_000_000,
    tokenType: 'Bearer',
  };
}
