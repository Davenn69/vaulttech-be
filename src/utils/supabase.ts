import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config();

const createUnconfiguredSupabase = () =>
  new Proxy(
    function runtimeSupabaseProxy() {},
    {
      get() {
        return createUnconfiguredSupabase();
      },
      apply() {
        throw new Error(
          "Missing SUPABASE_URL or SUPABASE_ANON_KEY. Set them in Vercel environment variables.",
        );
      },
    },
  );

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

type SupabaseClientType = ReturnType<typeof createClient>;

export const supabase: SupabaseClientType =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : (createUnconfiguredSupabase() as unknown as SupabaseClientType);
