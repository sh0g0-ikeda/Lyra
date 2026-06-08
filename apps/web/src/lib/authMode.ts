export interface WebAuthModeEnv {
  MODE?: string;
  PROD?: boolean;
  VITE_REQUIRE_HOSTED_AUTH?: string;
}

export function shouldAllowManualTokenAuth(env: WebAuthModeEnv): boolean {
  // In paid production, Hosted UI is the user-facing auth surface; manual tokens stay a development escape hatch.
  const isProduction = env.PROD === true || env.MODE === 'production';
  return !(isProduction && env.VITE_REQUIRE_HOSTED_AUTH === 'true');
}
