import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

export const isCloudConfigured = Boolean(url && key && !url.includes("YOUR_PROJECT"));
export const supabase = createClient(
  isCloudConfigured ? url : "https://example.supabase.co",
  isCloudConfigured ? key : "public-anon-key-placeholder",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  }
);
