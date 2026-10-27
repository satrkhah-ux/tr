-- «ربط الإضافة»: the staff browser extension (Chrome / Edge), one link per device.
--
-- The employee presses «اربط» on /extension (a signed-in page); the page mints a
-- random 32-byte token, hands it to the extension once, and this table keeps only
-- its sha256 — never the token. Every /api/ext/* request carries the token
-- (Authorization: Bearer) and is refused once the link is revoked or expired, or
-- the employee is no longer Active (src/lib/ext/auth.ts). Revoking one device
-- never signs the employee out anywhere else.
--
-- No session reads this table: the app reads and writes it through the service
-- role only, as operation_links (0067). Additive and idempotent; safe to re-run.

create table if not exists public.extension_links (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- «كروم — ويندوز», as the page guessed it; the employee sees it in the list
  label text not null default '' check (length(label) <= 80),
  -- what the extension may do (src/lib/ext/token.ts EXT_SCOPES), always narrowed by the employee's own permissions
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index if not exists extension_links_employee_idx
  on public.extension_links (employee_id) where revoked_at is null;

alter table public.extension_links enable row level security;
revoke all on public.extension_links from anon, authenticated;

-- «الربط الخارجي»: the extension is something the system is used from outside itself
insert into public.integrations (name, kind, used_by, secret_ref, account, notes)
select
  'إضافة المتصفح للموظفين (Chrome / Edge)',
  'service',
  'لوحة العميل بجانب محادثة تيلي تيل، التنبيهات ومهام اليوم، البحث السريع، التقاط سعر فندق إلى الملف — مسارات /api/ext/*',
  'بلا مفتاح في الكود — رمز ربط لكل جهاز يصدر من صفحة /extension (تُحفظ بصمته فقط في extension_links)، يُلغى من الصفحة نفسها',
  'غير منشورة بعد — حزمة داخلية بوضع المطوّر (extension/README.ar.md)',
  'الصلاحيات: pkg.traveliun.com والمواقع التي تعمل عليها فقط. لا أسعار شراء ولا جوازات تصل الإضافة.'
where not exists (select 1 from public.integrations where name = 'إضافة المتصفح للموظفين (Chrome / Edge)');

notify pgrst, 'reload schema';
