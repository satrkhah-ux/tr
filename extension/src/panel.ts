import { apiGet, type Me } from "./api";
import { BASE } from "./config";
import { LINK_PATH } from "../../src/lib/ext/protocol";
import { esc } from "./html";

/**
 * The side panel. Stage 0: who it is linked to. Stage 1 fills it with the
 * client of the Teletel conversation open beside it.
 */
const root = document.getElementById("root") as HTMLElement;

async function show() {
  const me = await apiGet<Me>("/api/ext/me");
  if (!me.ok) {
    root.innerHTML =
      me.error === "unlinked"
        ? `<div class="card"><div class="warn">الإضافة غير مربوطة بحسابك.</div><div class="row"><a class="btn" href="${BASE}${LINK_PATH}" target="_blank" rel="noopener">اربطها من النظام</a></div></div>`
        : me.error === "inactive"
          ? `<div class="card warn">حسابك غير نشط في النظام — راجع الإدارة.</div>`
          : `<div class="card warn">تعذّر الوصول إلى النظام الآن — حاول بعد قليل.</div>`;
    return;
  }
  root.innerHTML = `
    <div class="card"><div class="muted">مربوطة بحساب</div><div class="who">${esc(me.name || "موظف")}</div></div>
    <div class="card muted">افتح محادثة عميل في تيلي تيل وسيظهر ملفه هنا.</div>`;
}

// linked or unlinked from the popup or the system page while the panel is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "token" in changes) void show();
});

void show();
