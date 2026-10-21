import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const call = vi.hoisted(() => vi.fn());
vi.mock("@/lib/providers/openai", () => ({ openaiJson: call }));
vi.mock("@/lib/providers/teletel", () => ({ getTeletelConfig: () => ({ baseUrl: "https://chat.teletel.io" }) }));
import { parseVisaIntake, trustedVisaImage, visaIntakeReply } from "./visa-intake";
const previous = { reply: "وصلت", summary: "تأشيرة فرنسا لشخصين", country: "فرنسا", missing: ["صورة الشخص الثاني"], review: [], completed: false };
describe("visa intake", () => {
  it("restricts image URLs to Teletel storage, including protocol and path", () => {
    expect(trustedVisaImage("https://chat.teletel.io/rails/active_storage/blobs/redirect/a/photo.jpg", "https://chat.teletel.io")).toBe(true);
    for (const url of ["http://chat.teletel.io/rails/active_storage/x", "https://evil.com/rails/active_storage/x", "https://chat.teletel.io/api/v1/accounts/1", "https://user:pass@chat.teletel.io/rails/active_storage/x"]) expect(trustedVisaImage(url, "https://chat.teletel.io")).toBe(false);
  });
  it("rejects missing or malformed model fields", () => {
    expect(parseVisaIntake(JSON.stringify(previous))).toEqual(previous);
    expect(parseVisaIntake(JSON.stringify({ ...previous, missing: [42] }))).toBeNull();
    expect(parseVisaIntake(JSON.stringify({ ...previous, reply: "" }))).toBeNull();
  });
  it("preserves missing documents and continues on vision/provider failure", async () => {
    call.mockRejectedValueOnce(new Error("image unavailable"));
    const r = await visaIntakeReply({ messages: [], previous, catalog: [], includePrice: true });
    expect(r.country).toBe("فرنسا");
    expect(r.missing).toContain("صورة الشخص الثاني");
    expect(r.completed).toBe(false);
    expect(r.reply).toContain("نكمل الطلب");
  });
  it("only sends client public images and applies no-price setting", async () => {
    call.mockResolvedValueOnce(JSON.stringify(previous));
    const message = { id: 1, at: 100, text: "صورة", fromClient: true, isPrivate: false, template: false, bot: false, images: ["https://chat.teletel.io/rails/active_storage/x"] };
    await visaIntakeReply({ messages: [message, { ...message, isPrivate: true, images: ["https://evil.com/x"] }], previous, catalog: [{ country: "فرنسا", sell_price: 500, sell_currency: "SAR" }], includePrice: false });
    const input = call.mock.calls.at(-1)![0];
    expect(input.images).toEqual(message.images);
    expect(input.system).toContain("لا تذكر أي أسعار");
    const context = JSON.parse(input.user);
    expect(context.messages).toHaveLength(1);
    expect(context.catalog).toEqual([{ country: "فرنسا" }]);
  });
});
