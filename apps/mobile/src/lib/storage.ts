import * as SecureStore from 'expo-secure-store';
import {
  authTokensSchema,
  type AuthTokens,
} from '../domain/auth';

const AUTH_TOKEN_STORAGE_KEY = 'lyra.mobile.auth.tokens';

export async function loadAuthTokens(): Promise<AuthTokens | null> {
  const stored = await SecureStore.getItemAsync(AUTH_TOKEN_STORAGE_KEY);
  if (stored === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    const result = authTokensSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch {
    // Invalid local state is cleared below and treated as signed out.
  }

  await SecureStore.deleteItemAsync(AUTH_TOKEN_STORAGE_KEY);
  return null;
}

export async function saveAuthTokens(tokens: AuthTokens): Promise<void> {
  const validated = authTokensSchema.parse(tokens);
  await SecureStore.setItemAsync(
    AUTH_TOKEN_STORAGE_KEY,
    JSON.stringify(validated),
  );
}

export async function clearAuthTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_STORAGE_KEY);
}
