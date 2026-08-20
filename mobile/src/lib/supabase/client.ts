import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@shared/types/database'

/**
 * Mirrors web/src/lib/supabase/client.ts, with the one difference React Native
 * forces: there is no localStorage, so the session is persisted through
 * AsyncStorage. Without it supabase-js keeps the session in memory only and
 * the cashier is signed out every time the app is backgrounded.
 *
 * The keys come from app.json `extra` rather than process.env, because a
 * React Native bundle has no dotenv at runtime.
 */
const extra = Constants.expoConfig?.extra as
  | { supabaseUrl?: string; supabaseAnonKey?: string }
  | undefined

const supabaseUrl = extra?.supabaseUrl ?? ''
const supabaseAnonKey = extra?.supabaseAnonKey ?? ''

export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey)

let client: ReturnType<typeof createSupabaseClient<Database>> | null = null

export function createClient() {
  if (client) return client

  client = createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      // No OAuth redirect to parse in a native app.
      detectSessionInUrl: false,
    },
  })

  return client
}
