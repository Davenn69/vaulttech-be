import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

export const supabase = () => {
    if (!supabaseUrl || !supabaseAnonKey) {
        console.log('missing supabase credentials')
        return;
    }
    return createClient(supabaseUrl, supabaseAnonKey)
}