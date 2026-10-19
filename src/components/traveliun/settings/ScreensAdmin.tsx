"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Bell, Copy, ExternalLink, Loader2, Trash2, Upload } from "lucide-react";
import { deleteScreenAd, saveScreens, sendScreensTest, uploadScreenAd } from "@/lib/data/office-screens";
import { SCREEN_KINDS, type ScreensConfig } from "@/lib/office-screens/config";
import { TraveliunShell } from "../TraveliunShell";

/**
 * «الإدارة ← الشاشات» (the owner, 2026-10-19): the office screens' settings,
 * their ads, their links — and a monitor that shows every screen live, side by
 * side like security cameras, in the order they hang on the wall.
 */
const FIELD = "h-9 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#0f3d38] outline-none focus:border-[#2aa87a]";
const CARD = "rounded-[14px] border border-[#cfe0d9] bg-white p-4";
const H = "text-[14px] font-extrabold text-[#0f3d38]";

export function ScreensAdmin({ initial }: { initial: ScreensConfig }) {
  const router = useRouter();
  const [cfg, setCfg] = useState(initial);
  const [orderText, setOrderText] = useState(initial.order.join("، "));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adName, setAdName] = useState("");
  const [adFile, setAdFile] = useState<File | null>(null);
  const [testDest, setTestDest] = useState(initial.ads[0]?.name ?? "تركيا");
  const origin = typeof window === "undefined" ? "https://pkg.traveliun.com" : window.location.origin;
  const active = cfg.ads.filter((a) => a.active).length;

  const run = async (key: string, f: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(key);
    setMsg(null);
    const r = await f();
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? "تعذّر" });
    if (r.ok) router.refresh();
  };
  const save = (next: ScreensConfig, done = "حُفظ — تظهر على الشاشات خلال ثوانٍ") => {
    setCfg(next);
    return run("save", () => saveScreens(next), done);
  };
  const move = (i: number, d: -1 | 1) => {
    const ads = [...cfg.ads];
    const j = i + d;
    if (j < 0 || j >= ads.length) return;
    [ads[i], ads[j]] = [ads[j], ads[i]];
    void save({ ...cfg, ads });
  };
  const order = orderText.split(/[\s,،]+/).map(Number).filter((n) => n > 0);

  return (
    <TraveliunShell title="nav.screens">
      <div className="space-y-4">
        {msg ? (
          <div className={`rounded-[10px] px-3 py-2 text-[12.5px] font-bold ${msg.ok ? "bg-[#e8f6ef] text-[#185045]" : "bg-[#fdecef] text-[#a3263f]"}`}>{msg.text}</div>
        ) : null}

        {/* the monitor — the wall's order, left to right, whatever the page's direction */}
        <section className={CARD}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={H}>المراقبة — ما تعرضه كل شاشة الآن</h2>
            <span className="text-[11.5px] text-[#557d78]">بترتيب تعليقها من اليسار إلى اليمين</span>
          </div>
          <div dir="ltr" className="grid gap-3 sm:grid-cols-2">
            {cfg.order.map((n) => (
              <div key={n} className="overflow-hidden rounded-[10px] border border-[#cfe0d9] bg-black">
                <div dir="rtl" className="flex items-center justify-between bg-[#0a3a33] px-3 py-1.5 text-[12px] font-bold text-white">
                  <span>شاشة {n}</span>
                  <a href={`/${n}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#9fe0c4] hover:underline">
                    فتح <ExternalLink className="size-3.5" />
                  </a>
                </div>
                <div className="relative aspect-video">
                  <iframe title={`شاشة ${n}`} src={`/screen/${n}?monitor=1`} className="absolute inset-0 h-full w-full border-0" loading="lazy" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={CARD}>
          <h2 className={`${H} mb-3`}>الإعدادات</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              عدد الشاشات
              <input type="number" min={1} max={9} value={cfg.screens} onChange={(e) => setCfg({ ...cfg, screens: Number(e.target.value) })} className={FIELD} />
            </label>
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              ترتيبها على الجدار من اليسار إلى اليمين
              <input value={orderText} onChange={(e) => setOrderText(e.target.value)} placeholder="1، 2، 3، 4" dir="ltr" className={FIELD} />
            </label>
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              ثوانٍ لكل إعلان
              <input type="number" min={4} max={120} value={cfg.slotSec} onChange={(e) => setCfg({ ...cfg, slotSec: Number(e.target.value) })} className={FIELD} />
            </label>
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              سرعة الشريط (بكسل في الثانية)
              <input type="number" min={30} max={400} value={cfg.tickerSpeed} onChange={(e) => setCfg({ ...cfg, tickerSpeed: Number(e.target.value) })} className={FIELD} />
            </label>
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              يظهر الشريط كل (دقيقة)
              <input type="number" min={2} max={120} value={cfg.tickerEveryMin} onChange={(e) => setCfg({ ...cfg, tickerEveryMin: Number(e.target.value) })} className={FIELD} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] font-bold text-[#185045]">
            <span>ينبّه «عميل جديد» عند طلب:</span>
            {SCREEN_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={cfg.kinds.includes(k)}
                  onChange={(e) => setCfg({ ...cfg, kinds: e.target.checked ? [...cfg.kinds, k] : cfg.kinds.filter((x) => x !== k) })}
                />
                {k}
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => save({ ...cfg, order })}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
              حفظ
            </button>
            <span className="text-[11.5px] text-[#78948f]">بلا صوت — عرض فقط. الشريط السفلي يظهر مرة كل فترة لعبور واحد على كل الشاشات، ومرة فوراً حين تتغير الدول الأكثر طلباً</span>
          </div>
        </section>

        <section className={CARD}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={H}>الإعلانات ({active} معروض)</h2>
            {active < cfg.screens ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4e0] px-2.5 py-1 text-[11.5px] font-bold text-[#8a5a00]">
                <AlertTriangle className="size-3.5" /> الإعلانات أقل من الشاشات — سيتكرر إعلان على شاشتين
              </span>
            ) : null}
          </div>
          <div className="grid gap-2">
            {cfg.ads.map((a, i) => (
              <div key={a.id} className={`flex flex-wrap items-center gap-3 rounded-[10px] border border-[#e2ebe7] p-2 ${a.active ? "" : "opacity-55"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- pkg's own 1080p copy, cached a year */}
                <img src={`/screen/ad/${a.id}.jpg`} alt={a.name} className="h-[54px] w-[96px] rounded-[6px] bg-black object-contain" />
                <input
                  value={a.name}
                  onChange={(e) => setCfg({ ...cfg, ads: cfg.ads.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)) })}
                  onBlur={() => save(cfg)}
                  className={`${FIELD} w-40`}
                  aria-label="الوجهة"
                />
                <label className="flex items-center gap-1.5 text-[12px] font-bold text-[#185045]">
                  <input type="checkbox" checked={a.active} onChange={(e) => save({ ...cfg, ads: cfg.ads.map((x) => (x.id === a.id ? { ...x, active: e.target.checked } : x)) })} />
                  معروض
                </label>
                <div className="ms-auto flex items-center gap-1">
                  <button type="button" aria-label="أعلى" onClick={() => move(i, -1)} className="rounded-[7px] border border-[#dbe6e1] p-1.5 hover:bg-[#f4f8f6]">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label="أسفل" onClick={() => move(i, 1)} className="rounded-[7px] border border-[#dbe6e1] p-1.5 hover:bg-[#f4f8f6]">
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="حذف"
                    onClick={() => {
                      if (window.confirm(`حذف إعلان «${a.name}»؟`)) void run(`del-${a.id}`, () => deleteScreenAd(a.id), "حُذف الإعلان");
                    }}
                    className="rounded-[7px] border border-[#f0c9d2] p-1.5 text-[#a3263f] hover:bg-[#fdecef]"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-[10px] bg-[#f8fbfa] p-3">
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              الوجهة
              <input value={adName} onChange={(e) => setAdName(e.target.value)} placeholder="تركيا" className={`${FIELD} w-40`} />
            </label>
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              الصورة (jpg / png / webp — حتى 15 م.ب، 16:9)
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setAdFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
            </label>
            <button
              type="button"
              disabled={busy !== null || !adFile}
              onClick={() => {
                const form = new FormData();
                form.append("name", adName);
                if (adFile) form.append("file", adFile);
                void run("upload", () => uploadScreenAd(form), "أُضيف الإعلان").then(() => {
                  setAdName("");
                  setAdFile(null);
                });
              }}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-3 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {busy === "upload" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              إضافة إعلان
            </button>
          </div>
        </section>

        <section className={CARD}>
          <h2 className={`${H} mb-3`}>جرّب الإشعار</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              الوجهة
              <input value={testDest} onChange={(e) => setTestDest(e.target.value)} className={`${FIELD} w-40`} />
            </label>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run("test", () => sendScreensTest(testDest), "أُرسل — يظهر على كل الشاشات بعد ثوانٍ، مكتوباً عليه «تجربة»")}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#2aa87a] px-3 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-50"
            >
              {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
              أرسل تجربة
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-[#78948f]">الإشعار الحقيقي يظهر وحده حين تُصنَّف محادثة جديدة بطلب ووجهة — بالوجهة والنوع فقط، بلا اسم ولا رقم.</p>
        </section>

        <section className={CARD}>
          <h2 className={`${H} mb-3`}>روابط الشاشات</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: cfg.screens }, (_, i) => i + 1).map((n) => (
              <div key={n} className="flex items-center justify-between gap-2 rounded-[10px] border border-[#e2ebe7] px-3 py-2">
                <span className="text-[12.5px] font-bold text-[#185045]">شاشة {n}</span>
                <code dir="ltr" className="text-[12.5px] text-[#0f3d38]">{`${origin.replace(/^https?:\/\//, "")}/${n}`}</code>
                <button
                  type="button"
                  aria-label="نسخ"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`${origin}/${n}`);
                    setMsg({ ok: true, text: `نُسخ رابط الشاشة ${n}` });
                  }}
                  className="rounded-[7px] border border-[#dbe6e1] p-1.5 hover:bg-[#f4f8f6]"
                >
                  <Copy className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className={CARD}>
          <h2 className={`${H} mb-2`}>تشغيل التلفزيون (Android TV)</h2>
          <ol className="list-decimal space-y-1.5 ps-5 text-[12.5px] leading-6 text-[#2f5752]">
            <li>افتح متصفح التلفزيون واكتب رابط الشاشة، مثل: <code dir="ltr">pkg.traveliun.com/1</code> — والثانية <code dir="ltr">/2</code> وهكذا. يبدأ العرض وحده.</li>
            <li>لملء الشاشة: اضغط أي زر في الريموت مرة واحدة بعد فتح الصفحة — أو شغّل وضع ملء الشاشة من قائمة متصفح التلفزيون إن وُجد.</li>
            <li>اترك الصفحة مفتوحة — أغلب متصفحات التلفزيون تعيد آخر صفحة عند التشغيل.</li>
            <li>أوقف شاشة التوقف والسكون: الإعدادات ← تفضيلات الجهاز ← شاشة التوقف (وكذلك الطاقة / السكون) ← «أبداً».</li>
            <li>رتّب أرقام الشاشات هنا كما هي معلّقة على الجدار من اليسار إلى اليمين، فتنتقل الإعلانات والشريط من شاشة إلى التي بجانبها.</li>
            <li>إن ظهرت صفحة خطأ بعد انقطاع الإنترنت، اضغط تحديث في المتصفح مرة واحدة.</li>
          </ol>
        </section>
      </div>
    </TraveliunShell>
  );
}
