export type Production44RepositorySchemaProfile = 'production44_pg18_v1' | 'production44_expanded_pg18_v1';
export type RepositorySchemaProfile = 'canonical' | 'legacy_2debe_v1' | Production44RepositorySchemaProfile;

export const CANONICAL_REPOSITORY_SCHEMA_PROFILE: RepositorySchemaProfile = 'canonical';

/** Physical compatibility only: production44 retains application push/refund and connected deletion. */
export function hasPreVariantEntitySchema(profile: RepositorySchemaProfile): boolean {
  return profile === 'legacy_2debe_v1' || profile === 'production44_pg18_v1';
}

export function isProduction44RepositorySchemaProfile(profile: unknown): profile is Production44RepositorySchemaProfile {
  return profile === 'production44_pg18_v1' || profile === 'production44_expanded_pg18_v1';
}

/** Forward state columns do not rename the production page metadata columns. */
export function usesPhysicalPageStoryMetadata(profile: RepositorySchemaProfile): boolean {
  return profile === 'legacy_2debe_v1' || isProduction44RepositorySchemaProfile(profile);
}
