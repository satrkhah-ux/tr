/**
 * «العملاء» → شيت المحادثات: يكتب في الشيت كل محادثة تُسجَّل أو تُعدَّل في النظام.
 *
 * التركيب (مرة واحدة، من صاحب الشيت):
 *  1. افتح الشيت ← Extensions / الإضافات ← Apps Script، والصق هذا الملف كاملاً.
 *  2. Project Settings ← Script properties ← أضف SECRET بقيمة سرّية طويلة.
 *  3. Deploy ← New deployment ← Web app: Execute as = Me، Who has access = Anyone.
 *  4. أرسل رابط الـ Web app وقيمة SECRET للمطوّر؛ يوضعان في الخادم:
 *     LEADS_SHEET_WEBHOOK=<الرابط>   LEADS_SHEET_SECRET=<القيمة>
 *
 * يجد الصف بنفس مفتاح النظام (الهاتف | الاستفسار | الدولة | المستلم)، وإن لم
 * يجده أضاف صفاً في آخر الشيت. لا يحذف شيئاً أبداً.
 */

function fold_(s) {
  return String(s || "").replace(/\s+/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ـ/g, "");
}

function phone_(raw) {
  var d = String(raw || "").replace(/[٠-٩]/g, function (c) { return "٠١٢٣٤٥٦٧٨٩".indexOf(c); }).replace(/\D/g, "");
  if (d.indexOf("00") === 0) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = "966" + d.slice(1);
  else if (/^5\d{8}$/.test(d)) d = "966" + d;
  return d;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  if (!body.secret || body.secret !== PropertiesService.getScriptProperties().getProperty("SECRET")) return out_({ ok: false, error: "secret" });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var values = sheet.getDataRange().getValues();
    var header = values[0].map(fold_);
    var col = {};
    Object.keys(body.headers).forEach(function (f) { col[f] = header.indexOf(fold_(body.headers[f])); });
    if (col.phone < 0) return out_({ ok: false, error: "no phone column" });
    var cell = function (row, f) { return col[f] >= 0 ? String(row[col[f]] || "").trim() : ""; };

    var at = -1;
    if (body.key) {
      for (var i = 1; i < values.length; i++) {
        var key = [phone_(cell(values[i], "phone")), cell(values[i], "inquiry"), cell(values[i], "destination"), cell(values[i], "received_by")].join("|");
        if (key === body.key) { at = i + 1; break; }
      }
    }
    if (at < 0) at = sheet.getLastRow() + 1;
    Object.keys(body.cells).forEach(function (f) {
      if (col[f] < 0) return;
      var range = sheet.getRange(at, col[f] + 1);
      // the phone as text, or the sheet drops its leading 0
      if (f === "phone") range.setNumberFormat("@");
      range.setValue(body.cells[f]);
    });
    return out_({ ok: true, row: at });
  } finally {
    lock.releaseLock();
  }
}
