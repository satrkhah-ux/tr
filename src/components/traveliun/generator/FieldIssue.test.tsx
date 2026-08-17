import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FieldIssue, FieldIssueProvider } from "./FieldIssue";
import { validateDraft } from "@/lib/offer/draft-validation";
import { emptyDraftData } from "@/lib/offer/draft-types";
import type { DraftIssue } from "@/lib/offer/draft-validation";

/**
 * The point of the whole change: a message appears under the box it is about,
 * and NOT under any other box. A mapping that leaks one field's error onto a
 * neighbouring input would be worse than the panel it replaced.
 */

const show = (issues: DraftIssue[], field: Parameters<typeof FieldIssue>[0]["field"]) =>
  renderToStaticMarkup(
    <FieldIssueProvider issues={issues} render={(i) => i.key ?? i.invariant?.code ?? ""}>
      <FieldIssue field={field} />
    </FieldIssueProvider>,
  );

describe("FieldIssue", () => {
  const empty = validateDraft(emptyDraftData());
  const all = [...empty.blocking, ...empty.warnings];

  it("puts the country error on the country field", () => {
    expect(show(all, "trip.country")).toContain("pg.err.noCountry");
  });

  it("does NOT put it on a neighbouring field", () => {
    expect(show(all, "trip.arrival_date")).not.toContain("pg.err.noCountry");
    expect(show(all, "customer.customer_name")).not.toContain("pg.err.noCountry");
  });

  it("renders nothing at all for a clean field", () => {
    expect(show([], "trip.country")).toBe("");
  });

  it("shows warnings as well as blocking errors", () => {
    // An agent typing does not care which bucket we filed it under.
    expect(show(all, "customer.customer_name")).toContain("pg.warn.noName");
  });

  it("every issue an empty draft produces knows which field it belongs to", () => {
    // The guarantee that keeps the panel and the form in agreement: an issue
    // with no field would show in the side list and nowhere on the form, which
    // is exactly the situation this change exists to end.
    const orphans = all.filter((issue) => !issue.field);
    expect(orphans.map((i) => i.key ?? i.invariant?.code)).toEqual([]);
  });
});
