-- Run against a fresh DB that has supabase_shim.sql + migrations applied.
-- Any failed assertion raises and aborts (psql -v ON_ERROR_STOP=1).
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com', '{}');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'trigger should create profiles';
  assert (select full_name from public.profiles where email = 'alice@example.com') = 'Alice', 'full_name copied';
  assert (select plan from public.profiles where email = 'bob@example.com') = 'free', 'default plan free';
end $$;

insert into public.api_keys (user_id, name, prefix, key_hash)
values ('00000000-0000-0000-0000-00000000000b', 'bob key', 'dp_live_bob', 'hash-bob');

-- ---- As Alice --------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$ begin
  assert (select count(*) from public.profiles) = 1, 'alice sees only her profile';
  assert (select count(*) from public.api_keys) = 0, 'alice cannot see bob keys';
end $$;

update public.profiles set full_name = 'Alice B';

do $$ begin
  begin
    update public.profiles set plan = 'business';
    raise exception 'plan should not be user-writable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform key_hash from public.api_keys;
    raise exception 'key_hash should not be readable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.usage_events (user_id, source) values (auth.uid(), 'web');
    raise exception 'usage_events should not be user-writable';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    perform public.consume_quota(auth.uid(), 1, 'web', null, null);
    raise exception 'consume_quota should be service-role only';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_usage('00000000-0000-0000-0000-00000000000b');
    raise exception 'get_usage on another user should be forbidden';
  exception when insufficient_privilege then null;
  end;
  assert (select doc_limit from public.get_usage()) = 20, 'free limit is 20';
end $$;

-- Storage: own folder only
insert into storage.objects (bucket_id, name) values ('documents', '00000000-0000-0000-0000-00000000000a/x.pdf');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('documents', '00000000-0000-0000-0000-00000000000b/x.pdf');
    raise exception 'upload into another user folder should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$ begin
  assert (select full_name from public.profiles where email = 'alice@example.com') = 'Alice B', 'cosmetic update allowed';
end $$;

-- ---- Quota -----------------------------------------------------------------
do $$
declare r record; i int;
begin
  for i in 1..20 loop
    select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000a');
    assert r.allowed, 'call ' || i || ' should be allowed';
  end loop;
  assert r.remaining = 0 and r.used = 20, 'used 20 of 20';

  select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000a');
  assert not r.allowed, '21st free doc should be blocked';
  assert (select count(*) from public.usage_events where user_id = '00000000-0000-0000-0000-00000000000a') = 20, 'blocked call writes nothing';

  select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000b', 21);
  assert not r.allowed, 'bulk over limit blocked';

  -- Upgrade Alice to Pro (annual) with a period that started 40 days ago.
  update public.profiles set plan = 'pro' where id = '00000000-0000-0000-0000-00000000000a';
  insert into public.subscriptions (id, user_id, stripe_customer_id, status, plan, billing_cycle, price_id, current_period_start, current_period_end)
  values ('sub_1', '00000000-0000-0000-0000-00000000000a', 'cus_1', 'active', 'pro', 'annual', 'price_pro_annual',
          now() - interval '40 days', now() + interval '325 days');

  select * into r from public.billing_period('00000000-0000-0000-0000-00000000000a');
  assert r.period_start = (now() - interval '40 days') + interval '1 month', 'annual: window is the 2nd monthly slice, got ' || r.period_start;
  assert r.period_end = r.period_start + interval '1 month', 'annual: one-month window';

  select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000a');
  assert r.allowed and r.doc_limit = 500 and r.overage_quantity = 0, 'pro limit 500, no overage yet';
  assert r.used = 21, 'free usage from today counts in current window, got ' || r.used;

  -- Pro has overage: going past 500 is allowed and the excess is flagged.
  select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000a', 478);
  assert r.allowed and r.used = 499 and r.overage_quantity = 0, 'up to 499';
  select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000a', 3);
  assert r.allowed and r.used = 502 and r.overage_quantity = 2 and r.remaining = 0, 'straddling call: 2 of 3 are overage';
  select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000a', 1);
  assert r.overage_quantity = 1, 'fully over: all overage';
  assert (select overage from public.get_usage('00000000-0000-0000-0000-00000000000a')) = 3, 'get_usage overage 3';
end $$;

-- refund_usage
do $$
declare d text := 'doc_a'; d2 text := 'doc_b'; r record;
begin
  insert into public.documents (id, user_id, filename, mime_type, size_bytes)
  values (d, '00000000-0000-0000-0000-00000000000a', 'inv.pdf', 'application/pdf', 100);
  select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000a', 1, 'api', d, null);
  assert r.used = 504, 'used 504';
  assert public.refund_usage(d) = 1, 'refund removes one event';
  assert (select used from public.get_usage('00000000-0000-0000-0000-00000000000a')) = 503, 'back to 503';

  -- Reported overage can't be refunded.
  insert into public.documents (id, user_id, filename, mime_type, size_bytes)
  values (d2, '00000000-0000-0000-0000-00000000000a', 'b.pdf', 'application/pdf', 100);
  perform public.consume_quota('00000000-0000-0000-0000-00000000000a', 1, 'api', d2, null);
  update public.usage_events set reported_at = now() where document_id = d2;
  assert public.refund_usage(d2) = 0, 'reported usage kept';

  -- reserve -> release by event id
  select * into r from public.consume_quota('00000000-0000-0000-0000-00000000000a', 2);
  assert r.event_id is not null, 'reservation returns event id';
  assert public.release_usage(r.event_id), 'release deletes the reservation';
  assert not public.release_usage(r.event_id), 'release is idempotent';
  assert (select used from public.get_usage('00000000-0000-0000-0000-00000000000a')) = 504, 'usage back to 504';
end $$;

-- documents RLS: owner only
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$ begin
  assert (select count(*) from public.documents) = 0, 'bob cannot see alice docs';
  begin
    insert into public.documents (id, user_id, filename, mime_type, size_bytes)
    values ('doc_x', auth.uid(), 'x.pdf', 'application/pdf', 1);
    raise exception 'documents insert should be service-role only';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- verify_api_key
do $$
declare r record;
begin
  select * into r from public.verify_api_key('hash-bob');
  assert r.user_id = '00000000-0000-0000-0000-00000000000b' and r.plan = 'free', 'key resolves';
  assert (select last_used_at from public.api_keys where key_hash = 'hash-bob') is not null, 'last_used_at stamped';
  update public.api_keys set revoked_at = now() where key_hash = 'hash-bob';
  assert not exists (select 1 from public.verify_api_key('hash-bob')), 'revoked key rejected';
  assert not exists (select 1 from public.verify_api_key('nope')), 'unknown key rejected';
end $$;

rollback;
\echo ALL_SQL_TESTS_PASSED
