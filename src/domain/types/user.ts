export interface AuthenticatedUser {
  id: string;
  supabaseId: string;
  email: string;
  displayName: string | null;
  planCode: string;
}

export interface SupabaseJwtClaims {
  sub: string;
  email: string;
}
