import { describe, expect, it } from "vitest";
import { reasonFromMessages, type ClientMessage } from "./incomplete-reason";

const client = (text: string): ClientMessage => ({ text, fromClient: true, isPrivate: false });
const ours = (text: string): ClientMessage => ({ text, fromClient: false, isPrivate: false });

describe("why a request is unclear", () => {
  it("says «مرفقات فقط» when the client wrote nothing but attachments", () => {
    expect(reasonFromMessages([client("📎"), ours("أهلاً بك"), client("📎")])).toBe("ارسل مرفقات فقط");
  });

  it("says «تحية فقط» for greetings alone — with or without an attachment after", () => {
    expect(reasonFromMessages([client("السلام عليكم")])).toBe("تحية فقط");
    expect(reasonFromMessages([client("هلا"), client("مرحبا")])).toBe("تحية فقط");
    // a greeting with an attachment is said as both
    expect(reasonFromMessages([client("السلام عليكم ورحمة الله"), client("📎")])).toBe("تحية ومرفقات فقط");
  });

  it("is nothing when the client wrote something real, or nothing at all — the reviewer says it", () => {
    expect(reasonFromMessages([client("السلام عليكم"), client("ابغى اعرف عن الاوضاع هناك")])).toBeNull();
    expect(reasonFromMessages([])).toBeNull();
    // a colleague's reply or a private note is not the client's
    expect(reasonFromMessages([ours("📎"), { text: "ملاحظة", fromClient: true, isPrivate: true }])).toBeNull();
  });
});
