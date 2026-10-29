/**
 * Why a request is «طلب غير واضح» — the line the report gives it («ارسل صور فقط»): read from what the client wrote,
 * and only when it is certain. Anything else is left for the reviewer to say. Pure; the Teletel thread is read by
 * data/daily-report.ts.
 */
export type ClientMessage = { text: string; fromClient: boolean; isPrivate: boolean };

/** a bare greeting, however it is spelled — «السلام عليكم», «هلا», «مرحبا», «hi» */
const GREETING = /^(?:ال)?(?:سلام|سلامه|هلا|هلا والله|مرحبا|مرحبتين|اهلا|أهلا|صباح(?: الخير| النور)?|مساء(?: الخير| النور)?|حياك الله|hi|hello|hey)(?:\s+(?:عليكم|وعليكم|ورحمه الله|ورحمة الله|وبركاته|وعليكم السلام ورحمة الله وبركاته|بك|فيكم|بكم|والله|وسهلا|وسهلاً))*\s*[.!،,؟?]*$/iu;
const WORDS = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export function reasonFromMessages(messages: ClientMessage[]): string | null {
  const said = messages.filter((m) => m.fromClient && !m.isPrivate && m.text.trim());
  if (said.length === 0) return null;
  // attachments only: the thread shows them as «📎» (providers/teletel.ts) — pictures, files or a voice note
  if (said.every((m) => m.text.trim() === "📎")) return "ارسل مرفقات فقط";
  const typed = said.filter((m) => m.text.trim() !== "📎");
  if (typed.every((m) => WORDS(m.text).length <= 5 && GREETING.test(m.text.trim()))) return typed.length < said.length ? "تحية ومرفقات فقط" : "تحية فقط";
  return null;
}
