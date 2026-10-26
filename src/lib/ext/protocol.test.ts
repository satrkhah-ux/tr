import { describe, expect, it } from "vitest";
import { isPageMessage, onLinkPage, readTvctx, withTvctx } from "./protocol";

describe("«قارن» → the extension: the stay a compare link was opened for", () => {
  const draftId = "3f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  it("rides in the fragment and reads back, Arabic keys too", () => {
    const url = withTvctx("https://www.booking.com/searchresults.ar.html?ss=Kuala%20Lumpur&checkin=2026-11-01", { draftId, cityKey: "كوالالمبور-1" });
    expect(url.startsWith("https://www.booking.com/searchresults.ar.html?ss=Kuala%20Lumpur&checkin=2026-11-01#tvctx=")).toBe(true);
    expect(readTvctx(new URL(url).hash)).toEqual({ v: 1, d: draftId, c: "كوالالمبور-1" });
  });
  it("replaces a fragment already there", () => {
    expect(withTvctx("https://www.agoda.com/search?x=1#old", { draftId, cityKey: "k" }).match(/#/g)).toHaveLength(1);
  });
  it("refuses anything that is not ours", () => {
    expect(readTvctx("")).toBeNull();
    expect(readTvctx("#tvctx=notbase64!!")).toBeNull();
    expect(readTvctx(`#tvctx=${btoa(JSON.stringify({ v: 1, d: "not-a-uuid", c: "k" }))}`)).toBeNull();
    expect(readTvctx(`#tvctx=${btoa(JSON.stringify({ v: 2, d: draftId, c: "k" }))}`)).toBeNull();
    expect(readTvctx(`#tvctx=${btoa(JSON.stringify({ v: 1, d: draftId, c: "" }))}`)).toBeNull();
  });
});

describe("the linking page", () => {
  it("is /extension exactly", () => {
    expect(onLinkPage("/extension")).toBe(true);
    expect(onLinkPage("/extension/")).toBe(true);
    expect(onLinkPage("/extension-evil")).toBe(false);
    expect(onLinkPage("/extension/start")).toBe(false);
  });
  it("takes only a well-formed token from the page", () => {
    expect(isPageMessage({ source: "tv-page", type: "link", token: "A".repeat(43) })).toBe(true);
    expect(isPageMessage({ source: "tv-page", type: "link", token: "short" })).toBe(false);
    expect(isPageMessage({ source: "other", type: "ping" })).toBe(false);
  });
});
