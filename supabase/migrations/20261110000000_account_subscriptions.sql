create table public.billing_subscriptions (
  provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  test_mode boolean not null,
  status text not null,
  active_until timestamptz,
  provider_updated_at timestamptz not null,
  primary key (provider_id, test_mode)
);

create index billing_subscriptions_account_idx
  on public.billing_subscriptions (user_id, test_mode);

alter table public.billing_subscriptions enable row level security;
revoke all on public.billing_subscriptions from public, anon, authenticated;
grant select, insert, update on public.billing_subscriptions to service_role;

create function public.sync_billing_subscription(
  p_provider_id text,
  p_user_id uuid,
  p_test_mode boolean,
  p_status text,
  p_active_until timestamptz,
  p_updated_at timestamptz
) returns void language plpgsql set search_path = '' as $$
begin
  if p_user_id is null then
    update public.billing_subscriptions
    set status = p_status, active_until = p_active_until, provider_updated_at = p_updated_at
    where provider_id = p_provider_id and test_mode = p_test_mode
      and provider_updated_at < p_updated_at;
    return;
  end if;

  insert into public.billing_subscriptions as current_subscription
    (provider_id, user_id, test_mode, status, active_until, provider_updated_at)
  values (p_provider_id, p_user_id, p_test_mode, p_status, p_active_until, p_updated_at)
  on conflict (provider_id, test_mode) do update
  set status = excluded.status, active_until = excluded.active_until,
      provider_updated_at = excluded.provider_updated_at
  where current_subscription.user_id = excluded.user_id
    and current_subscription.test_mode = excluded.test_mode
    and current_subscription.provider_updated_at < excluded.provider_updated_at;
end;
$$;

revoke all on function public.sync_billing_subscription(text, uuid, boolean, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.sync_billing_subscription(text, uuid, boolean, text, timestamptz, timestamptz)
  to service_role;

create table public.billing_checkout_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  test_mode boolean not null,
  attempt_id uuid not null,
  expires_at timestamptz not null,
  url text,
  primary key (user_id, test_mode)
);

alter table public.billing_checkout_sessions enable row level security;
revoke all on public.billing_checkout_sessions from public, anon, authenticated;
grant select, insert, update on public.billing_checkout_sessions to service_role;

create function public.reserve_billing_checkout(p_user_id uuid, p_test_mode boolean, p_attempt_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  existing_url text;
begin
  insert into public.billing_checkout_sessions as existing
    (user_id, test_mode, attempt_id, expires_at)
  values (p_user_id, p_test_mode, p_attempt_id, now() + interval '30 seconds')
  on conflict (user_id, test_mode) do update
  set attempt_id = excluded.attempt_id, expires_at = excluded.expires_at, url = null
  where existing.expires_at <= now();

  if found then
    return jsonb_build_object('reserved', true);
  end if;

  select session.url into existing_url from public.billing_checkout_sessions as session
  where session.user_id = p_user_id and session.test_mode = p_test_mode;
  return jsonb_build_object('reserved', false, 'url', existing_url);
end;
$$;

create function public.complete_billing_checkout(
  p_user_id uuid, p_test_mode boolean, p_attempt_id uuid, p_url text, p_expires_at timestamptz
) returns boolean language plpgsql set search_path = '' as $$
begin
  update public.billing_checkout_sessions
  set url = p_url, expires_at = p_expires_at
  where user_id = p_user_id and test_mode = p_test_mode and attempt_id = p_attempt_id;
  return found;
end;
$$;

revoke all on function public.reserve_billing_checkout(uuid, boolean, uuid),
  public.complete_billing_checkout(uuid, boolean, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_billing_checkout(uuid, boolean, uuid),
  public.complete_billing_checkout(uuid, boolean, uuid, text, timestamptz) to service_role;
