import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const cutoff = new Date(Date.now() - 90*24*60*60*1000).toISOString()

const { error } = await supabase
  .from('events')
  .delete()
  .lt('start_at', cutoff)

console.log(error || "cleanup complete")
