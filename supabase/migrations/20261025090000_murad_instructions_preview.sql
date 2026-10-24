-- «اعطني الإجابة الآن» (the owner's test, 2026-10-24): a management number asks to see Murad's answer — recorded as a preview
alter table public.murad_instructions drop constraint if exists murad_instructions_kind_check;
alter table public.murad_instructions add constraint murad_instructions_kind_check
  check (kind in ('decision', 'lesson', 'train', 'undo', 'reset', 'unclear', 'preview'));
