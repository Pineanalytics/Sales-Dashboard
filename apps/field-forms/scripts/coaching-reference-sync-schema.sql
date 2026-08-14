-- Audit records for the controlled Pinefrost Analytics outlet baseline.
create table if not exists public.coaching_reference_sync_runs (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  message text,
  stats jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coaching_reference_sync_runs_form_created_idx
  on public.coaching_reference_sync_runs (form_id, created_at desc);

create table if not exists public.coaching_reference_sync_exceptions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  source_key text not null,
  customer_id text not null,
  principal text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, source_key)
);

create index if not exists coaching_reference_sync_exceptions_form_status_idx
  on public.coaching_reference_sync_exceptions (form_id, status, created_at desc);
