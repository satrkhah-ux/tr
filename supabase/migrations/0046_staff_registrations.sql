-- Staff self-registration, decided from the Employees screen.
--
-- A request is NOT an employees row. An applicant who became `employees`
-- straight away would appear in every picker, and an employees insert defaults
-- to status 'Active' — one forgotten column away from a working staff login.
-- So the request lives here, and the only place it becomes an 'Active'
-- employee is approve_staff_registration() below, with a role someone chose.
--
-- The applicant's auth account is created at registration (by the server
-- action, service role) and BANNED until approval, so a pending applicant
-- cannot get a session at all. Rejecting deletes the account; the FK clears.
--
-- Nobody but the service role reads or writes this table: RLS is on with NO
-- policies, and the default grants new tables get for anon/authenticated are
-- revoked. A public insert policy would let a direct PostgREST call skip the
-- validation, the rate limits and the honeypot — and set its own status.

create table if not exists public.staff_registrations (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null check (char_length(btrim(arabic_name)) between 3 and 80),
  english_name text check (char_length(english_name) <= 80),
  email text not null check (email = lower(btrim(email))),
  mobile text not null check (char_length(mobile) between 8 and 20),
  note text check (char_length(note) <= 500),
  auth_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text check (char_length(reject_reason) <= 300),
  role_id uuid references public.roles (id) on delete set null,
  employee_id uuid references public.employees (id) on delete set null,
  reviewed_by uuid references public.employees (id) on delete set null,
  reviewed_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now()
);

-- One open request per address; the backstop for two submits racing.
create unique index if not exists staff_registrations_one_pending
  on public.staff_registrations (email) where status = 'pending';
-- The per-IP rate limit counts by hash over the last 24 hours.
create index if not exists staff_registrations_ip
  on public.staff_registrations (ip_hash, created_at);

alter table public.staff_registrations enable row level security;
revoke all on public.staff_registrations from public, anon, authenticated;

-- One account → one employee, one address → one employee. Approval links an
-- auth account to a new row; without these a second approval (or the
-- «إصدار حساب» button) could attach the same login to two people.
-- Verified 2026-10-11: 0 duplicate groups for either.
create unique index if not exists employees_auth_user_id_uniq
  on public.employees (auth_user_id) where auth_user_id is not null;
create unique index if not exists employees_email_uniq
  on public.employees (lower(email)) where email is not null;

-- Claim the request and create the employee in ONE transaction. The status
-- check is in the UPDATE itself, so two approvers pressing at once produce one
-- employee and one 'not_pending'. Raises:
--   bad_role     the chosen role does not exist
--   not_pending  already decided, or the account is gone
--   23505        the address or account already belongs to an employee
create or replace function public.approve_staff_registration(p_id uuid, p_role uuid, p_reviewer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.staff_registrations%rowtype;
  v_emp uuid;
begin
  if p_role is null or not exists (select 1 from public.roles where id = p_role) then
    raise exception 'bad_role';
  end if;

  update public.staff_registrations
     set status = 'approved', role_id = p_role, reviewed_by = p_reviewer, reviewed_at = now()
   where id = p_id and status = 'pending' and auth_user_id is not null
  returning * into r;
  if not found then
    raise exception 'not_pending';
  end if;

  insert into public.employees (arabic_name, english_name, email, mobile, role_id, status, auth_user_id)
  values (r.arabic_name, r.english_name, r.email, r.mobile, p_role, 'Active', r.auth_user_id)
  returning id into v_emp;

  update public.staff_registrations set employee_id = v_emp where id = p_id;
  return v_emp;
end;
$$;

-- New functions are EXECUTE-able by anon and authenticated by default. This one
-- creates an Active employee with any role — only the server action, behind
-- `employees.manage`, may call it.
revoke execute on function public.approve_staff_registration(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_staff_registration(uuid, uuid, uuid) to service_role;
