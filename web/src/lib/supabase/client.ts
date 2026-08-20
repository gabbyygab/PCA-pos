import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@shared/types/database'

/**
 * The desktop app is a static bundle in a native webview and the mobile app is
 * React Native — neither has a server to share a session cookie with, so the
 * session lives in local storage and supabase-js refreshes it itself.
 */
let client: ReturnType<typeof createSupabaseClient<Database>> | null = null

export function createClient() {
  if (client) return client

  client = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // No OAuth redirects in a webview; nothing to parse out of the URL.
        detectSessionInUrl: false,
      },
    }
  )

  return client
}
