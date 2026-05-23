import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* ── Custom types ───────────────────────────────────────────────────────── */

// citext gives case-insensitive equality at the DB level (emails). The
// pgcrypto + citext extensions are created in 0000_init.sql.
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/* ── Enums ──────────────────────────────────────────────────────────────── */

export const orderState = pgEnum('order_state', [
  'approval_pending',
  'in_production',
  'qc_passed',
  'shipped',
  'delivered',
]);

export const qcStatus = pgEnum('qc_status', ['passed', 'failed']);

export const paymentMode = pgEnum('payment_mode', ['prepaid', 'cod']);

export const userRole = pgEnum('user_role', ['production', 'qc', 'shipment', 'admin']);

export const trackingSource = pgEnum('tracking_source', ['shopify', 'shipmozo', 'manual']);

export const callRequestStatus = pgEnum('call_request_status', ['new', 'attended', 'dismissed']);

export const notificationStatus = pgEnum('notification_status', [
  'queued',
  'scheduled',
  'sent',
  'failed',
  'cancelled',
]);

export const mockupReplacementReason = pgEnum('mockup_replacement_reason', [
  'customer_requested_change',
  'design_error',
  'file_corruption',
  'other',
]);

/* ── Tables ─────────────────────────────────────────────────────────────── */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: userRole('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockoutUntil: timestamp('lockout_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    // Shopify
    shopifyOrderId: text('shopify_order_id').notNull().unique(),
    shopifyOrderNumber: text('shopify_order_number').notNull(),
    shopifyOrderName: text('shopify_order_name').notNull(),
    shopifyTags: text('shopify_tags').array().default(sql`'{}'::text[]`),

    // Customer
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: citext('customer_email'),
    shippingAddress: jsonb('shipping_address'),

    // Payment
    paymentMode: paymentMode('payment_mode'),
    codAmount: numeric('cod_amount', { precision: 10, scale: 2 }),
    totalAmount: numeric('total_amount', { precision: 10, scale: 2 }),
    currency: text('currency').default('INR'),

    // Workflow
    state: orderState('state').notNull().default('approval_pending'),

    // Tab 1 audit
    tab1CompletedAt: timestamp('tab1_completed_at', { withTimezone: true }),
    tab1CompletedBy: uuid('tab1_completed_by').references(() => users.id),

    // QC tracking (aggregated)
    qcGraceStartedAt: timestamp('qc_grace_started_at', { withTimezone: true }),
    qcGraceNotificationId: uuid('qc_grace_notification_id'),
    qcAttempts: integer('qc_attempts').notNull().default(0),
    lastQcAt: timestamp('last_qc_at', { withTimezone: true }),

    // Shipment
    shipmentLabelGeneratedAt: timestamp('shipment_label_generated_at', { withTimezone: true }),
    shipmentMarkedBy: uuid('shipment_marked_by').references(() => users.id),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    trackingCarrier: text('tracking_carrier'),
    trackingSource: trackingSource('tracking_source'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    // Soft delete
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
    deleteReason: text('delete_reason'),

    // Audit
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_orders_state')
      .on(t.state)
      .where(sql`deleted_at is null`),
    index('idx_orders_phone')
      .on(t.customerPhone)
      .where(sql`deleted_at is null`),
    index('idx_orders_order_number').on(t.shopifyOrderNumber),
    index('idx_orders_shipped_at')
      .on(sql`shipped_at desc`)
      .where(sql`shipped_at is not null`),
    index('idx_orders_delivered_purge')
      .on(t.deliveredAt)
      .where(sql`delivered_at is not null`),
    index('idx_orders_deleted_purge')
      .on(t.deletedAt)
      .where(sql`deleted_at is not null`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    // Shopify
    shopifyLineItemId: text('shopify_line_item_id').notNull(),
    title: text('title').notNull(),
    variantTitle: text('variant_title'),
    sku: text('sku'),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),

    // Mockup files
    mockupSourceUrl: text('mockup_source_url'),
    mockupThumbnailUrl: text('mockup_thumbnail_url'),
    mockupUploadedAt: timestamp('mockup_uploaded_at', { withTimezone: true }),
    mockupReplacedCount: integer('mockup_replaced_count').notNull().default(0),

    // Customization
    namesText: text('names_text'),
    customizationNotes: text('customization_notes'),

    // QC (per item)
    qcStatus: qcStatus('qc_status'),
    qcFailureReason: text('qc_failure_reason'),
    qcPhotoUrl: text('qc_photo_url'),
    qcAttempts: integer('qc_attempts').notNull().default(0),
    qcAt: timestamp('qc_at', { withTimezone: true }),
    qcBy: uuid('qc_by').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('order_items_order_id_shopify_line_item_id_unique').on(
      t.orderId,
      t.shopifyLineItemId,
    ),
    index('idx_items_order_id').on(t.orderId),
    index('idx_items_qc_status').on(t.qcStatus),
    index('idx_items_qc_pending')
      .on(t.orderId)
      .where(sql`qc_status is null`),
  ],
);

export const mockupHistory = pgTable(
  'mockup_history',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    previousSourceUrl: text('previous_source_url'),
    previousThumbnailUrl: text('previous_thumbnail_url'),
    sourceReplaced: boolean('source_replaced').notNull(),
    thumbnailReplaced: boolean('thumbnail_replaced').notNull(),
    reason: mockupReplacementReason('reason').notNull(),
    notes: text('notes'),
    notifiedCustomer: boolean('notified_customer').notNull().default(false),
    replacedAt: timestamp('replaced_at', { withTimezone: true }).notNull().defaultNow(),
    replacedBy: uuid('replaced_by').references(() => users.id),
  },
  (t) => [
    index('idx_mh_item').on(t.orderItemId, sql`replaced_at desc`),
    check('mockup_history_at_least_one', sql`source_replaced or thumbnail_replaced`),
  ],
);

export const tagDefinitions = pgTable('tag_definitions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  isCustomerVisibleDefault: boolean('is_customer_visible_default').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderTags = pgTable(
  'order_tags',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    tagName: text('tag_name').notNull(),
    isCustomerVisible: boolean('is_customer_visible').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('order_tags_order_id_tag_name_unique').on(t.orderId, t.tagName),
    index('idx_otags_order').on(t.orderId),
    index('idx_otags_name').on(t.tagName),
  ],
);

export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromState: orderState('from_state'),
    toState: orderState('to_state').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_osh_order_id').on(t.orderId, sql`created_at desc`)],
);

export const callRequests = pgTable(
  'call_requests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    customerPhone: text('customer_phone').notNull(),
    customerName: text('customer_name'),
    reason: text('reason').notNull(),
    notes: text('notes'),
    status: callRequestStatus('status').notNull().default('new'),
    attendedBy: uuid('attended_by').references(() => users.id),
    attendedAt: timestamp('attended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_call_requests_status').on(t.status, sql`created_at desc`),
    index('idx_call_requests_phone').on(t.customerPhone),
  ],
);

export const notificationsLog = pgTable(
  'notifications_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    channel: text('channel').notNull().default('whatsapp'),
    templateKey: text('template_key').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    payload: jsonb('payload'),
    response: jsonb('response'),
    status: notificationStatus('status').notNull().default('queued'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notif_order_id').on(t.orderId, sql`created_at desc`),
    index('idx_notif_scheduled')
      .on(t.scheduledFor)
      .where(sql`status = 'scheduled'`),
    index('idx_notif_template').on(t.templateKey, sql`created_at desc`),
  ],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    phone: text('phone').notNull(),
    orderNumber: text('order_number').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_otp_phone_order').on(t.phone, t.orderNumber, sql`created_at desc`),
    index('idx_otp_expires').on(t.expiresAt),
  ],
);

export const shopifyWebhookEvents = pgTable(
  'shopify_webhook_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    topic: text('topic').notNull(),
    shopifyOrderId: text('shopify_order_id'),
    webhookId: text('webhook_id').unique(),
    rawBody: jsonb('raw_body').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_swe_topic').on(t.topic, sql`created_at desc`),
    index('idx_swe_purge').on(t.createdAt),
  ],
);

/* ── View ───────────────────────────────────────────────────────────────── */

// customer_order_view is created in the migration SQL (drizzle-kit can't
// model nested EXISTS + array_agg). This declaration exists so the ORM
// can type-check `db.select().from(customerOrderView)` calls.
export const customerOrderView = pgView('customer_order_view', {
  orderId: uuid('order_id').notNull(),
  orderNumber: text('order_number').notNull(),
  customerPhone: text('customer_phone').notNull(),
  customerName: text('customer_name').notNull(),
  state: orderState('state').notNull(),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  trackingUrl: text('tracking_url'),
  trackingCarrier: text('tracking_carrier'),
  trackingNumber: text('tracking_number'),
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }),
  currency: text('currency'),
  anyItemInRedo: boolean('any_item_in_redo').notNull(),
  items: jsonb('items').notNull(),
  visibleTags: text('visible_tags').array().notNull(),
}).existing();

/* ── Type exports ───────────────────────────────────────────────────────── */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
