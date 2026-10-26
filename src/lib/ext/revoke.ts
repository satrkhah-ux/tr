import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Every live device link of one employee, revoked — when their password is reset
 * (every session on it goes; the extension's links go with them). Never blocks
 * the caller: a failure here leaves the links to expire or be revoked by hand.
 */
export async function revokeEmployeeExtensionLinks(employeeId: string): Promise<void> {
  try {
    await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("extension_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("employee_id", employeeId)
      .is("revoked_at", null);
  } catch {
    // the reset itself already happened
  }
}
