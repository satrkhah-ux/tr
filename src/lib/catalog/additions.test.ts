import { describe, expect, it } from "vitest";
import { ROOM_CATEGORIES, ROOM_VIEWS } from "./room-catalog";
import { suggestName, uniqueNames, viewKey, visibleAdditions, type CatalogAddition } from "./additions";

const categories = ROOM_CATEGORIES.map((c) => c.label.ar);
const views = ROOM_VIEWS.map((v) => v.label.ar);

describe("suggestName", () => {
  it("a known room name typed right is used as is", () => {
    expect(suggestName("room", "ستاندرد", categories)).toEqual({ kind: "exact", name: "ستاندرد" });
  });
  it("a misspelt room name is corrected: «هل تقصد»", () => {
    expect(suggestName("room", "ستندرد", categories)).toEqual({ kind: "close", name: "ستاندرد" });
    expect(suggestName("room", "ديلكس", categories)).toEqual({ kind: "close", name: "ديلوكس" });
  });
  it("a view typed the short way finds the catalogue's", () => {
    expect(suggestName("view", "اطلاله بحر", views)).toEqual({ kind: "exact", name: "إطلالة على البحر" });
    expect(suggestName("view", "إطلالة على البحر", views)).toEqual({ kind: "exact", name: "إطلالة على البحر" });
    expect(suggestName("view", "اطلالة على الجيل", views)).toEqual({ kind: "close", name: "إطلالة على الجبل" });
  });
  it("something new is new", () => {
    expect(suggestName("view", "إطلالة على برج خليفة", views)).toEqual({ kind: "new" });
    // one wrong letter in a short word is a typo; another word is not
    expect(suggestName("view", "إطلالة على الشلال", views)).toEqual({ kind: "new" });
    expect(suggestName("room", "", categories)).toEqual({ kind: "new" });
  });
});

describe("viewKey", () => {
  it("keeps what the view looks at", () => {
    expect(viewKey("إطلالة على البحر")).toBe("بحر");
    expect(viewKey("منظر المدينة")).toBe("مدينه");
  });
});

describe("visibleAdditions", () => {
  const rows: CatalogAddition[] = [
    { id: "1", kind: "view", name: "a", status: "approved", created_by: "x" },
    { id: "2", kind: "view", name: "b", status: "pending", created_by: "me" },
    { id: "3", kind: "view", name: "c", status: "pending", created_by: "x" },
    { id: "4", kind: "view", name: "d", status: "rejected", created_by: "me" },
  ];
  it("approved for all, pending only for its author, rejected for none", () => {
    expect(visibleAdditions(rows, "me").map((r) => r.id)).toEqual(["1", "2"]);
    expect(visibleAdditions(rows, null).map((r) => r.id)).toEqual(["1"]);
  });
});

it("uniqueNames folds spelling", () => {
  expect(uniqueNames(["إطلالة", "اطلالة", "x", ""])).toEqual(["إطلالة", "x"]);
});
