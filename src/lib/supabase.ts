import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isLocalDbEnabled } from './local-db';

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && serviceKey && !url.includes('YOUR_PROJECT_REF'));
}

export function isStorageConfigured(): boolean {
  return isLocalDbEnabled() || isSupabaseConfigured();
}

export function getStorageMode(): 'local' | 'supabase' | 'unconfigured' {
  if (isLocalDbEnabled()) return 'local';
  if (isSupabaseConfigured()) return 'supabase';
  return 'unconfigured';
}

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Supabase belum dikonfigurasi. Pastikan NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sudah diisi.'
    );
  }

  cachedClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}
