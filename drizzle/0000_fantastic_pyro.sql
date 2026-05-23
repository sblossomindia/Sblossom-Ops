CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
CREATE TYPE "public"."call_request_status" AS ENUM('new', 'attended', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."mockup_replacement_reason" AS ENUM('customer_requested_change', 'design_error', 'file_corruption', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'scheduled', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_state" AS ENUM('approval_pending', 'in_production', 'qc_passed', 'shipped', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('prepaid', 'cod');--> statement-breakpoint
CREATE TYPE "public"."qc_status" AS ENUM('passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tracking_source" AS ENUM('shopify', 'shipmozo', 'manual');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('production', 'qc', 'shipment', 'admin');--> statement-breakpoint
CREATE TABLE "call_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"customer_phone" text NOT NULL,
	"customer_name" text,
	"reason" text NOT NULL,
	"notes" text,
	"status" "call_request_status" DEFAULT 'new' NOT NULL,
	"attended_by" uuid,
	"attended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mockup_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"previous_source_url" text,
	"previous_thumbnail_url" text,
	"source_replaced" boolean NOT NULL,
	"thumbnail_replaced" boolean NOT NULL,
	"reason" "mockup_replacement_reason" NOT NULL,
	"notes" text,
	"notified_customer" boolean DEFAULT false NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_by" uuid,
	CONSTRAINT "mockup_history_at_least_one" CHECK (source_replaced or thumbnail_replaced)
);
--> statement-breakpoint
CREATE TABLE "notifications_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"template_key" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"payload" jsonb,
	"response" jsonb,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_line_item_id" text NOT NULL,
	"title" text NOT NULL,
	"variant_title" text,
	"sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2),
	"mockup_source_url" text,
	"mockup_thumbnail_url" text,
	"mockup_uploaded_at" timestamp with time zone,
	"mockup_replaced_count" integer DEFAULT 0 NOT NULL,
	"names_text" text,
	"customization_notes" text,
	"qc_status" "qc_status",
	"qc_failure_reason" text,
	"qc_photo_url" text,
	"qc_attempts" integer DEFAULT 0 NOT NULL,
	"qc_at" timestamp with time zone,
	"qc_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_state" "order_state",
	"to_state" "order_state" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"tag_name" text NOT NULL,
	"is_customer_visible" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopify_order_id" text NOT NULL,
	"shopify_order_number" text NOT NULL,
	"shopify_order_name" text NOT NULL,
	"shopify_tags" text[] DEFAULT '{}'::text[],
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" "citext",
	"shipping_address" jsonb,
	"payment_mode" "payment_mode",
	"cod_amount" numeric(10, 2),
	"total_amount" numeric(10, 2),
	"currency" text DEFAULT 'INR',
	"state" "order_state" DEFAULT 'approval_pending' NOT NULL,
	"tab1_completed_at" timestamp with time zone,
	"tab1_completed_by" uuid,
	"qc_grace_started_at" timestamp with time zone,
	"qc_grace_notification_id" uuid,
	"qc_attempts" integer DEFAULT 0 NOT NULL,
	"last_qc_at" timestamp with time zone,
	"shipment_label_generated_at" timestamp with time zone,
	"shipment_marked_by" uuid,
	"tracking_number" text,
	"tracking_url" text,
	"tracking_carrier" text,
	"tracking_source" "tracking_source",
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_shopify_order_id_unique" UNIQUE("shopify_order_id")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"order_number" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"shopify_order_id" text,
	"webhook_id" text,
	"raw_body" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_webhook_events_webhook_id_unique" UNIQUE("webhook_id")
);
--> statement-breakpoint
CREATE TABLE "tag_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_customer_visible_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_definitions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"lockout_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_attended_by_users_id_fk" FOREIGN KEY ("attended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mockup_history" ADD CONSTRAINT "mockup_history_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mockup_history" ADD CONSTRAINT "mockup_history_replaced_by_users_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD CONSTRAINT "notifications_log_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_qc_by_users_id_fk" FOREIGN KEY ("qc_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_tags" ADD CONSTRAINT "order_tags_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_tags" ADD CONSTRAINT "order_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tab1_completed_by_users_id_fk" FOREIGN KEY ("tab1_completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipment_marked_by_users_id_fk" FOREIGN KEY ("shipment_marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_call_requests_status" ON "call_requests" USING btree ("status",created_at desc);--> statement-breakpoint
CREATE INDEX "idx_call_requests_phone" ON "call_requests" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "idx_mh_item" ON "mockup_history" USING btree ("order_item_id",replaced_at desc);--> statement-breakpoint
CREATE INDEX "idx_notif_order_id" ON "notifications_log" USING btree ("order_id",created_at desc);--> statement-breakpoint
CREATE INDEX "idx_notif_scheduled" ON "notifications_log" USING btree ("scheduled_for") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "idx_notif_template" ON "notifications_log" USING btree ("template_key",created_at desc);--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_id_shopify_line_item_id_unique" ON "order_items" USING btree ("order_id","shopify_line_item_id");--> statement-breakpoint
CREATE INDEX "idx_items_order_id" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_items_qc_status" ON "order_items" USING btree ("qc_status");--> statement-breakpoint
CREATE INDEX "idx_items_qc_pending" ON "order_items" USING btree ("order_id") WHERE qc_status is null;--> statement-breakpoint
CREATE INDEX "idx_osh_order_id" ON "order_status_history" USING btree ("order_id",created_at desc);--> statement-breakpoint
CREATE UNIQUE INDEX "order_tags_order_id_tag_name_unique" ON "order_tags" USING btree ("order_id","tag_name");--> statement-breakpoint
CREATE INDEX "idx_otags_order" ON "order_tags" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_otags_name" ON "order_tags" USING btree ("tag_name");--> statement-breakpoint
CREATE INDEX "idx_orders_state" ON "orders" USING btree ("state") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "idx_orders_phone" ON "orders" USING btree ("customer_phone") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "idx_orders_order_number" ON "orders" USING btree ("shopify_order_number");--> statement-breakpoint
CREATE INDEX "idx_orders_shipped_at" ON "orders" USING btree (shipped_at desc) WHERE shipped_at is not null;--> statement-breakpoint
CREATE INDEX "idx_orders_delivered_purge" ON "orders" USING btree ("delivered_at") WHERE delivered_at is not null;--> statement-breakpoint
CREATE INDEX "idx_orders_deleted_purge" ON "orders" USING btree ("deleted_at") WHERE deleted_at is not null;--> statement-breakpoint
CREATE INDEX "idx_otp_phone_order" ON "otp_codes" USING btree ("phone","order_number",created_at desc);--> statement-breakpoint
CREATE INDEX "idx_otp_expires" ON "otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_swe_topic" ON "shopify_webhook_events" USING btree ("topic",created_at desc);--> statement-breakpoint
CREATE INDEX "idx_swe_purge" ON "shopify_webhook_events" USING btree ("created_at");--> statement-breakpoint

-- ── updated_at touch trigger ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- ── Customer-facing view ──────────────────────────────────────────────
CREATE OR REPLACE VIEW customer_order_view AS
SELECT
  o.id                            AS order_id,
  o.shopify_order_number          AS order_number,
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
  EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = o.id AND oi.qc_status = 'failed'
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi2
        WHERE oi2.id = oi.id AND oi2.qc_status = 'passed'
      )
  ) AS any_item_in_redo,
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'title', oi.title,
      'variant_title', oi.variant_title,
      'thumbnail_url', oi.mockup_thumbnail_url,
      'names_text', oi.names_text,
      'quantity', oi.quantity
    )), '[]'::jsonb)
    FROM order_items oi WHERE oi.order_id = o.id
  ) AS items,
  (
    SELECT COALESCE(array_agg(t.tag_name ORDER BY t.tag_name), '{}'::text[])
    FROM order_tags t
    WHERE t.order_id = o.id AND t.is_customer_visible = true
  ) AS visible_tags
FROM orders o
WHERE o.deleted_at IS NULL;--> statement-breakpoint

-- ── Cleanup functions (called by cron in Phase 4.8) ───────────────────
CREATE OR REPLACE FUNCTION purge_delivered_orders()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  purged_count int;
BEGIN
  WITH deleted AS (
    DELETE FROM orders
    WHERE delivered_at IS NOT NULL
      AND delivered_at < now() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT count(*) INTO purged_count FROM deleted;
  RETURN purged_count;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION purge_soft_deleted_orders()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  purged_count int;
BEGIN
  WITH deleted AS (
    DELETE FROM orders
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT count(*) INTO purged_count FROM deleted;
  RETURN purged_count;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION purge_old_webhook_events()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  purged_count int;
BEGIN
  WITH deleted AS (
    DELETE FROM shopify_webhook_events
    WHERE created_at < now() - INTERVAL '7 days'
    RETURNING id
  )
  SELECT count(*) INTO purged_count FROM deleted;
  RETURN purged_count;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION purge_expired_otps()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  purged_count int;
BEGIN
  WITH deleted AS (
    DELETE FROM otp_codes
    WHERE expires_at < now() - INTERVAL '1 hour'
       OR used_at IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO purged_count FROM deleted;
  RETURN purged_count;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION purge_old_call_requests()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  purged_count int;
BEGIN
  WITH deleted AS (
    DELETE FROM call_requests
    WHERE created_at < now() - INTERVAL '90 days'
    RETURNING id
  )
  SELECT count(*) INTO purged_count FROM deleted;
  RETURN purged_count;
END;
$$;