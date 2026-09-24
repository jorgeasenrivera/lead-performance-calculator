-- C96, 24 September: PromptPath delivers analytics exports to Sage's SFTP
-- server in New York. The files stay there; this records only that each one
-- arrived, because Sage's database is in Canada and Jorge decided the reports
-- stay in the US. Written by /api/sftp-arrival with the service role; nothing
-- a phone holds can read or write it.
create table public.sftp_arrivals (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  account text not null,
  filename text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$')
);
create index sftp_arrivals_sha256 on public.sftp_arrivals (sha256);
alter table public.sftp_arrivals enable row level security;
revoke all on public.sftp_arrivals from anon, authenticated;
