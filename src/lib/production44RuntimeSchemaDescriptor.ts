/**
 * PG18 catalog reproduced from the 44 immutable SQL files in the matching test
 * fixture. M2r16 observed catalog and r30 local reconstruction matched in full.
 * These signatures identify a candidate physical profile, not release readiness.
 * Each digest hashes sorted rows with recursively sorted object keys; duplicates
 * and every catalog attribute remain significant.
 */
export const PRODUCTION44_CATALOG_SIGNATURES = Object.freeze({
  migrationFilenames: '051fb45aae678725ac4a0910753977a72e06273d3f561eb5ceaf4fa19ea330d1',
  relations: '3c1d535b0ce6e2a73b0a653514308e4d7cd5dfb8f81a53612a9cc61b9eaaada2',
  namespaceArtifacts: 'c8ba636537b52f6977eaa0d445d12a9c4d2937633d177471c8c158ea58a6b889',
  columns: 'bcb489b391369c6db3267afffa3a7b33c0079d0c9eb7a8e0aa8ec189b94c8b91',
  constraints: '9f7d2650a249e32d769238a99908ff07d81b5b4c2066847dc11089f3c4b76953',
  indexes: 'ea3780f7aabed2c4a469c390aaa715c3c5146d32eab584a3ce7355a172ee80a1',
  triggers: '1b3ebf9cb148b88fc84fbf4b3ba890d8bc55c21393fb565ecc926e957c86fabd',
  functions: '0968c652abf99765ba6949f7aaf9f09c5508cb4c3220b74f1a89f2ee030bfeeb',
});
