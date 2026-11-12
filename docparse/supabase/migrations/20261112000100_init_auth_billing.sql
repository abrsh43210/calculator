-- DocParse: auth, billing and usage schema
-- Tables: profiles, subscriptions, api_keys, documents, usage_events, stripe_events
-- Every table has RLS on. Writes that matter for billing (plan, subscription,
-- usage) only happen through the service role or SECURITY DEFINER functions.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.plan_tier as enum ('free', 'pro', 'business');

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'unpaid',
  'incomplete', 'incomplete_expired', 'paused'
);

-- Matches DocumentStatus in lib/api/types.ts
create type public.document_status as enum ('queued', 'processing', 'completed', 'failed');

create type public.usage_source as enum ('web', 'api');

create type public.billing_cycle as enum ('monthly', 'annual');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Documents included per month. Keep in sync with lib/pricing.ts (includedDocs).
create or replace function public.plan_doc_limit(p_plan public.plan_tier)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'free' then 20
    when 'pro' then 500
    when 'business' then 2500
  end;
$$;

-- Paid plans keep working past the included amount and are billed overage
-- (lib/pricing.ts overagePerDoc). Free is hard-capped.
create or replace function public.plan_has_overage(p_plan public.plan_tier)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_plan in ('pro', 'business');
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  full_name          text,
  avatar_url         text,
  plan               public.plan_tier not null default 'free',
  stripe_customer_id text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Users may only edit cosmetic columns; plan and Stripe ids are server-owned.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- subscriptions: mirror of Stripe subscriptions, written by the webhook
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                    text primary key,               -- Stripe subscription id (sub_...)
  user_id               uuid not null references public.profiles (id) on delete cascade,
  stripe_customer_id    text not null,
  status                public.subscription_status not null,
  plan                  public.plan_tier not null,
  billing_cycle         public.billing_cycle not null default 'monthly',
  price_id              text not null,            -- base plan price
  overage_item_id       text,                     -- metered subscription item, if any
  quantity              integer not null default 1,
  cancel_at_period_end  boolean not null default false,
  current_period_start  timestamptz not null,
  current_period_end    timestamptz not null,
  canceled_at           timestamptz,
  ended_at              timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

create policy "subscriptions: read own"
  on public.subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- api_keys: only a SHA-256 hash is stored. The raw key is shown once.
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 64),
  prefix        text not null,                          -- first chars, for display ("dp_live_ab12")
  key_hash      text not null unique,                   -- hex sha256 of the full key
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index api_keys_user_id_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;

create policy "api_keys: read own"
  on public.api_keys for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "api_keys: revoke own"
  on public.api_keys for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Keys are created server-side (hashing needs the raw key); users may only
-- rename or revoke. key_hash is never readable by the browser.
revoke insert, update, delete on public.api_keys from authenticated, anon;
grant update (name, revoked_at) on public.api_keys to authenticated;
revoke select on public.api_keys from authenticated, anon;
grant select (id, user_id, name, prefix, last_used_at, revoked_at, created_at)
  on public.api_keys to authenticated;

-- ---------------------------------------------------------------------------
-- documents: uploaded files and their extraction results
-- ---------------------------------------------------------------------------
create table public.documents (
  id             text primary key,                      -- "doc_..." from lib/server/handlers.ts
  user_id        uuid not null references public.profiles (id) on delete cascade,
  filename       text not null,
  mime_type      text not null,
  size_bytes     bigint not null check (size_bytes >= 0),
  status         public.document_status not null default 'queued',
  source         public.usage_source not null default 'web',
  storage_path   text,                                  -- <user_id>/<uuid>.<ext> in the documents bucket, if kept
  page_count     integer,
  billable_units integer,
  model          text,
  warnings       jsonb not null default '[]'::jsonb,
  result         jsonb,
  error          text,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index documents_user_created_idx on public.documents (user_id, created_at desc, id desc);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

create policy "documents: read own"
  on public.documents for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "documents: delete own"
  on public.documents for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Inserts and status updates come from the extraction API using the service role.

-- ---------------------------------------------------------------------------
-- usage_events: append-only ledger used for quota enforcement
-- ---------------------------------------------------------------------------
create table public.usage_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  document_id  text references public.documents (id) on delete set null,
  api_key_id   uuid references public.api_keys (id) on delete set null,
  source       public.usage_source not null,
  quantity     integer not null default 1 check (quantity > 0),
  -- Part of quantity that went past the plan's included docs (billed via Stripe meter).
  overage_quantity integer not null default 0 check (overage_quantity >= 0 and overage_quantity <= quantity),
  -- Set once the overage has been sent to Stripe. Null + overage > 0 = still to report.
  reported_at  timestamptz,
  -- Filled on commit, for cost tracking.
  pages         integer,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  created_at   timestamptz not null default now()
);

create index usage_events_unreported_idx on public.usage_events (created_at)
  where overage_quantity > 0 and reported_at is null;
create index usage_events_document_idx on public.usage_events (document_id);

create index usage_events_user_created_idx on public.usage_events (user_id, created_at);

alter table public.usage_events enable row level security;

create policy "usage_events: read own"
  on public.usage_events for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- stripe_events: webhook idempotency
-- ---------------------------------------------------------------------------
create table public.stripe_events (
  id            text primary key,                       -- evt_...
  type          text not null,
  processed_at  timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies: service role only.

-- ---------------------------------------------------------------------------
-- Quota
-- ---------------------------------------------------------------------------

-- Current monthly usage window for a user.
-- Paid users: one-month windows anchored on their Stripe period start, so an
-- annual plan still resets included docs every month on the signup day.
-- Free users (or lapsed subscriptions): the calendar month in UTC.
create or replace function public.billing_period(p_user_id uuid)
returns table (period_start timestamptz, period_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_anchor timestamptz;
  v_sub_end timestamptz;
  v_months integer;
  v_start timestamptz;
begin
  select s.current_period_start, s.current_period_end into v_anchor, v_sub_end
  from public.subscriptions s
  where s.user_id = p_user_id
    and s.status in ('active', 'trialing', 'past_due')
    and s.current_period_end > now()
  order by s.current_period_end desc
  limit 1;

  if v_anchor is null then
    v_start := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
    return query select v_start, v_start + interval '1 month';
    return;
  end if;

  v_months := greatest(0, (
    extract(year from age(now(), v_anchor)) * 12 + extract(month from age(now(), v_anchor))
  )::integer);
  v_start := v_anchor + make_interval(months => v_months);
  return query select v_start, least(v_start + interval '1 month', v_sub_end);
end;
$$;

-- Read-only usage summary. Callable by a signed-in user for themselves,
-- or by the service role for anyone.
create or replace function public.get_usage(p_user_id uuid default null)
returns table (
  plan         public.plan_tier,
  used         integer,
  doc_limit    integer,
  remaining    integer,
  overage      integer,
  period_start timestamptz,
  period_end   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_plan public.plan_tier;
  v_start timestamptz;
  v_end timestamptz;
  v_used integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if auth.role() is distinct from 'service_role' and v_user is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.plan into v_plan from public.profiles p where p.id = v_user;
  if v_plan is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  select bp.period_start, bp.period_end into v_start, v_end
  from public.billing_period(v_user) bp;

  select coalesce(sum(u.quantity), 0)::integer into v_used
  from public.usage_events u
  where u.user_id = v_user and u.created_at >= v_start and u.created_at < v_end;

  return query select
    v_plan, v_used, public.plan_doc_limit(v_plan),
    greatest(public.plan_doc_limit(v_plan) - v_used, 0),
    greatest(v_used - public.plan_doc_limit(v_plan), 0),
    v_start, v_end;
end;
$$;

-- Atomically checks the quota and records usage if allowed.
-- A per-user advisory lock serialises concurrent calls so two requests
-- can't both squeeze through the last slot. Service role only.
create or replace function public.consume_quota(
  p_user_id     uuid,
  p_quantity    integer default 1,
  p_source      public.usage_source default 'web',
  p_document_id text default null,
  p_api_key_id  uuid default null
)
returns table (
  allowed          boolean,
  plan             public.plan_tier,
  used             integer,
  doc_limit        integer,
  remaining        integer,
  overage_quantity integer,
  period_start     timestamptz,
  period_end       timestamptz,
  event_id         bigint                -- usage_events.id of this reservation (null if blocked)
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_plan public.plan_tier;
  v_limit integer;
  v_start timestamptz;
  v_end timestamptz;
  v_used integer;
  v_overage integer;
  v_event_id bigint;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'quantity must be >= 1' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select p.plan into v_plan from public.profiles p where p.id = p_user_id;
  if v_plan is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  v_limit := public.plan_doc_limit(v_plan);

  select bp.period_start, bp.period_end into v_start, v_end
  from public.billing_period(p_user_id) bp;

  select coalesce(sum(u.quantity), 0)::integer into v_used
  from public.usage_events u
  where u.user_id = p_user_id and u.created_at >= v_start and u.created_at < v_end;

  if v_used + p_quantity > v_limit and not public.plan_has_overage(v_plan) then
    return query select false, v_plan, v_used, v_limit, greatest(v_limit - v_used, 0), 0, v_start, v_end, null::bigint;
    return;
  end if;

  -- Only the part of this request beyond the included amount is overage.
  v_overage := greatest(0, v_used + p_quantity - v_limit) - greatest(0, v_used - v_limit);

  insert into public.usage_events (user_id, document_id, api_key_id, source, quantity, overage_quantity)
  values (p_user_id, p_document_id, p_api_key_id, p_source, p_quantity, v_overage)
  returning id into v_event_id;

  v_used := v_used + p_quantity;
  return query select true, v_plan, v_used, v_limit, greatest(v_limit - v_used, 0), v_overage, v_start, v_end, v_event_id;
end;
$$;

-- Give back usage when extraction fails (failed extractions are not billed).
-- Overage already sent to Stripe can't be taken back here, so those rows stay.
create or replace function public.refund_usage(p_document_id text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with d as (
    delete from public.usage_events
    where document_id = p_document_id and reported_at is null
    returning 1
  )
  select count(*)::integer from d;
$$;

-- Undo one reservation (UsageReservation.release()). Idempotent.
create or replace function public.release_usage(p_event_id bigint)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with d as (
    delete from public.usage_events where id = p_event_id and reported_at is null returning 1
  )
  select exists (select 1 from d);
$$;

-- Resolve an API key hash to its owner. The app checks the plan's apiAccess.
create or replace function public.verify_api_key(p_key_hash text)
returns table (key_id uuid, user_id uuid, plan public.plan_tier)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  update public.api_keys k
     set last_used_at = now()
    from public.profiles p
   where k.key_hash = p_key_hash
     and k.revoked_at is null
     and p.id = k.user_id
  returning k.id, k.user_id, p.plan;
end;
$$;

revoke all on function public.consume_quota(uuid, integer, public.usage_source, text, uuid) from public, anon, authenticated;
revoke all on function public.refund_usage(text) from public, anon, authenticated;
revoke all on function public.release_usage(bigint) from public, anon, authenticated;
revoke all on function public.verify_api_key(text) from public, anon, authenticated;
revoke all on function public.billing_period(uuid) from public, anon, authenticated;
revoke all on function public.get_usage(uuid) from public, anon;
grant execute on function public.consume_quota(uuid, integer, public.usage_source, text, uuid) to service_role;
grant execute on function public.refund_usage(text) to service_role;
grant execute on function public.release_usage(bigint) to service_role;
grant execute on function public.verify_api_key(text) to service_role;
grant execute on function public.billing_period(uuid) to service_role;
grant execute on function public.get_usage(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, files live under <user_id>/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 20971520,  -- 20 MB
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "documents bucket: read own"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "documents bucket: upload own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "documents bucket: delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
