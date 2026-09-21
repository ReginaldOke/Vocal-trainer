-- Vocal Coach progress sync. Run this once in the Supabase SQL editor.
-- One record per sync code. The public (anon) key can only call the two functions below,
-- so it can read or write a single record it knows the code for, never list them.

create table if not exists public.progress (
  code text primary key,
  data jsonb not null,
  updated_at bigint not null default 0,
  touched timestamptz not null default now()
);

alter table public.progress enable row level security;
-- No policies: direct table access is denied for anon and authenticated roles.

create or replace function public.get_progress(p_code text)
returns table (data jsonb, updated_at bigint)
language sql security definer set search_path = public as $$
  select data, updated_at from public.progress where code = upper(p_code) limit 1;
$$;

create or replace function public.put_progress(p_code text, p_data jsonb, p_updated_at bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(p_code) < 8 or length(p_code) > 20 then raise exception 'bad code'; end if;
  if pg_column_size(p_data) > 400000 then raise exception 'too large'; end if;
  insert into public.progress (code, data, updated_at, touched)
    values (upper(p_code), p_data, p_updated_at, now())
  on conflict (code) do update
    set data = excluded.data, updated_at = excluded.updated_at, touched = now()
    where excluded.updated_at >= public.progress.updated_at;
end;
$$;

revoke all on function public.get_progress(text) from public;
revoke all on function public.put_progress(text, jsonb, bigint) from public;
grant execute on function public.get_progress(text) to anon, authenticated;
grant execute on function public.put_progress(text, jsonb, bigint) to anon, authenticated;
