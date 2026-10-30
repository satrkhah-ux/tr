# مواصفة المكوّن: الزر (Button) — مقترح، غير مُنفَّذ

## الغرض
تنفيذ فعل (حفظ، إرسال، إضافة). لا يُستعمل للتنقل بين الصفحات (رابط `<a>`/`Link`)، ولا كشارة حالة.

## البنية
- نص الفعل (فعل أمر قصير: «احفظ»، «أرسل للعميل»)
- اختياري: أيقونة قبل النص، مؤشر تحميل يحل محل الأيقونة

## الخصائص
| الخاصية | القيم | الافتراضي | ملاحظات |
|---|---|---|---|
| variant | primary، secondary، ghost، danger | secondary | primary واحد لكل منطقة |
| size | sm (h-8)، md (h-9)، lg (h-11) | md | على الهاتف: lg (44px) للأفعال الرئيسية |

الألوان الحالية المرصودة:
- primary: `bg-[#185045] text-white` (262) → `bg-tv-action-primary text-tv-action-on-primary`
- secondary: `border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]` (48+) → `border-tv-border-default bg-tv-surface-raised text-tv-text-brand hover:bg-tv-surface-sunken`
- danger: `text-[#c22850]` على `#fdeef2` → `text-tv-status-danger bg-tv-status-danger-bg`

## الحالات
عادي، hover، focus-visible (حلقة مرئية — غائبة اليوم)، active، disabled (`opacity-40/50` اليوم)، loading (يُعطَّل ويُبقي العرض).

## إمكانية الوصول
- `<button type="button">` دائماً إلا في إرسال النموذج.
- زر الأيقونة وحدها يحتاج `aria-label`.
- حلقة `focus-visible` إلزامية؛ اليوم أغلب الأزرار `outline-none` بلا بديل.
- النص الأبيض على `#185045` = 9.24:1 ✓.

## الربط
| المصطلح | الصنف | المثال الحالي |
|---|---|---|
| زر أساسي | `bg-tv-action-primary text-tv-action-on-primary` | `followup-ui.tsx:13` `btnPrimary` |
| زر ثانوي | `border-tv-border-default bg-tv-surface-raised text-tv-text-brand` | `followup-ui.tsx:12` `btn` |

## الاستعمال
`src/components/ui/button.tsx` موجود (Base UI + cva) وله **صفر** مستخدمين؛ قرار المالك: إما أن يصبح هو الزر الموحَّد (بإعادة ربط ألوانه بالرموز) أو يُترك ونوحِّد عبر ثوابت الأصناف.

## الترحيل
19 ثابت `btn` + 262 زراً أساسياً مضمَّناً. الدفعة 3 في MIGRATION.
