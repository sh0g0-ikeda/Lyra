export interface WebAuthModeEnv {
  MODE?: string;
  PROD?: boolean;
  VITE_REQUIRE_HOSTED_AUTH?: string;
}

export function shouldAllowManualTokenAuth(env: WebAuthModeEnv): boolean {
  // In paid production, Hosted UI is the only user-facing auth surface.
  const isProduction = env.PROD === true || env.MODE === 'production';
  return !isProduction;
}
