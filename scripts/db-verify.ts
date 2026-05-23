/**
 * Sanity check after `db:migrate`: confirms every enum, table, index, view, and
 * cleanup function from schema.sql exists in the live DB. Fails loudly if any
 * are missing — drift between schema.sql and the live DB is the failure mode
 * we most want to catch.
 */
import { loadEnvConfig } from '@next/env';
import postgres from 'postgres';

loadEnvConfig(process.cwd());

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DIRECT_URL or DATABASE_URL must be set.');
  process.exit(1);
}

const EXPECTED_ENUMS = [
  'order_state',
  'qc_status',
  'payment_mode',
  'user_role',
  'tracking_source',
  'call_request_status',
  'notification_status',
  'mockup_replacement_reason',
];

const EXPECTED_TABLES = [
  'users',
  'orders',
  'order_items',
  'mockup_history',
  'tag_definitions',
  'order_tags',
  'order_status_history',
  'call_requests',
  'notifications_log',
  'otp_codes',
  'shopify_webhook_events',
];

const EXPECTED_VIEWS = ['customer_order_view'];

const EXPECTED_FUNCTIONS = [
  'touch_updated_at',
  'purge_delivered_orders',
  'purge_soft_deleted_orders',
  'purge_old_webhook_events',
  'purge_expired_otps',
  'purge_old_call_requests',
];

const EXPECTED_INDEXES = [
  'idx_orders_state',
  'idx_orders_phone',
  'idx_orders_order_number',
  'idx_orders_shipped_at',
  'idx_orders_delivered_purge',
  'idx_orders_deleted_purge',
  'idx_items_order_id',
  'idx_items_qc_status',
  'idx_items_qc_pending',
  'idx_mh_item',
  'idx_otags_order',
  'idx_otags_name',
  'idx_osh_order_id',
  'idx_call_requests_status',
  'idx_call_requests_phone',
  'idx_notif_order_id',
  'idx_notif_scheduled',
  'idx_notif_template',
  'idx_otp_phone_order',
  'idx_otp_expires',
  'idx_swe_topic',
  'idx_swe_purge',
];

const EXPECTED_TRIGGERS = ['trg_orders_updated_at', 'trg_users_updated_at', 'trg_items_updated_at'];

async function main() {
  const sql = postgres(url!, { max: 1 });
  const missing: string[] = [];

  const enums = await sql<{ typname: string }[]>`
    select typname from pg_type
    where typtype = 'e' and typnamespace = 'public'::regnamespace
  `;
  const enumNames = new Set(enums.map((e) => e.typname));
  for (const e of EXPECTED_ENUMS) if (!enumNames.has(e)) missing.push(`enum: ${e}`);

  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'
  `;
  const tableNames = new Set(tables.map((t) => t.tablename));
  for (const t of EXPECTED_TABLES) if (!tableNames.has(t)) missing.push(`table: ${t}`);

  const views = await sql<{ viewname: string }[]>`
    select viewname from pg_views where schemaname = 'public'
  `;
  const viewNames = new Set(views.map((v) => v.viewname));
  for (const v of EXPECTED_VIEWS) if (!viewNames.has(v)) missing.push(`view: ${v}`);

  const fns = await sql<{ proname: string }[]>`
    select proname from pg_proc
    where pronamespace = 'public'::regnamespace
  `;
  const fnNames = new Set(fns.map((f) => f.proname));
  for (const f of EXPECTED_FUNCTIONS) if (!fnNames.has(f)) missing.push(`function: ${f}`);

  const indexes = await sql<{ indexname: string }[]>`
    select indexname from pg_indexes where schemaname = 'public'
  `;
  const indexNames = new Set(indexes.map((i) => i.indexname));
  for (const i of EXPECTED_INDEXES) if (!indexNames.has(i)) missing.push(`index: ${i}`);

  const triggers = await sql<{ tgname: string }[]>`
    select tgname from pg_trigger
    where not tgisinternal and tgrelid in (
      select oid from pg_class where relnamespace = 'public'::regnamespace
    )
  `;
  const triggerNames = new Set(triggers.map((t) => t.tgname));
  for (const t of EXPECTED_TRIGGERS) if (!triggerNames.has(t)) missing.push(`trigger: ${t}`);

  await sql.end();

  console.log(`Enums:     ${EXPECTED_ENUMS.length - missing.filter((m) => m.startsWith('enum:')).length}/${EXPECTED_ENUMS.length}`);
  console.log(`Tables:    ${EXPECTED_TABLES.length - missing.filter((m) => m.startsWith('table:')).length}/${EXPECTED_TABLES.length}`);
  console.log(`Views:     ${EXPECTED_VIEWS.length - missing.filter((m) => m.startsWith('view:')).length}/${EXPECTED_VIEWS.length}`);
  console.log(`Functions: ${EXPECTED_FUNCTIONS.length - missing.filter((m) => m.startsWith('function:')).length}/${EXPECTED_FUNCTIONS.length}`);
  console.log(`Indexes:   ${EXPECTED_INDEXES.length - missing.filter((m) => m.startsWith('index:')).length}/${EXPECTED_INDEXES.length}`);
  console.log(`Triggers:  ${EXPECTED_TRIGGERS.length - missing.filter((m) => m.startsWith('trigger:')).length}/${EXPECTED_TRIGGERS.length}`);

  if (missing.length > 0) {
    console.error('\nMISSING:');
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.log('\nAll expected schema objects present.');
}

main().catch((err) => {
  console.error('Verify failed:', err);
  process.exit(1);
});
