import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "@supabase/supabase-js";
import type { Permission } from "@/lib/roles/roles";

/**
 * A server job doing an employee's work with nobody signed in — «مُراد» issuing
 * the «عرض آلي» it priced (the owner, 2026-10-18: «بالإصدار الآلي»). There is
 * no cookie to read: a webhook carries none and a timer runs outside any
 * request. Inside `asSystem` the identity helpers answer for the job instead —
 * getServerUser (a user that is no account and no employee), the server
 * client (the service role), currentCan (`can` only), isStaffSession (yes).
 * Everything it writes is stamped with no employee; audit rows carry its name.
 *
 * Server code only, and only by its own call: no "use server" file exports
 * this, and the store lives in this process's async context, which nothing a
 * browser sends can reach.
 */
export type SystemActor = { name: string; can: readonly Permission[] };

const store = new AsyncLocalStorage<SystemActor>();

export const systemActor = (): SystemActor | null => store.getStore() ?? null;

export const asSystem = <T>(actor: SystemActor, fn: () => Promise<T>): Promise<T> => store.run(actor, fn);

/** The job as a user: the nil uuid matches no account and no employee, so nothing resolves to a person. */
export const systemUser = (actor: SystemActor): User =>
  ({ id: "00000000-0000-0000-0000-000000000000", email: actor.name, aud: "system", app_metadata: {}, user_metadata: {}, created_at: "" }) as User;
