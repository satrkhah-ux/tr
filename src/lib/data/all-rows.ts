import "server-only";

/**
 * Every row of a query, a thousand at a time. The self-hosted PostgREST answers
 * at most max-rows = 1000 whatever `.limit()` asks — the ads tab showed July's
 * thousand oldest rows and none of this week's (2026-10-19). `page(from, to)`
 * builds the query with `.range(from, to)`, ordered on a unique key so no row
 * falls between two pages.
 *
 * Each page is a round trip (~1 s from the server for 1,000 hotels), so a few
 * are asked at once; the ones past the end come back empty. An error ends it
 * with what was read.
 */
export async function allRows<T = unknown>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ data: T[] }> {
  const size = 1000;
  const batch = 3;
  const out: T[] = [];
  for (let from = 0; ; from += size * batch) {
    const results = await Promise.all(Array.from({ length: batch }, (_, i) => page(from + i * size, from + (i + 1) * size - 1)));
    for (const { data, error } of results) {
      if (error) return { data: out };
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < size) return { data: out };
    }
  }
}
