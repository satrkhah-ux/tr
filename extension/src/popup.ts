import { apiGet, type Me } from "./api";
import { BASE } from "./config";
import { LINK_PATH } from "../../src/lib/ext/protocol";
import { esc } from "./html";

/** The toolbar popup: who this device is linked to, open the side panel, link or unlink. */
const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function show() {
  const me = await apiGet<Me>("/api/ext/me");
  // a system that did not answer is not «unlinked»: the token stays, and so do the buttons
  const linked = me.ok || (me.error !== "unlinked" && me.error !== "inactive");
  $("state").innerHTML = me.ok
    ? `<div class="ok">مربوطة بحساب</div><div class="who">${esc(me.name || "موظف")}</div>`
    : me.error === "unlinked"
      ? `<div class="warn">الإضافة غير مربوطة بحسابك بعد.</div><div class="muted">افتح صفحة الربط في النظام واضغط «اربط هذا المتصفح».</div>`
      : me.error === "inactive"
        ? `<div class="warn">حسابك غير نشط في النظام — راجع الإدارة.</div>`
        : `<div class="warn">تعذّر الوصول إلى النظام الآن — حاول بعد قليل.</div>`;
  $("panel").hidden = !linked;
  $("unlink").hidden = !linked;
  $("link").textContent = linked ? "صفحة الأجهزة المربوطة" : "اربط الإضافة بحسابك";
}

$("link").addEventListener("click", () => void chrome.tabs.create({ url: `${BASE}${LINK_PATH}` }));
$("panel").addEventListener("click", async () => {
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
  window.close();
});
$("unlink").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "unlink" });
  await show();
});

void show();
