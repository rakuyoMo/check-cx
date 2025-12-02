import { createBrowserClient } from '@supabase/ssr'

// 开发模式使用 dev schema，生产模式使用 public schema
const DB_SCHEMA = process.env.NODE_ENV === 'development' ? 'dev' : 'public'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
    { db: { schema: DB_SCHEMA } }
  )
}
