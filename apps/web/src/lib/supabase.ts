import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (
    typeof url !== 'string' ||
    url.length === 0 ||
    typeof anonKey !== 'string' ||
    anonKey.length === 0
  ) {
    return null;
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
