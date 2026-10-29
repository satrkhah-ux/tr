"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Moon, Phone, UserRound, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { endMyStatus, getMyPresence, startMyStatus, type MyPresence } from "@/lib/data/presence-status";
import { STATUS_BUTTON, WANTS, type StatusKind } from "@/lib/presence/excuse";

/**
 * The status buttons beside مُراد (the owner, 2026-10-29), in his own side strip — so they stand over no button or field.
 * Each colleague sees the ones their permissions give (and «اجتماع» while invited to an open meeting). On: no request is
 * routed to them and no delay is counted, up to the button's limit. Pressed again: off.
 */

const ICON: Record<StatusKind, typeof UserRound> = { client: UserRound, call: Phone, prayer: Moon, meeting: Users };
const minutesSince = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

export function StatusButtons() {
  const [p, setP] = useState<MyPresence | null>(null);
  const [form, setForm] = useState<"client" | "call" | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [now, setNow] = useState(0);

  const load = useCallback(() => {
    getMyPresence()
      .then((v) => {
        setP(v);
        if (v) setNow(v.at);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!p || (!p.allowed.length && !p.active)) return null;

  const press = (kind: StatusKind) => {
    setError("");
    if (p.active?.kind === kind) return start(async () => void (await endMyStatus().then(load)));
    if (kind === "client" || kind === "call") return setForm(kind);
    start(async () => {
      const r = await startMyStatus(kind);
      if (!r.ok) setError(r.error);
      load();
    });
  };

  return (
    <>
      <div className="flex flex-col items-center gap-1.5" role="group" aria-label="حالتي الآن">
        {p.allowed.map((k) => {
          const Icon = ICON[k];
          const on = p.active?.kind === k;
          const title = on ? `${STATUS_BUTTON[k]} — منذ ${minutesSince(p.active!.startedAt, now)} د · اضغط لإنهائها` : STATUS_BUTTON[k];
          return (
            <button
              key={k}
              type="button"
              disabled={pending}
              onClick={() => press(k)}
              title={title}
              aria-label={title}
              aria-pressed={on}
              className={`flex size-9 items-center justify-center rounded-s-lg shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${
                on ? "bg-amber-500 text-white" : "bg-white text-[var(--tv-brand)] hover:bg-[#e3ece8]"
              }`}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
        {error && (
          <span className="sr-only" role="alert">
            {error}
          </span>
        )}
      </div>
      {form && (
        <ClientForm
          kind={form}
          busy={pending}
          onClose={() => setForm(null)}
          onSave={(values) =>
            start(async () => {
              const r = await startMyStatus(form, values);
              if (!r.ok) return setError(r.error);
              setForm(null);
              load();
            })
          }
          error={error}
        />
      )}
    </>
  );
}

function ClientForm({
  kind,
  busy,
  error,
  onClose,
  onSave,
}: {
  kind: "client" | "call";
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (v: Record<string, string>) => void;
}) {
  const [v, setV] = useState<Record<string, string>>({ want: "", destination: "", name: "", phone: "", note: "" });
  const field = "mt-1 w-full rounded-xl border border-[#D5DED9] bg-white p-2.5 text-sm text-slate-900 dark:bg-[#0f1c19] dark:text-[#eaf3ef]";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{kind === "client" ? "لدي عميل في المكتب" : "لدي اتصال"}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="mb-3">
          لن تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تنهيها. وإذا راسلنا هذا العميل لاحقاً يصل طلبه إليك مباشرة.
        </DialogDescription>
        <div className="space-y-3">
          <div>
            <span className="text-xs font-bold">ماذا يريد؟</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {WANTS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setV({ ...v, want: w })}
                  className={`min-h-10 rounded-xl border px-3 text-sm font-bold ${v.want === w ? "border-[#185045] bg-[#185045] text-white" : "border-[#D5DED9] bg-white text-[#185045]"}`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-xs font-bold">
            الوجهة
            <input
              className={field}
              maxLength={80}
              value={v.destination}
              onChange={(e) => setV({ ...v, destination: e.target.value })}
              placeholder="مثال: جورجيا"
            />
          </label>
          <label className="block text-xs font-bold">
            اسم العميل
            <input className={field} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </label>
          <label className="block text-xs font-bold">
            رقم الهاتف
            <input
              className={field}
              inputMode="tel"
              dir="ltr"
              maxLength={30}
              value={v.phone}
              onChange={(e) => setV({ ...v, phone: e.target.value })}
              placeholder="05xxxxxxxx"
            />
          </label>
          {kind === "call" && (
            <label className="block text-xs font-bold">
              الطلب
              <input className={field} maxLength={200} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm font-bold text-[#9A3412]">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="mt-4">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-[#D5DED9] px-4 text-sm font-bold text-[#185045]">
            إلغاء
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(v)}
            className="min-h-11 rounded-xl bg-[#185045] px-4 text-sm font-bold text-white disabled:opacity-40"
          >
            ابدأ
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
