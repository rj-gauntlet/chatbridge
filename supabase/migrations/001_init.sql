-- ============================================================
-- ChatBridge — Initial Schema Migration  (idempotent)
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- CONVERSATIONS
-- ============================================================
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New Conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists conversations_user_id_idx  on conversations(user_id);
create index if not exists conversations_updated_at_idx on conversations(updated_at desc);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists conversations_updated_at on conversations;
create trigger conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at();

-- ============================================================
-- MESSAGES
-- ============================================================
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content         text not null default '',
  tool_call_id    text,
  tool_name       text,
  app_context     jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on messages(conversation_id);
create index if not exists messages_created_at_idx      on messages(created_at asc);

-- ============================================================
-- APP REGISTRATIONS
-- ============================================================
create table if not exists app_registrations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  description   text not null,
  icon_url      text,
  iframe_url    text not null,
  auth_type     text not null check (auth_type in ('internal', 'public', 'oauth2')) default 'internal',
  oauth_config  jsonb,
  tools         jsonb not null default '[]'::jsonb,
  webhook_url   text,
  status        text not null check (status in ('active', 'disabled', 'pending_review')) default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists app_registrations_updated_at on app_registrations;
create trigger app_registrations_updated_at
  before update on app_registrations
  for each row execute function update_updated_at();

-- ============================================================
-- TOOL INVOCATIONS
-- ============================================================
create table if not exists tool_invocations (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id      uuid references messages(id) on delete set null,
  app_id          uuid not null references app_registrations(id) on delete cascade,
  tool_name       text not null,
  parameters      jsonb not null default '{}'::jsonb,
  result          jsonb,
  duration_ms     integer,
  status          text not null check (status in ('success', 'error', 'timeout')) default 'success',
  created_at      timestamptz not null default now()
);

create index if not exists tool_invocations_conversation_id_idx on tool_invocations(conversation_id);

-- ============================================================
-- OAUTH TOKENS
-- ============================================================
create table if not exists oauth_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  app_id        uuid not null references app_registrations(id) on delete cascade,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  scopes        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(user_id, app_id)
);

drop trigger if exists oauth_tokens_updated_at on oauth_tokens;
create trigger oauth_tokens_updated_at
  before update on oauth_tokens
  for each row execute function update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table conversations    enable row level security;
alter table messages         enable row level security;
alter table app_registrations enable row level security;
alter table tool_invocations  enable row level security;
alter table oauth_tokens      enable row level security;

-- Drop and recreate policies so re-runs don't fail
drop policy if exists "conversations_own"         on conversations;
drop policy if exists "messages_own"              on messages;
drop policy if exists "app_registrations_read"    on app_registrations;
drop policy if exists "tool_invocations_own"      on tool_invocations;
drop policy if exists "oauth_tokens_own"          on oauth_tokens;

create policy "conversations_own" on conversations
  using (auth.uid() = user_id);

create policy "messages_own" on messages
  using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
      and c.user_id = auth.uid()
    )
  );

create policy "app_registrations_read" on app_registrations
  for select using (auth.role() = 'authenticated');

create policy "tool_invocations_own" on tool_invocations
  using (
    exists (
      select 1 from conversations c
      where c.id = tool_invocations.conversation_id
      and c.user_id = auth.uid()
    )
  );

create policy "oauth_tokens_own" on oauth_tokens
  using (auth.uid() = user_id);
