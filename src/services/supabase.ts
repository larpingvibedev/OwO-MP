import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Default Supabase project credentials (can be overridden via localStorage or env)
const STORAGE_KEY_URL = 'owo_supabase_url';
const STORAGE_KEY_ANON = 'owo_supabase_anon_key';

const DEFAULT_SUPABASE_URL = 'https://sqbhjbkofupyyilbnolf.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_h-RgBEeb2K5G8t4advwlFA_tGokg8EK';

export function cleanSupabaseUrl(rawUrl: string): string {
  let cleaned = (rawUrl || '').trim();
  cleaned = cleaned.replace(/\/rest\/v1\/?$/i, '');
  cleaned = cleaned.replace(/\/auth\/v1\/?$/i, '');
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned;
}

export function getSupabaseCredentials(): { url: string; anonKey: string; isCustom: boolean } {
  const customUrl = localStorage.getItem(STORAGE_KEY_URL);
  const customKey = localStorage.getItem(STORAGE_KEY_ANON);

  if (customUrl && customKey) {
    return { url: cleanSupabaseUrl(customUrl), anonKey: customKey.trim(), isCustom: true };
  }

  return {
    url: cleanSupabaseUrl(DEFAULT_SUPABASE_URL),
    anonKey: DEFAULT_SUPABASE_ANON_KEY,
    isCustom: false
  };
}

export function saveSupabaseCredentials(url: string, anonKey: string) {
  if (url && anonKey) {
    const cleaned = cleanSupabaseUrl(url);
    localStorage.setItem(STORAGE_KEY_URL, cleaned);
    localStorage.setItem(STORAGE_KEY_ANON, anonKey.trim());
    initSupabaseClient();
  }
}

export function clearCustomSupabaseCredentials() {
  localStorage.removeItem(STORAGE_KEY_URL);
  localStorage.removeItem(STORAGE_KEY_ANON);
  initSupabaseClient();
}

let supabaseInstance: SupabaseClient | null = null;

export function initSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();
  
  supabaseInstance = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  });

  return supabaseInstance;
}

export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    return initSupabaseClient();
  }
  return supabaseInstance;
}
