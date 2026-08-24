# استبيان RateHawk (ETG) — إجابات جاهزة للمراجعة

**الملف الأصلي:** `Pre-Integration questionnaire RH-2.xlsx`
**الجهة:** Emerging Travel Group — علامة **RateHawk**. ليست TBO؛ مزوّد فنادق مختلف تماماً.

## كيف يُملأ

ورقة واحدة بثلاثة أعمدة: **السؤال · إلزامي؟ · الإجابة**. وبعض الأسئلة تطلب
**تعليم الخيار المناسب بالخط العريض (bold)** لا كتابة نصّ.

| الرمز | المعنى |
|---|---|
| ✅ | إجابة **مستخرجة من النظام** — انسخها كما هي |
| 🟠 | **قرار إدارة** — لا أعرفها ولا يصحّ أن أخترعها |
| ⚪ | **غير منطبق** — اكتب `N/A` بسبب مختصر |

---

## ١. بيانات التواصل

| الحقل | الإجابة |
|---|---|
| Company Name | ✅ Traveliun Travel & Tourism — ترافليون للسفر والسياحة |
| Primary commercial contact | 🟠 اسم ومسمّى وبريد وجوال مسؤول العلاقات التجارية |
| Primary technical contact | ✅ فريق ترافليون التقني الداخلي · `it@traveliun.com` |
| Primary financial contact | 🟠 مسؤول الحسابات |

## ٢. معلومات العمل

| السؤال | الإجابة |
|---|---|
| Total annual turnover (USD) | 🟠 **رقم الإدارة** — يحدّد شريحة الاتفاقية |
| Product lines *(bold)* | ✅ **Hotels · Flights · Transfers · Activities/Tickets** — والتأشيرات تُذكر تحت Other |
| Hotel categories *(bold)* | ✅ **All** |
| Own hotel contracting department? | ✅ **Yes** — ١٥٥ فندقاً بأسعار داخلية في النظام |
| Distribution channels *(bold)* | ✅ **Travel agency · Touroperator · B2C** — ولدينا بوابة B2B لأربع شركات متعاونة |
| Rate types *(bold)* | ✅ **BAR · Non Refundable · FIT · Packaged** |
| Business model | ✅ وكالة سفر ومشغّل برامج: نبني بكجات كاملة (فندق + طيران + نقل + جولات) ونبيعها للعميل مباشرة وعبر شركات متعاونة |
| Main demand regions | ✅ **السعودية** أساساً، ودول الخليج |
| **Top 20 destinations** | ✅ ماليزيا · إندونيسيا (بالي) · تايلاند · تركيا · أذربيجان · فيتنام · جورجيا · سنغافورة — **مرتّبة بعدد العروض الفعلية**، والإدارة تكمل الباقي بحجم المبيعات |
| Accommodation suppliers connected | ✅ **٢** مسجَّلان، والاتصال الحيّ لم يُفعَّل بعد |

## ٣. المعلومات التقنية — عام

| السؤال | الإجابة |
|---|---|
| Direct API / platform / third party | ✅ **Direct API integration** — تطوير داخلي بلا وسيط |
| Which platform / developer | ⚪ N/A |
| When do you start development | ✅ **فوراً** — طبقة تجريد المزوّدين مبنية ومختبَرة |
| Expected timeline to complete | ✅ **٢–٤ أسابيع** من استلام بيانات الاختبار |
| Estimated production launch date | 🟠 مرتبط بتوقيع الاتفاقية |
| In-house tech team | ✅ **Yes** |
| Reviewed ETG API documentation | 🟠 هل استلمتها الإدارة فعلاً؟ |
| In-house API docs for clients | ✅ **No** — لا نعيد بيع الأسعار عبر API |
| Sales channels for ETG rates *(bold)* | ✅ **Website** (وتطبيق مصغّر داخل تليغرام للموظفين). **ليس Through API** |
| **API booking flow** | ✅ انسخ «مسار الحجز» أسفل المستند |
| Sequence diagram | 🟠 أستطيع رسمه — اطلبه |
| Payment method *(bold)* | 🟠 قرار مالي. المعتاد لوكالة بحجمنا: **Credit limit (deposit)** |
| Merchant of record | ✅ **Traveliun** — نحن نحصّل من العميل ونصدر الفاتورة |
| **IP addresses to whitelist** | ✅ **`186.241.16.106`** — خادمنا الإنتاجي، عنوان ثابت |
| Separate API key per channel | ✅ **Yes** — النظام يخزّن بيانات كل مزوّد مشفّرة ويقبل أكثر من تسجيل |
| Minimum mandatory selling rate | ✅ **Yes** — قواعد التهميش تفرض حدّ ربح أدنى ولا تسمح بالبيع تحته |
| Different currencies | ✅ **Yes** — يُسعَّر بالريال السعودي (SAR) بتحويل مثبَّت وقت التسعير |
| API SLA thresholds / penalties | ✅ **لا غرامات.** مهلات فقط: بحث ٢٥ث · إعادة تحقّق ٢٥ث · حجز ١٢٠ث · إلغاء ٦٠ث |
| Suppliers queried simultaneously | ✅ **نعم بالتوازي**، ثم تُجمع النتائج ليختار الموظف |
| Aggregation level *(bold)* | ✅ **Hotel · Room type · Board type** |
| Winning supplier criteria *(bold)* | ✅ **Cheapest rate by hotel & room/board type · Own direct contracts** — والقرار النهائي **بيد الموظف** لا آلي |
| Supplier hidden in some scenarios | ✅ **Yes** — المزوّد المعطَّل لا يُستعلَم، والسعر الذي لا يحقّق حدّ الربح لا يُعرض |

## ٤. إدارة المحتوى

| السؤال | الإجابة |
|---|---|
| Hotel mapping process | ✅ **يدوي ومحدود بقاعدتنا** (١٥٥ فندقاً): يُربط فندق المزوّد بفندقنا عند اختيار الموظف، وتُحفظ لقطة المحتوى |
| Static data from several suppliers | ✅ **Yes** — لقطة لكل مزوّد، وتُفضَّل بياناتنا عند التعارض |
| Mapping support to clients | ✅ **No** |
| Update / mapping frequency | ✅ **عند الطلب** — يُجلب المحتوى مرة ويُحدَّث عند الحاجة |
| Mapped = bookable? | ✅ **No.** الربط للمحتوى؛ التوفّر يُفحص حيّاً بالبحث ثم بإعادة التحقّق |
| Destination (region) mapping | ✅ **Yes** — ٥٦ دولة و٥١ مدينة |
| Room-level mapping | ✅ **جزئياً** — ٤٧٥ نوع غرفة، والمطابقة بالاسم لا بالمعرّف |
| Third-party content services | ✅ **No** |
| Minimum content standards | ✅ **No** — لكن نطلب صورة وقائمة مرافق للعرض |
| Standard meal types | ✅ Room Only · Bed & Breakfast · Half Board · Full Board · All Inclusive |
| Meal type matching | ✅ تُطبَّع أسماء الوجبات إلى القائمة أعلاه قبل العرض |

## ٥. محرّك البحث

| السؤال | الإجابة |
|---|---|
| Dynamic search timeouts | ✅ **No — ثابتة** |
| Timeouts per step | ✅ Destination **25s** · One hotel **25s** · Recheck/Prebook **25s** |
| Max supplier response time | ✅ نفس الأرقام |
| Max search requests per minute | 🟠 تقدير **٦٠–١٢٠** — البحث يبدأه موظف لا زائر، فالحجم منخفض ومتوقَّع |
| Max simultaneous requests/second | 🟠 تقدير **٥** |
| Destination search type *(bold)* | ✅ **By region** (وBy hotel list ممكن عند الحاجة) |
| Transform requests into hotel list | ✅ **Yes** — قاعدتنا محدودة ومعروفة |
| Hotel chunk size | ✅ حتى **١٠٠** معرّف في الطلب |
| Rate caching | ✅ **المحتوى فقط يُخزَّن. الأسعار لا تُخزَّن إطلاقاً** — حيّة في كل بحث |
| Cache duration | ⚪ N/A للأسعار |
| When are cancellation policies shown | ✅ **من خطوة البحث** — وتُطبع في مستند العميل |
| Non-included taxes separate | ✅ **Yes** — تُعرض منفصلة وتُطبع بعبارة «يُدفع في الفندق» |
| Citizenship / residency logic | ✅ **Yes** — الجنسية تُرسل في البحث لأنها تغيّر السعر والتوفّر |
| Recheck (Prebook) step | ✅ **Yes — إلزامية** قبل الحجز: السعر والتوفّر وسياسة الإلغاء |
| Allowed price difference at recheck | 🟠 قرار إدارة. **توصيتي: ٠٪** — أي فرق يُعرض على الموظف ولا يُمرَّر تلقائياً |
| Multiroom bookings | ✅ **Yes** — حتى **٩** غرف |
| Multiroom different room types | ✅ **Yes** |

## ٦. محرّك الحجز

| السؤال | الإجابة |
|---|---|
| Booking step timeout | ✅ **١٢٠ ثانية** |
| Max booking processing time | ✅ **١٢٠ ثانية** — لا نقطع قبلها؛ قطع الحجز أسوأ من انتظاره |
| Booking remarks | ✅ **Yes** |
| Cancellation conditions on booking step | ✅ **Yes** — تُخزَّن مع الحجز وتُطبع في الفاوتشر |
| Booking details changed during process | ✅ **No** — تُثبَّت بعد إعادة التحقّق |

## ٧. ما بعد الحجز

| السؤال | الإجابة |
|---|---|
| Cancellations through API | ✅ **Yes** |
| Cancellation timeout | ✅ **٦٠ ثانية** |
| Extract booking order details via API | ✅ **Yes** — للتحقّق من الحالة ورقم التأكيد ومطابقتهما بسجلّنا |
| Order details timeout | ✅ **٣٠ ثانية** |
| Original Hotel Confirmation Number (HCN) | ✅ **Yes — مطلوب.** الفاوتشر الذي يحمله الضيف بلا رقم تأكيد الفندق لا قيمة له |

---

## مسار الحجز — انسخه في خانة «API booking flow»

```
1. Search       Agent enters city, dates, rooms, guests and nationality.
                All enabled suppliers are queried IN PARALLEL; results are
                aggregated by hotel, room type and board type.

2. Select       Agent picks a rate. Markup rules and the minimum-margin floor
                are applied, and the price is converted to SAR at a rate
                pinned at quotation time.

3. Prebook      Mandatory recheck before any commitment: price, availability
                and cancellation policy. Any difference is surfaced to the
                agent and never passed through silently.

4. Client offer A client PDF is produced carrying SELL prices only. Buy price
                and margin never leave the system.

5. Book         After the client agrees, ONE human press by the operations
                team. There is no automatic booking under any condition. The
                act is written to an audit log under the name of whoever did it.

6. Voucher      Issued with the hotel's own confirmation number (HCN) behind
                an unguessable token.

7. Cancel       Through the API, by a human press, logged the same way.
```

## معلومات إضافية تستحق الذكر في خانة Additional Information

- **لا حجز آلي إطلاقاً** — كل حجز وكل إلغاء بضغطة موظف مخوَّل، ومقيَّد في سجلّ تدقيق.
- **حدّ ربح أدنى مفروض بالنظام** — لا يُباع سعر تحته.
- بيانات المزوّدين مخزَّنة **مشفّرة (AES-256-GCM)**، وسعر الشراء والهامش محجوبان عن الموظفين **على مستوى قاعدة البيانات** لا الواجهة فقط.
