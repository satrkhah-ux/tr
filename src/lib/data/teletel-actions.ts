"use server";

import { getServerUser } from "@/lib/supabase/server";
import {
  getTeletelConfig,
  getTeletelContactLabels,
  inferDestinations,
  searchTeletelContacts,
} from "@/lib/providers/teletel";

/**
 * Teletel customer lookup for the package generator's customer stage.
 * Auth-gated; returns client-safe fields only (name/phone/email/labels +
 * inferred destination suggestions) — the token stays on the server.
 */

export type TeletelCustomerHit = {
  id: number;
  name: string;
  phone: string;
  email: string;
  labels: string[];
  destinations: string[];
};

export type TeletelSearchResult =
  | { ok: true; configured: boolean; hits: TeletelCustomerHit[] }
  | { ok: false; error: "err.session" };

export async function searchCustomersFromTeletel(query: string): Promise<TeletelSearchResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };

  if (!getTeletelConfig()) return { ok: true, configured: false, hits: [] };
  const trimmed = query.trim();
  if (trimmed.length < 2) return { ok: true, configured: true, hits: [] };

  const contacts = await searchTeletelContacts(trimmed);

  // labels drive the «رحلة جورجيا → جورجيا» suggestion; fetched per contact,
  // failures degrade to no-labels rather than failing the search.
  const hits = await Promise.all(
    contacts.map(async (c) => {
      const labels = await getTeletelContactLabels(c.id);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        labels,
        destinations: inferDestinations(labels, c.attributes),
      };
    }),
  );

  return { ok: true, configured: true, hits };
}
