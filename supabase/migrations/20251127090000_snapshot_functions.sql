-- Migration: introduce helper functions for efficient history retrieval & pruning
-- Date: 2025-11-27

create or replace function public.get_recent_check_history(
  limit_per_config integer default 60,
  target_config_ids uuid[] default null
)
returns table (
  config_id uuid,
  status text,
  latency_ms integer,
  ping_latency_ms integer,
  checked_at timestamptz,
  message text,
  name text,
  type text,
  model text,
  endpoint text,
  group_name text
)
language sql
stable
as $$
  with ranked as (
    select
      h.id as history_id,
      h.config_id,
      h.status,
      h.latency_ms,
      h.ping_latency_ms,
      h.checked_at,
      h.message,
      row_number() over (partition by h.config_id order by h.checked_at desc) as rn
    from check_history h
    where target_config_ids is null or h.config_id = any(target_config_ids)
  )
  select
    r.config_id,
    r.status,
    r.latency_ms,
    r.ping_latency_ms,
    r.checked_at,
    r.message,
    c.name,
    c.type,
    c.model,
    c.endpoint,
    c.group_name
  from ranked r
  join check_configs c on c.id = r.config_id
  where r.rn <= limit_per_config
  order by c.name asc, r.checked_at desc;
$$;

create or replace function public.prune_check_history(
  limit_per_config integer default 60
)
returns void
language sql
volatile
as $$
  with ranked as (
    select
      id,
      row_number() over (partition by config_id order by checked_at desc) as rn
    from check_history
  )
  delete from check_history
  where id in (
    select id from ranked where rn > limit_per_config
  );
$$;
