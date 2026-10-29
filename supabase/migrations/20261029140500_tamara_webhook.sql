-- «الربط الخارجي»: Tamara's order notifications (the owner, 2026-10-29) — POST /api/payments/tamara/webhook.
-- kind 'api': the table's kinds have no 'webhook' (0109 check), and widening it is DDL this entry does not need.
insert into public.integrations (name, kind, used_by, secret_ref, account, check_key, notes)
values (
  'تمارا — إشعارات الطلبات (webhook)',
  'api',
  'تسجيل دفعات تمارا فور اعتمادها: عند order_approved نعتمد الطلب (authorise) ثم نسجّل الدفعة مرة واحدة وننبّه البائع (src/app/api/payments/tamara/webhook/route.ts → payment-links-poll.ts applyTamaraEvent)',
  'TAMARA_NOTIFICATION_KEY',
  'لوحة تمارا ← Settings ← General Settings ← Webhooks — https://pkg.traveliun.com/api/payments/tamara/webhook',
  'tamara_webhook',
  'وارد من تمارا: يُقبل فقط بتوكن tamaraToken الموقّع بمفتاح الإشعارات. لا تحصيل (capture) تلقائي منّا — تمارا تحصّل تلقائياً بعد 21 يوماً أو من البوابة. مهمة الـ10 دقائق تبقى احتياطاً.'
)
on conflict (name) do nothing;

-- ROLLBACK (manual):
--   delete from public.integrations where name = 'تمارا — إشعارات الطلبات (webhook)';
