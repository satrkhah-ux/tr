"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Puzzle, Trash2 } from "lucide-react";
import { linkExtension, revokeAllMyExtensionLinks, revokeExtensionLink, type ExtensionLink } from "@/lib/data/extension-links";
import { FROM_PAGE, isExtMessage, type PageMessage } from "@/lib/ext/protocol";
import { TraveliunShell } from "../TraveliunShell";

const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

/**
 * «إضافة المتصفح»: link this browser's extension with one press, and the list of
 * linked devices with «إلغاء». The token goes from the server action straight to
 * the extension's script on this page and is never shown; if the extension does
 * not confirm within a few seconds the new link is revoked at once.
 */
export function ExtensionLinkPage({ initial }: { initial: ExtensionLink[] }) {
  const router = useRouter();
  const [ext, setExt] = useState<{ version: string; linked: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const waiting = useRef<((r: { ok: boolean; name?: string; reason?: "reload" }) => void) | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin || !isExtMessage(e.data)) return;
      if (e.data.type === "here") setExt({ version: e.data.version, linked: e.data.linked });
      if (e.data.type === "linked") waiting.current?.({ ok: e.data.ok, name: e.data.name, reason: e.data.reason });
    };
    window.addEventListener("message", onMessage);
    // the extension's script may have spoken before this page listened
    send({ source: FROM_PAGE, type: "ping" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function link() {
    setBusy(true);
    setNote(null);
    try {
      const r = await linkExtension();
      if (!r.ok) {
        setNote({ ok: false, text: r.error });
        return;
      }
      const answer = await new Promise<{ ok: boolean; name?: string; reason?: "reload" }>((resolve) => {
        const timer = window.setTimeout(() => resolve({ ok: false }), 6000);
        waiting.current = (v) => {
          window.clearTimeout(timer);
          resolve(v);
        };
        send({ source: FROM_PAGE, type: "link", token: r.token });
      });
      waiting.current = null;
      if (answer.ok) {
        setNote({ ok: true, text: `تم ربط الإضافة${answer.name ? ` باسم ${answer.name}` : ""}` });
        setExt((x) => (x ? { ...x, linked: true } : x));
        return;
      }
      // never confirmed: the link just made is taken back — and said plainly if that failed too
      const undone = await revokeExtensionLink(r.id).catch(() => ({ ok: false }));
      setNote({
        ok: false,
        text: !undone.ok
          ? "لم تؤكد الإضافة الربط — ألغِ الجهاز الجديد من القائمة أدناه"
          : answer.reason === "reload"
            ? "حُدّثت الإضافة منذ فتح هذه الصفحة — أعد تحميل الصفحة ثم اربط"
            : "لم تؤكد الإضافة الربط — حاول مرة أخرى",
      });
    } catch {
      setNote({ ok: false, text: "تعذّر الربط — حاول مرة أخرى" });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function revokeAll() {
    if (!window.confirm("إلغاء الإضافة على كل أجهزتك؟ ستحتاج إلى ربط كل جهاز من جديد.")) return;
    setBusy(true);
    try {
      const r = await revokeAllMyExtensionLinks();
      setNote(r.ok ? { ok: true, text: `أُلغيت كل الأجهزة (${r.count})` } : { ok: false, text: "تعذّر الإلغاء — حاول مرة أخرى" });
      if (r.ok) setExt((x) => (x ? { ...x, linked: false } : x));
    } catch {
      setNote({ ok: false, text: "تعذّر الإلغاء — حاول مرة أخرى" });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      const r = await revokeExtensionLink(id);
      if (!r.ok) setNote({ ok: false, text: "تعذّر إلغاء الجهاز — حاول مرة أخرى" });
    } catch {
      setNote({ ok: false, text: "تعذّر إلغاء الجهاز — حاول مرة أخرى" });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <TraveliunShell title="nav.extension">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <section className="tv-card rounded-[14px] border p-5">
          <h1 className="inline-flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
            <Puzzle className="size-5 text-[#e0a92a]" />
            إضافة المتصفح
          </h1>
          <p className="mt-1 text-[13px] font-semibold leading-6 text-[#557d78]">
            مساعدك بجانب محادثات تيلي تيل وصفحات الفنادق. اربطها بحسابك مرة على كل جهاز — لا كلمة مرور فيها، ويمكنك إلغاء أي جهاز من هنا.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {ext ? (
              <button
                type="button"
                onClick={() => void link()}
                disabled={busy}
                className="tv-btn-primary inline-flex h-11 items-center gap-2 rounded-[11px] px-5 text-[13.5px] font-extrabold disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {ext.linked ? "أعد ربط هذا المتصفح" : "اربط هذا المتصفح"}
              </button>
            ) : (
              <p className="rounded-[10px] bg-[#fff8eb] px-3 py-2 text-[12.5px] font-bold text-[#8a5a00]">
                الإضافة غير مثبتة في هذا المتصفح — ثبّتها أولاً (اطلب الحزمة من الإدارة)، ثم افتح هذه الصفحة من جديد.
              </p>
            )}
            {ext ? <span className="text-[11.5px] font-semibold text-tv-text-faint">الإضافة مثبتة · الإصدار {ext.version}</span> : null}
          </div>
          {note ? (
            <p className={`mt-3 text-[13px] font-bold ${note.ok ? "text-[#185045]" : "text-[#c43d3d]"}`} role="status">
              {note.text}
            </p>
          ) : null}
        </section>

        <section className="tv-card rounded-[14px] border p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex-1 text-[14px] font-extrabold text-[#003c3a]">الأجهزة المربوطة</h2>
            {initial.length > 0 ? (
              <button
                type="button"
                onClick={() => void revokeAll()}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#f2c7c7] px-2.5 text-[12px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60 max-sm:min-h-10"
              >
                <Trash2 className="size-3.5" />
                ألغِ كل الأجهزة
              </button>
            ) : null}
          </div>
          {initial.length === 0 ? (
            <p className="mt-2 text-[12.5px] font-semibold text-tv-text-faint">لا جهاز مربوط بعد.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[#edf2ef]">
              {initial.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-[#185045]">{l.label || "متصفح"}</span>
                    <span className="block text-[11.5px] font-semibold text-tv-text-faint">
                      رُبط {fmt(l.created_at)} · آخر استعمال {fmt(l.last_used_at)} · ينتهي {fmt(l.expires_at)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void revoke(l.id)}
                    disabled={busy}
                    className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#f2c7c7] px-2.5 text-[12px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60 max-sm:min-h-10"
                  >
                    <Trash2 className="size-3.5" />
                    إلغاء
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}

function send(message: PageMessage) {
  window.postMessage(message, window.location.origin);
}
