begin;

alter view if exists public.public_events set (security_invoker = false);
alter view if exists public.events_canonical set (security_invoker = false);

alter table if exists public.sponsorships disable row level security;
alter table if exists public.clicks disable row level security;
alter table if exists public.events_archive_older_than_30d disable row level security;
alter table if exists public.reviews disable row level security;

commit;
