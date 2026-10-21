-- Reuse the registered OpenAI connection and its existing automatic health check.
update public.integrations
set used_by = concat_ws(E'\n', nullif(used_by, ''), 'مُراد: استقبال التأشيرات لجميع العملاء ومراجعة وضوح صور الجواز والصورة الشخصية؛ يستمر جمع الطلب مع النواقص'),
    updated_at = now()
where name = 'OpenAI' and coalesce(used_by, '') not like '%استقبال التأشيرات لجميع العملاء%';
