/**
 * «أرسل الخطأ لمُراد» (the owner, 2026-10-29: «عندما يظهر خطأ يمكن إرساله إلى
 * السكرتير كي يوضح له السبب») — the pure part: what of an error may travel to
 * مُراد and to the administration, and what our own known texts mean.
 *
 * Only the user-facing message, the page, the action's name and the time ever
 * leave the browser — never a stack trace, a token, a key, an e-mail address
 * or a phone number. The server cleans it again: the browser is not trusted.
 */

export type ErrorReport = { message: string; route: string; action: string | null; at: string };

/** a stack frame, a file path with a line, or a Next.js internal line */
const STACK_LINE = /^\s*(at\s|.*\(.*:\d+:\d+\)|.*\.(?:tsx?|jsx?|mjs):\d+|digest[:=])/i;

const SECRET_PATTERNS: RegExp[] = [
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, // a JWT
  /\b(?:Bearer|Basic|Token)\s+[\w.~+/=-]{8,}/gi,
  /\b(?:sk|pk|rk|key|api|token|secret)[_-][\w-]{8,}/gi, // sk_live_…, api-…
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // an e-mail
  /\+?\d[\d\s-]{7,}\d/g, // a phone (8+ digits)
  /\b[A-Fa-f0-9]{32,}\b/g, // a hex key or hash
  /\b[A-Za-z0-9+/_-]{40,}={0,2}/g, // a long base64 blob
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** one message: no stack lines, no secrets, no personal data, at most 400 characters */
export function cleanErrorMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw
    .split(/\r?\n/)
    .filter((line) => line.trim() && !STACK_LINE.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  for (const re of SECRET_PATTERNS) text = text.replace(re, "•••");
  return clip(text, 400);
}

/** the page without its query or hash (a link may carry a token or a client's name), ids kept only as «:id» */
export function cleanRoute(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  const path = raw.split(/[?#]/)[0]
    .split("/")
    .map((part) => (/^[0-9a-f-]{20,}$/i.test(part) || /^\d{3,}$/.test(part) ? ":id" : part))
    .join("/");
  return clip(path.replace(/[^\w/:\-؀-ۿ]/g, ""), 120) || "/";
}

export function cleanErrorReport(raw: unknown): ErrorReport | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const message = cleanErrorMessage(r.message);
  if (!message) return null;
  const action = typeof r.action === "string" && /^[\w.:-]{1,60}$/.test(r.action) ? r.action : null;
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : new Date().toISOString();
  return { message, route: cleanRoute(r.route), action, at };
}

/**
 * One report per occurrence: the same employee sending the same error from the
 * same page within the same minute is one row, however often they press.
 */
export function errorDedupeKey(employeeId: string, r: ErrorReport): string {
  const minute = r.at.slice(0, 16);
  let h = 0;
  for (const ch of `${r.route}|${r.action ?? ""}|${r.message}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `err:${employeeId}:${minute}:${(h >>> 0).toString(36)}`;
}

/**
 * Our own texts first: what the employee most often meets, said plainly.
 * First match wins — the specific before the general.
 */
const KNOWN: { test: RegExp; cause: string; todo: string }[] = [
  { test: /نُشر تحديث|ربما تحدّث النظام/, cause: "نُشر تحديث للنظام وصفحتك ما زالت على النسخة القديمة.", todo: "احفظ ما تستطيع ثم أعد تحميل الصفحة وأعد المحاولة." },
  { test: /لم تتأكد نتيجة الإرسال|لم نؤكد نجاح العملية/, cause: "لم نتأكد هل وصلت الرسالة للعميل أم لا.", todo: "لا تعد الإرسال — اضغط «تحقق من الإرسال» أو افتح المحادثة في تيلي تيل." },
  { test: /24 ساعة/, cause: "مرّت 24 ساعة على آخر رسالة من العميل فلا تصله رسالة حرة عبر واتساب.", todo: "اتصل بالعميل ثم سجّل النتيجة، أو أرسل القالب المعتمد إن وُجد." },
  { test: /أصلح الأخطاء المانعة|ما ينقص قبل الإصدار/, cause: "بقيت نواقص تمنع إصدار العرض.", todo: "افتح قسم «الإصدار» في الملف: كل سطر ناقص بجانبه زر «إكمال» يأخذك إليه." },
  { test: /ملف زميل|ليس من ملفاتك|يتصرف فيه صاحبه/, cause: "هذا الملف لزميل آخر.", todo: "يتصرف فيه صاحبه أو قسم العمليات؛ إن كان يجب أن يكون لك فاطلب إسناده من مديرك." },
  { test: /لقسم العمليات/, cause: "هذه الخطوة (إلغاء، استرجاع، تعديل دفعة…) لقسم العمليات فقط.", todo: "اطلبها من قسم العمليات أو مديرك." },
  { test: /قاعدة البيانات|تعذّر تحميل البيانات/, cause: "تعذّر الوصول لقاعدة البيانات لحظتها.", todo: "أعد المحاولة بعد قليل؛ إن تكرر أبلغ الإدارة." },
  { test: /سجّل الدخول|سجل الدخول|تسجيل الدخول|انتهت الجلسة|not signed in|unauthori[sz]ed|\b401\b/i, cause: "انتهت جلستك أو لم تسجّل الدخول.", todo: "حدّث الصفحة، وإن طُلب منك سجّل الدخول من جديد ثم أعد المحاولة." },
  { test: /لا صلاحية|لا تملك صلاحية|ليس لديك صلاحية|غير مصرّح|ليست لديك صلاحية|forbidden|permission|\b403\b/i, cause: "هذه العملية تحتاج صلاحية ليست في حسابك.", todo: "إن كانت من عملك فاطلب الصلاحية من مديرك — لا يستطيع مُراد منحها." },
  { test: /حد أسئلة اليوم|rate.?limit|too many|\b429\b|حاولت كثيراً/i, cause: "وصلت حدّ المحاولات المسموح لهذا الوقت.", todo: "انتظر قليلاً (أو حتى الغد لحد أسئلة مُراد) ثم أعد المحاولة." },
  { test: /بيانات الفندق|اسم الفندق|غير موجود في البيانات|لا يوجد في البيانات|بيانات ناقصة|catalog/i, cause: "معلومة ناقصة في بيانات النظام (فندق أو مدينة أو سعر لم يُدخل بعد).", todo: "أكمل ما تقدر عليه — النقص في البيانات يصل لفريق البيانات، وإن كان عاجلاً الفندق الناقص تضيفه من حقل «الفندق» في /basic («＋ أضف … فندقاً جديداً»)، والمدينة من «أخرى — إضافة جديد»، أو اطلب من مديرك." },
  { test: /تاريخ|التواريخ|\bdates?\b/i, cause: "تاريخ ناقص أو غير منطقي (مثلاً المغادرة قبل الوصول، أو ليالٍ لا تطابق الرحلة).", todo: "راجع تواريخ الرحلة والفنادق والرحلات الجوية في الملف ثم احفظ مرة أخرى." },
  { test: /مطلوب|required|اكتب|اختر|أدخل|فارغ|empty/i, cause: "حقل مطلوب لم يُعبّأ.", todo: "ابحث في الصفحة عن الحقل المعلَّم أو الفارغ، عبّئه ثم أعد الحفظ." },
  { test: /غير صالح|غير صحيح|invalid|صيغة/i, cause: "قيمة مكتوبة بصيغة لا يقبلها النظام (رقم أو تاريخ أو رابط).", todo: "صحّح القيمة (أرقام بلا رموز، تاريخ من التقويم) ثم أعد المحاولة." },
  { test: /تيلي ?تيل|teletel|chatwoot/i, cause: "تعذّر الاتصال بمنصة المحادثات تيلي تيل لحظتها.", todo: "أعد المحاولة بعد دقيقة؛ إن تكرر أبلغ الإدارة — رسالة العميل لم تُرسل." },
  { test: /myfatoorah|ماي ?فاتورة|tamara|تمارا|tabby|تابي|الدفع|payment/i, cause: "مزوّد الدفع لم يقبل الطلب لحظتها (ربط الدفع أو مفتاحه).", todo: "لا تعطِ العميل رابطاً بديلاً من عندك؛ أعد المحاولة ثم أبلغ الإدارة إن تكرر." },
  { test: /موقوف|معطّل|disabled|paused/i, cause: "هذه الخدمة موقوفة حالياً من الإدارة.", todo: "تابع يدوياً، واسأل مديرك متى تعود." },
  { test: /تعذّر الاتصال|تعذر الاتصال|network|fetch failed|timeout|انتهت المهلة|offline/i, cause: "انقطع الاتصال بالخادم لحظتها (الإنترنت أو بطء مؤقت).", todo: "تأكد من الإنترنت، حدّث الصفحة ثم أعد المحاولة. ما حفظته قبل الخطأ باقٍ." },
  { test: /تعذّر الحفظ|تعذر الحفظ|could not save|failed to save/i, cause: "لم يُحفظ التعديل الأخير.", todo: "انسخ ما كتبته احتياطاً، حدّث الصفحة وأعد الحفظ؛ إن تكرر أبلغ الإدارة." },
];

export type KnownExplanation = { cause: string; todo: string };

export function explainKnownError(message: string): KnownExplanation | null {
  const k = KNOWN.find((x) => x.test.test(message));
  return k ? { cause: k.cause, todo: k.todo } : null;
}

export function renderKnown(k: KnownExplanation): string {
  return `السبب المحتمل: ${k.cause}\nماذا تفعل: ${k.todo}\nإن لم ينحل اضغط «أبلغ الإدارة».`;
}

/** the user's line in مُراد's chat — the same text the model reads */
export function errorQuestion(r: ErrorReport): string {
  return `ظهر لي خطأ: «${r.message}» — الصفحة ${r.route}${r.action ? ` — العملية ${r.action}` : ""}. ما السبب وماذا أفعل؟`;
}
