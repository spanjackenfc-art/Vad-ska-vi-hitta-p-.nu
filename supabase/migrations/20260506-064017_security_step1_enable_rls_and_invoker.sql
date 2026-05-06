begin;

alter table if exists public.sponsorships enable row level security;
alter table if exists public.clicks enable row level security;
alter table if exists public.events_archive_older_than_30d enable row level security;
alter table if exists public.reviews enable row level security;

alter view if exists public.public_events set (security_invoker = true);
alter view if exists public.events_canonical set (security_invoker = true);

commit;
