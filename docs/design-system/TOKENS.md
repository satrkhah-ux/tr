# الرموز الدلالية (Semantic tokens)

**مصدر الحقيقة:** `src/app/globals.css` — القيم على `:root` (فاتح) و`.dark` (داكن)، ومسجَّلة في `@theme inline` باسم `--color-tv-*` حتى تعمل كأصناف Tailwind (`text-tv-text-muted`، `bg-tv-surface-raised`، `border-tv-border-default`…).

**القاعدة:** لا لون جديد. كل قيمة فاتحة لون تستخدمه الشاشات الآن، وكل قيمة داكنة هي ما تحوّله إليه طبقة الداكن الحالية (`globals.css` أو `dark-extra.css`). لذلك نقل أي صنف إلى رمزه لا يغيّر شكله في الوضعين.

المستويات: **خام** (الـhex نفسه، داخل `:root` فقط) ← **دلالي** (`--tv-*`) ← **مكوّن** (فقط حين يلزم: `@utility tv-field`).

| الرمز | الصنف في Tailwind | فاتح | داكن | يحل محل |
|---|---|---|---|---|
| `--tv-surface-canvas` | `bg-tv-surface-canvas` | `#eef3f1` | `#0b1a17` | خلفية التطبيق (`.tv-app`) |
| `--tv-surface-raised` | `bg-tv-surface-raised` | `#ffffff` | `#14231f` | `bg-white` للبطاقات والحقول |
| `--tv-surface-sunken` | `bg-tv-surface-sunken` | `#f4f8f6` | `#1b2d27` | `#f4f8f6` `#f0f7f4` `#eef4f1` (hover/لوحات) |
| `--tv-text-strong` | `text-tv-text-strong` | `#003c3a` | `#eaf3ef` | `#003c3a` `#0f3d38` |
| `--tv-text-brand` | `text-tv-text-brand` | `#185045` | `#7fd3ba` | `text-[#185045]` |
| `--tv-text-muted` | `text-tv-text-muted` | `#557d78` | `#9fb3ac` | `#557d78` `#6f8f88` |
| `--tv-text-faint` | `text-tv-text-faint` | `#93aaa3` | `#9fb3ac` | `#93aaa3` `#8aa29b` (تباين ضعيف — انظر AUDIT) |
| `--tv-border-subtle` | `border-tv-border-subtle` | `#e2ebe7` | `#294039` | فواصل البطاقات |
| `--tv-border-default` | `border-tv-border-default` | `#dbe6e1` | `#294039` | حدود الحقول والأزرار |
| `--tv-border-strong` | `border-tv-border-strong` | `#cfe0d9` | `#294039` | حدود متقطعة/مجموعات |
| `--tv-action-primary` | `bg-tv-action-primary` | `#185045` | `#185045` | `bg-[#185045]` (العلامة لا تتغير في الداكن عمداً) |
| `--tv-action-on-primary` | `text-tv-action-on-primary` | `#ffffff` | `#ffffff` | `text-white` على الزر الأساسي |
| `--tv-action-focus` | `border-tv-action-focus` | `#2aa87a` | `#2aa87a` | `focus:border-[#2aa87a]` |
| `--tv-status-success` / `-bg` | `text-tv-status-success` | `#0f7a52` / `#e9f7f0` | `#86eac4` / `#12352c` | مؤكَّد / نجاح |
| `--tv-status-danger` / `-bg` | `text-tv-status-danger` | `#c22850` / `#fdeef2` | `#e789a1` / `#31161f` | خطأ / ملغى |
| `--tv-status-warning` / `-bg` | `text-tv-status-warning` | `#a86a10` / `#fff8e8` | `#eac186` / `#312811` | تحذير |

## رموز موجودة لم تُمس
- `--tv-brand` / `--tv-accent`: لون شركة الشريك يُكتب على `<body>` — يبقى كما هو.
- `--color-tv-*` في «القسم 9» (`tv-muted`، `tv-hairline`…): ثابتة بلا داكن وبلا مستخدمين. مقترح دمجها في الجدول أعلاه — انظر MIGRATION.
- رموز shadcn (`--primary`، `--border`…): يستعملها `ui/*` فقط.

## ملاحظات تقنية
- **Lightning CSS يحذف أي متغير لا يقرؤه أي صنف.** الرمز بلا مستخدم لا يظهر في البناء — هذا متوقَّع، ويظهر حين يُستعمل. تم التأكد من بقاء الرموز المستعملة في البناء (انظر تقرير التسليم).
- **ترتيب Tailwind:** أصناف الرموز (`border-tv-…`) تُرتَّب أبجدياً **بعد** `border-[#…]`، فتغلبها لو اجتمعا على عنصر. لذلك المكوّنات التي تقبل تجاوزاً من الشاشة (حالة خطأ مثلاً) تُكتب كـ`@utility` (مثل `tv-field`) التي يضعها Tailwind قبل الأصناف الخام. اختُبر ذلك بمترجم Tailwind نفسه.
- إضافة رمز: سطر في `:root`، وسطر في `.dark` إن اختلف، وسطر `--color-tv-…: var(--tv-…)` في `@theme inline`.
