"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import jsQR from "jsqr";
import { Camera, CheckCircle2, CircleX, Clock, ScanLine } from "lucide-react";
import { lookupCoupon, redeemCoupon, type ScanResult } from "@/lib/data/discounts-actions";
import { card, field } from "./Campaigns";

/**
 * «قارئ الكوبونات»: the employee opens the system on their phone, points the camera at the client's QR
 * (or types the code), sees the coupon in the client's name and number, and presses «اعتمد الخصم» —
 * once. A used coupon reads back red, with who used it and when.
 */
export function CouponScanner({ initial }: { initial: string | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<"off" | "on" | "denied">("off");
  const [code, setCode] = useState("");
  const [ref, setRef] = useState("");
  const [coupon, setCoupon] = useState<ScanResult | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const look = useCallback((raw: string) => {
    start(async () => {
      const r = await lookupCoupon(raw);
      setDone(false);
      setRef("");
      if (r.ok) { setCoupon(r.coupon); setError(""); }
      else { setCoupon(null); setError(r.error); }
    });
  }, []);

  useEffect(() => {
    if (initial) look(initial);
  }, [initial, look]);

  // the camera: the back one, a frame read every animation tick until a QR shows up
  useEffect(() => {
    if (camera !== "on") return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const tick = () => {
      const v = video.current;
      const c = canvas.current;
      if (stopped || !v || !c) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA) {
        const w = Math.min(640, v.videoWidth);
        const h = Math.round((v.videoHeight / v.videoWidth) * w);
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, w, h);
          const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          if (hit?.data) {
            navigator.vibrate?.(80);
            setCamera("off");
            look(hit.data);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (stopped || !video.current) return s.getTracks().forEach((t) => t.stop());
        video.current.srcObject = s;
        void video.current.play();
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setCamera("denied"));
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, look]);

  const redeem = () =>
    start(async () => {
      if (!coupon) return;
      const r = await redeemCoupon(coupon.id, ref);
      if (r.ok) { setCoupon(r.coupon); setDone(true); setError(""); }
      else {
        setError(r.error);
        const again = await lookupCoupon(coupon.code);
        if (again.ok) setCoupon(again.coupon);
      }
    });

  const tone = !coupon ? "" : coupon.state === "valid" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" : coupon.state === "used" ? "border-red-500 bg-red-50 dark:bg-red-950/40" : "border-amber-500 bg-amber-50 dark:bg-amber-950/40";

  return (
    <div dir="rtl" className="tv-fade-up mx-auto max-w-md space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-extrabold text-tv-text-strong"><ScanLine className="size-6" />قارئ الكوبونات</h1>

      <section className={card}>
        {camera === "on" ? (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={video} playsInline muted className="aspect-square w-full object-cover" />
            <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/85 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
            <button type="button" onClick={() => setCamera("off")} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-[13px] font-bold text-black">إغلاق الكاميرا</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setCamera("on"); setCoupon(null); setError(""); }}
            className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-tv-action-primary text-tv-text-brand">
            <Camera className="size-9" />
            <span className="text-[15px] font-extrabold">امسح كوبون العميل</span>
            <span className="text-[12px] font-semibold text-tv-text-faint">وجّه الكاميرا إلى رمز QR في كوبونه</span>
          </button>
        )}
        {camera === "denied" && <p role="alert" className="mt-2 text-[12.5px] font-bold text-tv-status-danger">لم يُسمح بالكاميرا. اسمح بها من إعدادات المتصفح، أو اكتب الكود.</p>}
        <canvas ref={canvas} className="hidden" />
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) look(code); }} className="mt-3 flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="أو اكتب الكود: TRV-XXXXXX" dir="ltr" className={`${field} font-mono`} />
          <button type="submit" disabled={pending || !code.trim()} className="min-h-10 shrink-0 rounded-lg bg-tv-action-primary px-4 text-[13px] font-extrabold text-tv-action-on-primary disabled:opacity-50">تحقق</button>
        </form>
      </section>

      {pending && !coupon && <p className="text-center text-[13px] font-bold text-tv-text-faint">يتحقق…</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-center text-[13.5px] font-extrabold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {coupon && (
        <section className={`rounded-2xl border-2 p-4 ${tone}`}>
          <div className="flex items-center gap-2 text-[16px] font-extrabold">
            {coupon.state === "valid" ? <CheckCircle2 className="size-6 text-emerald-600" /> : coupon.state === "used" ? <CircleX className="size-6 text-red-600" /> : <Clock className="size-6 text-amber-600" />}
            <span className="text-tv-text-strong">
              {done ? "تم اعتماد الخصم" : coupon.state === "valid" ? "كوبون صالح" : coupon.state === "used" ? "الكوبون مستخدم مسبقاً" : "انتهت صلاحية الكوبون"}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
            <dt className="font-bold text-tv-text-faint">العميل</dt><dd className="font-extrabold text-tv-text-strong">{coupon.name ?? "—"}</dd>
            <dt className="font-bold text-tv-text-faint">الجوال</dt><dd className="font-bold text-tv-text-strong tabular-nums" dir="ltr">{coupon.phone}</dd>
            <dt className="font-bold text-tv-text-faint">الخصم</dt><dd className="text-lg font-extrabold text-tv-text-brand">{coupon.discount} <span className="text-[12px] font-bold text-tv-text-muted">{coupon.scope}</span></dd>
            <dt className="font-bold text-tv-text-faint">الكود</dt><dd className="font-mono font-bold" dir="ltr">{coupon.code}</dd>
            <dt className="font-bold text-tv-text-faint">ينتهي</dt><dd className="font-bold">{coupon.expires}</dd>
            {coupon.redeemed_at && (<><dt className="font-bold text-tv-text-faint">استُخدم</dt><dd className="font-bold">{coupon.redeemed_at} · {coupon.redeemed_by ?? ""} · {coupon.redeemed_ref}</dd></>)}
          </dl>
          {coupon.state === "valid" && (
            <div className="mt-4 space-y-2">
              <p className="text-[12.5px] font-bold text-tv-text-muted">تأكد أن رقم جوال العميل الذي أمامك هو نفس الرقم أعلاه.</p>
              <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} placeholder="رقم الملف أو الطلب (مثل AD-...)" className={field} />
              <button type="button" onClick={redeem} disabled={pending || !ref.trim()}
                className="min-h-12 w-full rounded-xl bg-emerald-600 text-[15px] font-extrabold text-white disabled:opacity-50">
                {pending ? "لحظة…" : "اعتمد الخصم (مرة واحدة)"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
