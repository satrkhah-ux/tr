import { describe, expect, it } from "vitest";
import { designImageUrl } from "./design";

describe("a ready offer's design as an image (the owner, 2026-10-19)", () => {
  it("a Google Drive share link becomes Drive's image of it", () => {
    expect(designImageUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing")).toBe("https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w1200");
    expect(designImageUrl("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe("https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w1200");
    expect(designImageUrl("https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOp")).toBe("https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w1200");
  });
  it("an image file, or our storage, as it is", () => {
    expect(designImageUrl("https://example.com/a/b/georgia.JPG?x=1")).toBe("https://example.com/a/b/georgia.JPG?x=1");
    expect(designImageUrl("https://db.example.com/storage/v1/object/public/ready-designs/1/2.webp")).toContain("/ready-designs/");
  });
  it("a page (Canva, a site) is no image — the card keeps its description", () => {
    expect(designImageUrl("https://www.canva.com/design/DAF123/view")).toBeNull();
    expect(designImageUrl("https://example.com/news/story")).toBeNull();
    expect(designImageUrl("")).toBeNull();
    expect(designImageUrl("not a link")).toBeNull();
  });
});
