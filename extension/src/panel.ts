import { apiGet, apiPost, type Me } from "./api";
import { BASE, TELETEL } from "./config";
import { LINK_PATH } from "../../src/lib/ext/protocol";
import { esc } from "./html";
import { conversationOf } from "./teletel-url";
import { renderCapture, type Capture } from "./panel-capture";

/**
 * The side panel: the client of the Teletel conversation open in this window —
 * who they are, Murad's reading and the follow-up due, this employee's own
 * reminders and note, their files and visa files. «أدرج الرد المقترح» puts the
 * suggested reply in Teletel's reply box for the employee to read and send; the
 * panel itself never sends anything to a client.
 */
type Panel = {
  ok: true;
  conversationId: number;
  client: { name: string; phone: string; destination: string; inquiry: string; holder: string; open: boolean; returning: boolean; hasFile: boolean } | null;
  followup: { stage: string; step: string | null; nextAt: string | null; holder: string; mine: boolean; waitingOn: "client" | "us" | null; wants: string; next: string; heat: string; draft: string } | null;
  reminders: { id: number; text: string; dueAt: string }[];
  note: string;
  files: { id: string; serial: string | null; title: string; destination: string; stateLabel: string; stale: boolean; url: string }[];
  visas: { serial: string; status: string; country: string }[];
  can: { remind: boolean; files: boolean };
};

const root = document.getElementById("root") as HTMLElement;
let shown: { tabId: number; id: number } | null = null;
/** the capture on screen (its tab and when it was made) — a new press replaces it */
let shownCapture: string | null = null;

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }).format(new Date(iso)) : "";

/** The capture to show: this tab's, else the newest of the last ten minutes made in a popup window. */
async function captureFor(tabId: number | undefined): Promise<{ key: string; cap: Capture & { at: number } } | null> {
  const all = (await chrome.storage.session.get(null)) as Record<string, unknown>;
  const own = tabId !== undefined ? (all[`cap:${tabId}`] as (Capture & { at: number }) | undefined) : undefined;
  if (own) return { key: `cap:${tabId}`, cap: own };
  const recent = Object.entries(all)
    .filter(([k, v]) => k.startsWith("cap:") && typeof (v as { at?: unknown })?.at === "number" && Date.now() - (v as { at: number }).at < 10 * 60_000)
    .sort((a, b) => (b[1] as { at: number }).at - (a[1] as { at: number }).at);
  for (const [k, v] of recent) {
    const win = await chrome.tabs
      .get(Number(k.slice(4)))
      .then((t) => chrome.windows.get(t.windowId))
      .catch(() => null);
    if (win?.type === "popup") return { key: k, cap: v as Capture & { at: number } };
  }
  return null;
}

/** this window's active tab */
async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const win = await chrome.windows.getCurrent();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab ?? null;
}

async function refresh(force = false) {
  const first = await activeTab();
  const now = conversationOf(first?.url, TELETEL);
  // another conversation (or none) than the one on screen: its buttons go at once, before anything is fetched —
  // a reply must never be inserted into the conversation the tab has just moved to
  if (shown && (!now || now.id !== shown.id || first?.id !== shown.tabId)) {
    shown = null;
    root.innerHTML = `<span class="muted">…</span>`;
  }
  const me = await apiGet<Me>("/api/ext/me");
  if (!me.ok) {
    shown = null;
    root.innerHTML =
      me.error === "unlinked"
        ? `<div class="card"><div class="warn">الإضافة غير مربوطة بحسابك.</div><div class="row"><a class="btn" href="${BASE}${LINK_PATH}" target="_blank" rel="noopener">اربطها من النظام</a></div></div>`
        : me.error === "inactive"
          ? `<div class="card warn">حسابك غير نشط في النظام — راجع الإدارة.</div>`
          : `<div class="card warn">تعذّر الوصول إلى النظام الآن — حاول بعد قليل.</div>`;
    return;
  }
  const tab = await activeTab();
  const conv = conversationOf(tab?.url, TELETEL);
  const c = conv && tab?.id !== undefined ? { tabId: tab.id, ...conv } : null;
  if (!c) {
    shown = null;
    // a hotel price captured in this tab — or in a popup window «قارن» opened beside the system (it has no panel)
    const found = await captureFor(tab?.id);
    if (found) {
      const mark = `${found.key}:${found.cap.at}`;
      if (!force && shownCapture === mark) return;
      shownCapture = mark;
      return renderCapture(root, found.cap, () => shownCapture === mark, () => void refresh(true));
    }
    shownCapture = null;
    root.innerHTML = `
      <div class="card"><div class="muted">مربوطة بحساب</div><div class="who">${esc(me.name || "موظف")}</div></div>
      <div class="card muted">افتح محادثة عميل في تيلي تيل وسيظهر ملفه هنا.</div>
      <div class="card muted">على أجودا أو المسافر أو Booking: حدّد السعر بالماوس واضغط «أرسل السعر إلى الملف».</div>`;
    return;
  }
  shownCapture = null;
  if (!force && shown && shown.tabId === c.tabId && shown.id === c.id) return;
  shown = { tabId: c.tabId, id: c.id };
  root.innerHTML = `<span class="muted">جارٍ جلب ملف العميل…</span>`;
  const r = await apiGet<Panel>(`/api/ext/conversation/${c.id}?acc=${encodeURIComponent(c.account)}`);
  if (shown?.id !== c.id) return; // moved to another conversation meanwhile
  if (!r.ok) {
    // not kept as shown: the next look (or «أعد المحاولة») asks again
    shown = null;
    root.innerHTML = `<div class="card warn">${
      r.error === "forbidden" ? "لا تملك صلاحية عرض ملفات العملاء." : r.error === "other_account" ? "هذه المحادثة من حساب تيلي تيل آخر." : "تعذّر جلب ملف العميل الآن."
    }</div><div class="row"><button class="small" id="retry">أعد المحاولة</button></div>`;
    document.getElementById("retry")?.addEventListener("click", () => void refresh(true));
    return;
  }
  render(r);
}

function render(p: Panel) {
  const cl = p.client;
  const f = p.followup;
  const parts: string[] = [];

  parts.push(
    cl
      ? `<div class="card">
          <div class="name">${esc(cl.name || "عميل")}</div>
          ${cl.phone ? `<div class="phone">+${esc(cl.phone)}</div>` : ""}
          ${cl.destination ? `<div class="line"><b>الوجهة:</b> ${esc(cl.destination)}</div>` : ""}
          ${cl.inquiry ? `<div class="line muted">${esc(cl.inquiry)}</div>` : ""}
          <div class="chips">
            ${cl.returning ? `<span class="chip gold">عميل سابق</span>` : ""}
            ${cl.open ? "" : `<span class="chip red">مغلقة</span>`}
            ${cl.holder ? `<span class="chip">مع ${esc(cl.holder)}</span>` : ""}
          </div>
        </div>`
      : `<div class="card"><div class="warn">لا سجل لهذا العميل في «العملاء» بعد.</div><div class="muted">تُسحب المحادثات الجديدة كل دقيقتين.</div></div>`,
  );

  if (f) {
    parts.push(`<div class="card">
      <h3>المتابعة</h3>
      <div class="chips">
        ${f.stage ? `<span class="chip">${esc(f.stage)}</span>` : ""}
        ${f.step ? `<span class="chip">${esc(f.step)}</span>` : ""}
        ${f.heat ? `<span class="chip gold">${esc(f.heat)}</span>` : ""}
        ${f.holder ? `<span class="chip">${f.mine ? "معك" : `مع ${esc(f.holder)}`}</span>` : ""}
      </div>
      ${f.nextAt ? `<div class="line muted">المتابعة القادمة: ${esc(when(f.nextAt))}</div>` : ""}
      ${f.wants ? `<div class="line"><b>أراد:</b> ${esc(f.wants)}</div>` : ""}
      ${f.next ? `<div class="line"><b>المقترح:</b> ${esc(f.next)}</div>` : ""}
      ${f.waitingOn === "us" ? `<div class="line"><span class="chip red">العميل ينتظر ردنا</span></div>` : ""}
      ${
        f.draft
          ? `<div class="draft" id="draft">${esc(f.draft)}</div>
             <div class="row"><button class="primary small" id="insert">أدرج الرد المقترح</button><button class="small" id="copy">انسخه</button></div>
             <div class="status" id="draftStatus"></div>`
          : ""
      }
    </div>`);
  }

  if (p.can.remind) {
    parts.push(`<div class="card">
      <h3>تذكيراتي وملاحظتي</h3>
      ${
        p.reminders.length
          ? `<ul class="list" id="reminders">${p.reminders.map((r) => `<li><span class="grow">${esc(when(r.dueAt))}${r.text ? ` — ${esc(r.text)}` : ""}</span></li>`).join("")}</ul>`
          : `<div class="muted" id="reminders">لا تذكير على هذه المحادثة.</div>`
      }
      <input type="text" id="remindText" maxlength="500" placeholder="ذكّرني بـ… (اختياري)" style="margin-top:8px" />
      <div class="row">
        <button class="small" data-remind="hour">بعد ساعة</button>
        <button class="small" data-remind="tomorrow">غداً 10 ص</button>
        <button class="small" data-remind="three">بعد 3 أيام</button>
      </div>
      <textarea id="note" rows="2" maxlength="1000" placeholder="ملاحظة لنفسك عن هذا العميل" style="margin-top:10px">${esc(p.note)}</textarea>
      <div class="row"><button class="small" id="saveNote">احفظ الملاحظة</button></div>
      <div class="status" id="mineStatus"></div>
    </div>`);
  }

  if (p.can.files) {
    parts.push(`<div class="card">
      <h3>ملفاته</h3>
      ${
        p.files.length
          ? `<ul class="list">${p.files
              .map(
                (x) => `<li><span class="grow"><a href="${BASE}${esc(x.url)}" target="_blank" rel="noopener">${esc(x.serial || x.title)}</a>${x.destination ? ` · ${esc(x.destination)}` : ""}</span>
                  <span class="chip">${esc(x.stateLabel)}</span>${x.stale ? `<span class="chip red">نسخة أحدث لم تُرسل</span>` : ""}</li>`,
              )
              .join("")}</ul>`
          : `<div class="muted">لا ملف لهذا العميل بعد.</div>`
      }
      <div class="row"><a class="btn" href="${BASE}/extension/start/${p.conversationId}" target="_blank" rel="noopener">${cl?.hasFile ? "افتح ملف المحادثة" : "عرض جديد لهذا العميل"}</a></div>
    </div>`);
  }

  if (p.visas.length) {
    parts.push(`<div class="card"><h3>ملفات التأشيرة</h3><ul class="list">${p.visas
      .map((v) => `<li><span class="grow">${esc(v.serial)} · ${esc(v.country)}</span><span class="chip">${esc(v.status)}</span></li>`)
      .join("")}</ul></div>`);
  }

  root.innerHTML = parts.join("");
  wire(p);
}

function say(id: string, ok: boolean, text: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status ${ok ? "ok" : "bad"}`;
  el.textContent = text;
}

/** «غداً 10 ص» in Riyadh, whatever this computer's zone */
function tomorrowTen(): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(Date.now() + 86_400_000);
  return new Date(`${day}T10:00:00+03:00`).toISOString();
}

function wire(p: Panel) {
  const draft = p.followup?.draft ?? "";
  document.getElementById("insert")?.addEventListener("click", async () => {
    if (!shown) return;
    const r = (await chrome.tabs.sendMessage(shown.tabId, { type: "insert-reply", conversationId: p.conversationId, text: draft }).catch(() => null)) as { ok?: boolean; moved?: boolean } | null;
    if (r?.ok) return say("draftStatus", true, "أُدرج في مربع الكتابة — راجعه ثم أرسله بنفسك.");
    // the tab shows another conversation now: nothing is inserted, nothing copied
    if (r?.moved) {
      say("draftStatus", false, "انتقلت إلى محادثة أخرى — لم يُدرج شيء.");
      return void refresh(true);
    }
    // the reply box was not found (or the tab predates the extension): the text goes to the clipboard instead
    const copied = await navigator.clipboard.writeText(draft).then(() => true, () => false);
    say("draftStatus", copied, copied ? "لم أجد مربع الكتابة — نُسخ الرد، الصقه فيه." : "تعذّر إدراج الرد — انسخه يدوياً.");
  });
  document.getElementById("copy")?.addEventListener("click", async () => {
    const copied = await navigator.clipboard.writeText(draft).then(() => true, () => false);
    say("draftStatus", copied, copied ? "نُسخ الرد." : "تعذّر النسخ.");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-remind]").forEach((b) =>
    b.addEventListener("click", async () => {
      const kind = b.dataset.remind;
      const dueAt = kind === "hour" ? new Date(Date.now() + 3_600_000).toISOString() : kind === "tomorrow" ? tomorrowTen() : new Date(Date.now() + 3 * 86_400_000).toISOString();
      const text = (document.getElementById("remindText") as HTMLInputElement | null)?.value ?? "";
      b.disabled = true;
      const r = await apiPost(`/api/ext/conversation/${p.conversationId}/remind`, { dueAt, text });
      b.disabled = false;
      say("mineStatus", r.ok, r.ok ? `سأذكّرك ${when(dueAt)} عبر «تنبيهاتي».` : "تعذّر حفظ التذكير — حاول مرة أخرى.");
      if (!r.ok) return;
      const list = document.getElementById("reminders");
      if (list) list.outerHTML = `<ul class="list" id="reminders">${[...p.reminders, { id: 0, text, dueAt }]
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .map((x) => `<li><span class="grow">${esc(when(x.dueAt))}${x.text ? ` — ${esc(x.text)}` : ""}</span></li>`)
        .join("")}</ul>`;
      p.reminders.push({ id: 0, text, dueAt });
      const input = document.getElementById("remindText") as HTMLInputElement | null;
      if (input) input.value = "";
    }),
  );
  document.getElementById("saveNote")?.addEventListener("click", async () => {
    const note = (document.getElementById("note") as HTMLTextAreaElement | null)?.value ?? "";
    const r = await apiPost(`/api/ext/conversation/${p.conversationId}/note`, { note });
    say("mineStatus", r.ok, r.ok ? "حُفظت الملاحظة." : "تعذّر حفظ الملاحظة — حاول مرة أخرى.");
  });
}

// the panel follows the tab: another conversation, another tab, linked or unlinked meanwhile
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.url !== undefined || info.status === "loading")) void refresh();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "token" in changes) void refresh(true);
  // a new capture (the panel may already be open beside the hotel's page)
  if (area === "session" && Object.keys(changes).some((k) => k.startsWith("cap:") && changes[k].newValue)) void refresh();
});

void refresh();
