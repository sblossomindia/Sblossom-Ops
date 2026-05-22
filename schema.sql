-- =====================================================================
-- Sblossom Operations DB Schema (v2)
-- Target: Postgres 15+ (Supabase Free tier)
--
-- ARCHITECTURE NOTE: This database is a TRANSIENT OPERATIONAL CACHE.
-- Shopify is the system of record for orders. Completed orders are
-- DELETED 30 days after delivery. Do not add backup/PITR concerns —
-- the design assumes data loss is acceptable.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- Enums --------------------------------------------------------------
create type order_state as enum (
  'approval_pending',
  'in_production',
  'qc_passed',
  'shipped',
  'delivered'
);

create type qc_status as enum ('passed', 'failed');

create type payment_mode as enum ('prepaid', 'cod');

create type user_role as enum ('production', 'qc', 'shipment', 'admin');

create type tracking_source as enum ('shopify', 'shipmozo', 'manual');

create type call_request_status as enum ('new', 'attended', 'dismissed');

create type notification_status as enum ('queued', 'scheduled', 'sent', 'failed', 'cancelled');

create type mockup_replacement_reason as enum (
  'customer_requested_change',
  'design_error',
  'file_corruption',
  'other'
);


-- Employees ----------------------------------------------------------
create table users (
  id                      uuid primary key default gen_random_uuid(),
  email                   citext unique not null,
  password_hash           text not null,
  name                    text not null,
  role                    user_role not null,
  is_active               boolean not null default true,
  failed_login_attempts   int not null default 0,
  lockout_until           timestamptz,
  last_login_at           timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);


-- Orders (shipment-level) --------------------------------------------
create table orders (
  id                          uuid primary key default gen_random_uuid(),

  -- Shopify
  shopify_order_id            text unique not null,
  shopify_order_number        text not null,
  shopify_order_name          text not null,
  shopify_tags                text[] default '{}'::text[],

  -- Customer
  customer_name               text not null,
  customer_phone              text not null,
  customer_email              citext,
  shipping_address            jsonb,

  -- Payment
  payment_mode                payment_mode,
  cod_amount                  numeric(10,2),
  total_amount                numeric(10,2),
  currency                    text default 'INR',

  -- Workflow
  state                       order_state not null default 'approval_pending',

  -- Tab 1 audit
  tab1_completed_at           timestamptz,
  tab1_completed_by           uuid references users(id),

  -- QC tracking (aggregated across items)
  qc_grace_started_at         timestamptz,  -- when 1h grace period began
  qc_grace_notification_id    uuid,         -- pointer to the queued notification row
  qc_attempts                 int not null default 0,
  last_qc_at                  timestamptz,

  -- Shipment
  shipment_label_generated_at timestamptz,
  shipment_marked_by          uuid references users(id),
  tracking_number             text,
  tracking_url                text,
  tracking_carrier            text,
  tracking_source             tracking_source,
  shipped_at                  timestamptz,
  delivered_at                timestamptz,

  -- Soft delete (admin pre-QC only)
  deleted_at                  timestamptz,
  deleted_by                  uuid references users(id),
  delete_reason               text,

  -- Audit
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index idx_orders_state              on orders (state) where deleted_at is null;
create index idx_orders_phone              on orders (customer_phone) where deleted_at is null;
create index idx_orders_order_number       on orders (shopify_order_number);
create index idx_orders_shipped_at         on orders (shipped_at desc) where shipped_at is not null;
create index idx_orders_delivered_purge    on orders (delivered_at) where delivered_at is not null;
create index idx_orders_deleted_purge      on orders (deleted_at) where deleted_at is not null;


-- Order items (per-line-item state) ----------------------------------
create table order_items (
  id                       uuid primary key default gen_random_uuid(),
  order_id                 uuid not null references orders(id) on delete cascade,

  -- Shopify
  shopify_line_item_id     text not null,
  title                    text not null,
  variant_title            text,
  sku                      text,
  quantity                 int not null default 1,
  unit_price               numeric(10,2),

  -- Mockup files (one PSD per item, plus thumbnail)
  mockup_source_url        text,                -- R2 URL for PSD
  mockup_thumbnail_url     text,                -- R2 URL for PNG/JPG preview
  mockup_uploaded_at       timestamptz,
  mockup_replaced_count    int not null default 0,

  -- Customization
  names_text               text,
  customization_notes      text,

  -- QC (per item)
  qc_status                qc_status,           -- null until first QC
  qc_failure_reason        text,
  qc_photo_url             text,                -- R2 URL for QC verification photo
  qc_attempts              int not null default 0,
  qc_at                    timestamptz,
  qc_by                    uuid references users(id),

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (order_id, shopify_line_item_id)
);

create index idx_items_order_id          on order_items (order_id);
create index idx_items_qc_status         on order_items (qc_status);
create index idx_items_qc_pending        on order_items (order_id) where qc_status is null;


-- Mockup history -----------------------------------------------------
create table mockup_history (
  id                       uuid primary key default gen_random_uuid(),
  order_item_id            uuid not null references order_items(id) on delete cascade,
  previous_source_url      text,
  previous_thumbnail_url   text,
  source_replaced          boolean not null,
  thumbnail_replaced       boolean not null,
  reason                   mockup_replacement_reason not null,
  notes                    text,
  notified_customer        boolean not null default false,
  replaced_at              timestamptz not null default now(),
  replaced_by              uuid references users(id),
  check (source_replaced or thumbnail_replaced)
);

create index idx_mh_item   on mockup_history (order_item_id, replaced_at desc);


-- Tag definitions (admin-managed dictionary) -------------------------
create table tag_definitions (
  id                            uuid primary key default gen_random_uuid(),
  name                          text unique not null,
  is_customer_visible_default   boolean not null default false,
  created_by                    uuid references users(id),
  created_at                    timestamptz not null default now()
);


-- Order tags (many-to-many style) ------------------------------------
create table order_tags (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id) on delete cascade,
  tag_name              text not null,
  is_customer_visible   boolean not null default false,
  created_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  unique (order_id, tag_name)
);

create index idx_otags_order on order_tags (order_id);
create index idx_otags_name  on order_tags (tag_name);


-- Order status history -----------------------------------------------
create table order_status_history (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  from_state      order_state,
  to_state        order_state not null,
  actor_user_id   uuid references users(id),
  reason          text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index idx_osh_order_id  on order_status_history (order_id, created_at desc);


-- Call requests ------------------------------------------------------
create table call_requests (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references orders(id) on delete set null,
  customer_phone  text not null,
  customer_name   text,
  reason          text not null,
  notes           text,
  status          call_request_status not null default 'new',
  attended_by     uuid references users(id),
  attended_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index idx_call_requests_status   on call_requests (status, created_at desc);
create index idx_call_requests_phone    on call_requests (customer_phone);


-- Notifications log --------------------------------------------------
create table notifications_log (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references orders(id) on delete set null,
  channel         text not null default 'whatsapp',
  template_key    text not null,
  recipient_phone text not null,
  payload         jsonb,
  response        jsonb,
  status          notification_status not null default 'queued',
  scheduled_for   timestamptz,                 -- for the 1h QC grace queue
  sent_at         timestamptz,
  error_message   text,
  created_at      timestamptz not null default now()
);

create index idx_notif_order_id     on notifications_log (order_id, created_at desc);
create index idx_notif_scheduled    on notifications_log (scheduled_for) where status = 'scheduled';
create index idx_notif_template     on notifications_log (template_key, created_at desc);


-- Customer OTP codes -------------------------------------------------
create table otp_codes (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null,
  order_number    text not null,
  code_hash       text not null,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  attempts        int not null default 0,
  created_at      timestamptz not null default now()
);

create index idx_otp_phone_order    on otp_codes (phone, order_number, created_at desc);
create index idx_otp_expires        on otp_codes (expires_at);


-- Shopify webhook events --------------------------------------------
create table shopify_webhook_events (
  id              uuid primary key default gen_random_uuid(),
  topic           text not null,
  shopify_order_id text,
  webhook_id      text unique,                 -- for idempotency
  raw_body        jsonb not null,
  processed_at    timestamptz,
  error_message   text,
  created_at      timestamptz not null default now()
);

create index idx_swe_topic   on shopify_webhook_events (topic, created_at desc);
create index idx_swe_purge   on shopify_webhook_events (created_at);


-- updated_at touch trigger -------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_orders_updated_at
  before update on orders
  for each row execute function touch_updated_at();

create trigger trg_users_updated_at
  before update on users
  for each row execute function touch_updated_at();

create trigger trg_items_updated_at
  before update on order_items
  for each row execute function touch_updated_at();


-- Customer-facing view -----------------------------------------------
create or replace view customer_order_view as
select
  o.id                            as order_id,
  o.shopify_order_number          as order_number,
  o.customer_phone,
  o.customer_name,
  o.state,
  o.shipped_at,
  o.delivered_at,
  o.tracking_url,
  o.tracking_carrier,
  o.tracking_number,
  o.total_amount,
  o.currency,
  -- Aggregate any-item-failed signal for the redo badge
  exists (
    select 1 from order_items oi
    where oi.order_id = o.id and oi.qc_status = 'failed'
      and not exists (
        -- "still failing": no later passed status for this item
        select 1 from order_items oi2
        where oi2.id = oi.id and oi2.qc_status = 'passed'
      )
  ) as any_item_in_redo,
  -- Items as JSON
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'title', oi.title,
      'variant_title', oi.variant_title,
      'thumbnail_url', oi.mockup_thumbnail_url,
      'names_text', oi.names_text,
      'quantity', oi.quantity
    )), '[]'::jsonb)
    from order_items oi where oi.order_id = o.id
  ) as items,
  -- Customer-visible tags only
  (
    select coalesce(array_agg(t.tag_name order by t.tag_name), '{}'::text[])
    from order_tags t
    where t.order_id = o.id and t.is_customer_visible = true
  ) as visible_tags
from orders o
where o.deleted_at is null;


-- Cleanup functions (called by cron) ---------------------------------
-- Purge orders 30 days after delivery
create or replace function purge_delivered_orders()
returns int language plpgsql as $$
declare
  purged_count int;
begin
  with deleted as (
    delete from orders
    where delivered_at is not null
      and delivered_at < now() - interval '30 days'
    returning id
  )
  select count(*) into purged_count from deleted;
  return purged_count;
end;
$$;

-- Purge soft-deleted orders 30 days after deletion
create or replace function purge_soft_deleted_orders()
returns int language plpgsql as $$
declare
  purged_count int;
begin
  with deleted as (
    delete from orders
    where deleted_at is not null
      and deleted_at < now() - interval '30 days'
    returning id
  )
  select count(*) into purged_count from deleted;
  return purged_count;
end;
$$;

-- Purge old webhook events (7 day retention)
create or replace function purge_old_webhook_events()
returns int language plpgsql as $$
declare
  purged_count int;
begin
  with deleted as (
    delete from shopify_webhook_events
    where created_at < now() - interval '7 days'
    returning id
  )
  select count(*) into purged_count from deleted;
  return purged_count;
end;
$$;

-- Purge expired OTPs
create or replace function purge_expired_otps()
returns int language plpgsql as $$
declare
  purged_count int;
begin
  with deleted as (
    delete from otp_codes
    where expires_at < now() - interval '1 hour'
       or used_at is not null
    returning id
  )
  select count(*) into purged_count from deleted;
  return purged_count;
end;
$$;

-- Purge old call requests (90 day retention)
create or replace function purge_old_call_requests()
returns int language plpgsql as $$
declare
  purged_count int;
begin
  with deleted as (
    delete from call_requests
    where created_at < now() - interval '90 days'
    returning id
  )
  select count(*) into purged_count from deleted;
  return purged_count;
end;
$$;

-- Note: R2 file cleanup happens in app code, not in SQL. The cron job
-- that calls purge_delivered_orders() also walks the order_items and
-- mockup_history rows BEFORE deletion to collect R2 keys, then deletes
-- the files after the DB rows are purged.
