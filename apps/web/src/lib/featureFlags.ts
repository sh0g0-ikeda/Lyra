function parseBooleanEnv(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export const ORGANIZATION_FEATURES_AVAILABLE = parseBooleanEnv(import.meta.env.VITE_ORGANIZATION_FEATURES_ENABLED);
