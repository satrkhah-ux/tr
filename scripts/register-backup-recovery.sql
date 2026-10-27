-- Existing integration; the daily schedule and secret locations are unchanged.
UPDATE public.integrations
SET account = 'deploy@vps-new',
    used_by = 'النسخ اليومي لقاعدة النظام وملفات Storage؛ deploy/pkg-backup.py يمنع التشغيل المتزامن ويشغّل النسخ بحساب deploy حتى عند استدعائه من root',
    check_key = 'backup_pkg',
    notes = '/home/deploy/backups/pkg/YYYY-MM-DD — احتفاظ 14 ليلة. إصلاح الملكية 2026-10-27؛ التحقق من قاعدة البيانات و86 ملفاً. يسجل فشل إنشاء المجلد ضمن نتيجة المهمة.'
WHERE check_key = 'backup_pkg';
