# مواصفة المكوّن: البطاقة (Card) — مقترح، غير مُنفَّذ

## الغرض
تجميع محتوى مترابط (ملف عميل، مدينة، حجز) على سطح مرفوع. لا تُستعمل بطاقة داخل بطاقة — استعمل `surface-sunken` للتقسيم الداخلي.

## البنية
- السطح (حد + خلفية + ظل خفيف)
- اختياري: رأس (عنوان `text-tv-text-strong` + أفعال)، جسم، تذييل

## الخصائص
| الخاصية | القيم | الافتراضي | ملاحظات |
|---|---|---|---|
| density | compact (`p-3`، 14px)، regular (`p-4/p-5`، rounded-2xl) | regular | «البسيط» مضغوط |
| tone | default، sunken | default | sunken = `bg-tv-surface-sunken` بلا ظل |

الأنماط المرصودة (196 سطراً): `basic/styles.ts:5` (`#d8e6e0`، 14px)، `commissions/ui.tsx:9` و`operations/CaseManagement.tsx:13` (`#e2ebe7`، 2xl)، `followup-ui.tsx:11` (`#E3E8E4` — لا يلتقطه الداكن).

الرموز: `rounded-2xl border border-tv-border-subtle bg-tv-surface-raised shadow-[0_1px_2px_rgba(0,60,58,0.04)]`.

## الحالات
عادي؛ قابلة للنقر: hover `bg-tv-surface-sunken` + focus-visible.

## إمكانية الوصول
البطاقة القابلة للنقر تكون `<button>` أو `<a>` كاملة، لا `div onClick`.

## الترحيل
`#d8e6e0` و`#E3E8E4` يقتربان من `#e2ebe7` — توحيدها تغيير مرئي طفيف يحتاج موافقة. الدفعة 2.
