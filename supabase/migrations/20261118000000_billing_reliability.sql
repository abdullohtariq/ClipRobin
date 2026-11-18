alter table public.billing_checkout_sessions
  add column provider_checkout_id uuid,
  add column checkout_state text check (checkout_state in ('open', 'pending')),
  add column check_after timestamptz not null default now();

create index billing_checkout_provider_idx
  on public.billing_checkout_sessions (provider_checkout_id, test_mode) where provider_checkout_id is not null;

alter table public.billing_subscriptions
  add column refunded_period_started_at timestamptz,
  add column refunded_order_id uuid;

create function public.sync_billing_refund(
  p_provider_id text, p_user_id uuid, p_test_mode boolean, p_status text,
  p_active_until timestamptz, p_updated_at timestamptz, p_period_started_at timestamptz, p_order_id uuid
) returns void language plpgsql set search_path = '' as $$
begin
  if p_user_id is null or p_period_started_at is null or p_order_id is null then return; end if;
  perform public.sync_billing_period(p_provider_id, p_user_id, p_test_mode, p_status,
    p_active_until, p_updated_at, p_period_started_at);
  update public.billing_subscriptions
  set refunded_period_started_at = p_period_started_at, refunded_order_id = p_order_id
  where provider_id = p_provider_id and user_id = p_user_id and test_mode = p_test_mode
    and period_started_at = p_period_started_at;
end;
$$;

create function public.billing_hook_availability(
  p_user_id uuid, p_test_mode boolean, p_period_started_at timestamptz, p_monthly_budget_micros integer
) returns jsonb language sql stable set search_path = '' as $$
  with limits as (
    select public.billing_hook_balance(p_user_id, p_test_mode, p_period_started_at) as remaining,
      (select coalesce(sum(reserved_micros), 0) from public.billing_hook_requests
        where user_id = p_user_id and test_mode = p_test_mode and period_started_at = p_period_started_at) as cycle_spend,
      (select coalesce(sum(reserved_micros), 0) from public.billing_hook_requests
        where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') as month_spend
  )
  select jsonb_build_object('remaining', remaining, 'availableNow',
    greatest(0, least(remaining, (1000000 - cycle_spend) / 20000, (p_monthly_budget_micros - month_spend) / 20000)))
  from limits;
$$;

create or replace function public.reserve_billing_hook(
  p_id uuid, p_user_id uuid, p_provider_id text, p_test_mode boolean,
  p_period_started_at timestamptz, p_credits integer, p_monthly_budget_micros integer
) returns text language plpgsql set search_path = '' as $$
declare
  availability jsonb;
begin
  if p_id is null or p_credits is null or p_credits not between 1 and 20
    or coalesce(p_monthly_budget_micros, 0) <= 0 then
    return 'budget';
  end if;
  perform pg_advisory_xact_lock(124625133, 195124414);
  perform 1 from public.billing_subscriptions
  where provider_id = p_provider_id and user_id = p_user_id and test_mode = p_test_mode
    and period_started_at = p_period_started_at and period_started_at <= now() and active_until > now()
    and status in ('active', 'cancelled') and refunded_period_started_at is distinct from period_started_at
  for update;
  if not found then return 'inactive'; end if;
  availability := public.billing_hook_availability(p_user_id, p_test_mode, p_period_started_at, p_monthly_budget_micros);
  if (availability->>'remaining')::integer < p_credits then return 'credits'; end if;
  if (availability->>'availableNow')::integer < p_credits then return 'budget'; end if;
  insert into public.billing_hook_requests (id, user_id, test_mode, period_started_at, credits, reserved_micros)
  values (p_id, p_user_id, p_test_mode, p_period_started_at, p_credits, p_credits * 20000)
  on conflict (id) do nothing;
  return case when found then 'reserved' else 'duplicate' end;
end;
$$;

-- Reserve room for existing subscribers and unresolved checkouts as well as actual usage.
create function public.billing_checkout_has_capacity(p_monthly_budget_micros integer)
returns boolean language sql stable set search_path = '' as $$
  with commitments as (
    select user_id, test_mode, max(
      case when active_until > now() and period_started_at <= now()
          and status in ('active', 'cancelled') and refunded_period_started_at is distinct from period_started_at
        then public.billing_hook_balance(user_id, test_mode, period_started_at) else 20 end
    ) as credits
    from public.billing_subscriptions
    where provider_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      and (status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
        or (status = 'cancelled' and active_until > now()))
    group by user_id, test_mode
  ), outstanding as (
    select count(*) as sessions
    from public.billing_checkout_sessions as checkout
    where (checkout.provider_checkout_id is not null or checkout.expires_at > now()
        or checkout.url like 'https://sandbox.polar.sh/%' or checkout.url like 'https://polar.sh/%')
      and not exists (select 1 from commitments where user_id = checkout.user_id and test_mode = checkout.test_mode)
  ), spend as (
    select coalesce(sum(reserved_micros), 0) as month_spend from public.billing_hook_requests
    where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
  )
  select p_monthly_budget_micros >= greatest(
    (1 + outstanding.sessions + count(commitments.user_id)) * 400000,
    spend.month_spend + ((1 + outstanding.sessions) * 20 + coalesce(sum(commitments.credits), 0)) * 20000
  )
  from outstanding cross join spend left join commitments on true
  group by outstanding.sessions, spend.month_spend;
$$;

create function public.hold_billing_checkout(
  p_user_id uuid, p_test_mode boolean, p_attempt_id uuid, p_monthly_budget_micros integer
) returns text language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(124625133, 195124414);
  if exists (select 1 from public.billing_subscriptions where user_id = p_user_id and test_mode = p_test_mode
      and provider_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      and (status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
        or (status = 'cancelled' and active_until > now()))) then
    return 'subscription';
  end if;
  if exists (select 1 from public.billing_checkout_sessions where user_id = p_user_id and test_mode = p_test_mode
      and (provider_checkout_id is not null or expires_at > now()
        or url like 'https://sandbox.polar.sh/%' or url like 'https://polar.sh/%')) then
    return 'existing';
  end if;
  if p_monthly_budget_micros is not null and not public.billing_checkout_has_capacity(p_monthly_budget_micros) then
    return 'capacity';
  end if;
  insert into public.billing_checkout_sessions (user_id, test_mode, attempt_id, expires_at)
  values (p_user_id, p_test_mode, p_attempt_id, now() + interval '30 seconds')
  on conflict (user_id, test_mode) do update
    set attempt_id = excluded.attempt_id, expires_at = excluded.expires_at, url = null,
      provider_checkout_id = null, checkout_state = null, check_after = now()
    where billing_checkout_sessions.provider_checkout_id is null and billing_checkout_sessions.expires_at <= now()
      and (billing_checkout_sessions.url is null or
        (billing_checkout_sessions.url not like 'https://sandbox.polar.sh/%' and billing_checkout_sessions.url not like 'https://polar.sh/%'));
  return case when found then 'held' else 'existing' end;
end;
$$;

revoke all on function public.sync_billing_refund(text, uuid, boolean, text, timestamptz, timestamptz, timestamptz, uuid),
  public.billing_hook_availability(uuid, boolean, timestamptz, integer), public.billing_checkout_has_capacity(integer),
  public.hold_billing_checkout(uuid, boolean, uuid, integer) from public, anon, authenticated;
grant execute on function public.sync_billing_refund(text, uuid, boolean, text, timestamptz, timestamptz, timestamptz, uuid),
  public.billing_hook_availability(uuid, boolean, timestamptz, integer), public.billing_checkout_has_capacity(integer),
  public.hold_billing_checkout(uuid, boolean, uuid, integer) to service_role;
