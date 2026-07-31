export type FoundationRoute =
  | 'booting'
  | 'configuration-error'
  | 'home'
  | 'loading-session'
  | 'session-error'
  | 'sign-in';

interface FoundationRouteState {
  configValid: boolean;
  hydrated: boolean;
  authenticated: boolean;
  sessionReady: boolean;
  sessionFailed: boolean;
}

export function resolveFoundationRoute(
  state: FoundationRouteState,
): FoundationRoute {
  if (!state.configValid) {
    return 'configuration-error';
  }
  if (!state.hydrated) {
    return 'booting';
  }
  if (!state.authenticated) {
    return 'sign-in';
  }
  if (state.sessionReady) {
    return 'home';
  }
  if (state.sessionFailed) {
    return 'session-error';
  }
  return 'loading-session';
}
