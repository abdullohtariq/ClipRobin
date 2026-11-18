alter table public.billing_subscriptions add column period_started_at timestamptz;

-- Keep the existing webhook RPC available during a rolling deployment.
create function public.sync_billing_period(
  p_provider_id text, p_user_id uuid, p_test_mode boolean, p_status text,
  p_active_until timestamptz, p_updated_at timestamptz, p_period_started_at timestamptz
) returns void language plpgsql set search_path = '' as $$
begin
  perform public.sync_billing_subscription(
    p_provider_id, p_user_id, p_test_mode, p_status, p_active_until, p_updated_at
  );
  update public.billing_subscriptions
  set period_started_at = p_period_started_at
  where provider_id = p_provider_id and test_mode = p_test_mode
    and (p_user_id is null or user_id = p_user_id)
    and provider_updated_at = p_updated_at and period_started_at is distinct from p_period_started_at;
end;
$$;

create table public.billing_hook_requests (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  test_mode boolean not null,
  period_started_at timestamptz not null,
  created_at timestamptz not null default now(),
  credits smallint not null check (credits between 1 and 20),
  reserved_micros integer not null check (reserved_micros > 0),
  state text not null default 'pending' check (state in ('pending', 'complete', 'failed')),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0)
);
create index billing_hook_account_period_idx
  on public.billing_hook_requests (user_id, test_mode, period_started_at);
create index billing_hook_created_idx on public.billing_hook_requests (created_at);

alter table public.billing_hook_requests enable row level security;
revoke all on public.billing_hook_requests from public, anon, authenticated;
grant select, insert, update on public.billing_hook_requests to service_role;

create function public.billing_hook_balance(p_user_id uuid, p_test_mode boolean, p_period_started_at timestamptz)
returns integer language sql stable set search_path = '' as $$
  select greatest(0, 20 - coalesce(sum(credits) filter (
    where state = 'complete' or (state = 'pending' and created_at > now() - interval '3 minutes')
  ), 0))::integer
  from public.billing_hook_requests
  where user_id = p_user_id and test_mode = p_test_mode and period_started_at = p_period_started_at;
$$;

create function public.reserve_billing_hook(
  p_id uuid, p_user_id uuid, p_provider_id text, p_test_mode boolean,
  p_period_started_at timestamptz, p_credits integer, p_monthly_budget_micros integer
) returns text language plpgsql set search_path = '' as $$
declare
  reservation integer;
  cycle_reserved bigint;
  month_reserved bigint;
begin
  if p_id is null or p_credits is null or p_credits not between 1 and 20
    or coalesce(p_monthly_budget_micros, 0) <= 0 then
    return 'budget';
  end if;
  reservation := p_credits * 20000;

  -- Serialize the budget check and reservation across accounts and billing modes.
  perform pg_advisory_xact_lock(124625133, 195124414);
  perform 1 from public.billing_subscriptions
  where provider_id = p_provider_id and user_id = p_user_id and test_mode = p_test_mode
    and period_started_at = p_period_started_at and period_started_at <= now() and active_until > now()
    and status in ('active', 'cancelled')
  for update;
  if not found then return 'inactive'; end if;

  if public.billing_hook_balance(p_user_id, p_test_mode, p_period_started_at) < p_credits then
    return 'credits';
  end if;
  select coalesce(sum(reserved_micros), 0) into cycle_reserved
  from public.billing_hook_requests
  where user_id = p_user_id and test_mode = p_test_mode and period_started_at = p_period_started_at;
  select coalesce(sum(reserved_micros), 0) into month_reserved
  from public.billing_hook_requests
  where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  if cycle_reserved + reservation > 1000000 or month_reserved + reservation > p_monthly_budget_micros then
    return 'budget';
  end if;

  insert into public.billing_hook_requests (id, user_id, test_mode, period_started_at, credits, reserved_micros)
  values (p_id, p_user_id, p_test_mode, p_period_started_at, p_credits, reservation)
  on conflict (id) do nothing;
  return case when found then 'reserved' else 'duplicate' end;
end;
$$;

create function public.finish_billing_hook(
  p_id uuid, p_completed boolean, p_input_tokens integer, p_output_tokens integer
) returns void language sql set search_path = '' as $$
  update public.billing_hook_requests
  set state = case when p_completed then 'complete' else 'failed' end,
    input_tokens = p_input_tokens, output_tokens = p_output_tokens
  where id = p_id and state = 'pending';
$$;

revoke all on function public.sync_billing_period(text, uuid, boolean, text, timestamptz, timestamptz, timestamptz),
  public.billing_hook_balance(uuid, boolean, timestamptz),
  public.reserve_billing_hook(uuid, uuid, text, boolean, timestamptz, integer, integer),
  public.finish_billing_hook(uuid, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.sync_billing_period(text, uuid, boolean, text, timestamptz, timestamptz, timestamptz),
  public.billing_hook_balance(uuid, boolean, timestamptz),
  public.reserve_billing_hook(uuid, uuid, text, boolean, timestamptz, integer, integer),
  public.finish_billing_hook(uuid, boolean, integer, integer) to service_role;
