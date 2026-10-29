-- Rollback of 20261029120000_followup_supervision.sql — its two tables only;
-- nothing else references them. Run only on the owner's word, after a backup.
drop table if exists public.followup_supervision_cases;
drop table if exists public.followup_supervisors;
