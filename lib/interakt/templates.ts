/**
 * Typed builders for each Interakt template. The placeholder order here MUST
 * match the order Meta approved — see interakt_templates.md.
 *
 * Every builder takes:
 *   - phone: an E.164 number (use lib/phone.ts to normalize first)
 *   - vars: the template-specific variables, typed
 *   - callbackData?: optional opaque identifier echoed back in delivery
 *     receipts (set this so we can correlate inbound webhooks with sends)
 *
 * and returns an `InteraktPayload` ready to hand to `sendNotification`.
 */
import { splitE164 } from '@/lib/phone';

import type { InteraktPayload } from './client';

const LANGUAGE = 'en';

/** Stable string keys used in notifications_log.template_key. */
export const TEMPLATE_KEYS = {
  orderInProduction: 'order_in_production',
  orderInProductionCod: 'order_in_production_cod',
  qcPassed: 'qc_passed',
  qcFailedRemaking: 'qc_failed_remaking',
  orderShipped: 'order_shipped',
  mockupUpdated: 'mockup_updated',
  qcStatusUpdated: 'qc_status_updated',
  trackingOtp: 'tracking_otp',
} as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[keyof typeof TEMPLATE_KEYS];

/* ── Helpers ────────────────────────────────────────────────────────────── */

function baseEnvelope(
  phone: string,
  templateName: string,
  callbackData: string | undefined,
  bodyValues: string[],
  buttonValues?: Record<string, string[]>,
): InteraktPayload {
  const { countryCode, phoneNumber } = splitE164(phone);
  return {
    countryCode,
    phoneNumber,
    type: 'Template',
    callbackData,
    template: {
      name: templateName,
      languageCode: LANGUAGE,
      bodyValues,
      ...(buttonValues ? { buttonValues } : {}),
    },
  };
}

/**
 * Strip newlines and trim — WhatsApp body values can't contain newlines
 * (those are the template's job, not ours). Empty strings become a single
 * em-dash so Meta's "samples can't be empty" rule isn't violated at send time.
 */
function clean(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : '—';
}

/* ── Template 1: order_in_production (prepaid) ──────────────────────────── */

export interface OrderInProductionVars {
  customerName: string;
  orderNumber: string;
  itemsSummary: string;
  personalization: string;
  specialInstructions: string;
}

export function buildOrderInProduction(
  phone: string,
  vars: OrderInProductionVars,
  callbackData?: string,
): InteraktPayload {
  return baseEnvelope(phone, TEMPLATE_KEYS.orderInProduction, callbackData, [
    clean(vars.customerName),
    clean(vars.orderNumber),
    clean(vars.itemsSummary),
    clean(vars.personalization),
    clean(vars.specialInstructions),
    'Prepaid',
  ]);
}

/* ── Template 2: order_in_production_cod ────────────────────────────────── */

export interface OrderInProductionCodVars {
  customerName: string;
  orderNumber: string;
  itemsSummary: string;
  personalization: string;
  specialInstructions: string;
  codAmount: string; // already formatted, no symbol, e.g. "2598" or "2,598"
}

export function buildOrderInProductionCod(
  phone: string,
  vars: OrderInProductionCodVars,
  callbackData?: string,
): InteraktPayload {
  return baseEnvelope(phone, TEMPLATE_KEYS.orderInProductionCod, callbackData, [
    clean(vars.customerName),
    clean(vars.orderNumber),
    clean(vars.itemsSummary),
    clean(vars.personalization),
    clean(vars.specialInstructions),
    clean(vars.codAmount),
  ]);
}

/* ── Template 3: qc_passed ──────────────────────────────────────────────── */

export interface QcPassedVars {
  customerName: string;
  orderNumber: string;
}

export function buildQcPassed(
  phone: string,
  vars: QcPassedVars,
  callbackData?: string,
): InteraktPayload {
  return baseEnvelope(phone, TEMPLATE_KEYS.qcPassed, callbackData, [
    clean(vars.customerName),
    clean(vars.orderNumber),
  ]);
}

/* ── Template 4: qc_failed_remaking ─────────────────────────────────────── */

export interface QcFailedRemakingVars {
  customerName: string;
  orderNumber: string;
}

export function buildQcFailedRemaking(
  phone: string,
  vars: QcFailedRemakingVars,
  callbackData?: string,
): InteraktPayload {
  return baseEnvelope(phone, TEMPLATE_KEYS.qcFailedRemaking, callbackData, [
    clean(vars.customerName),
    clean(vars.orderNumber),
  ]);
}

/* ── Template 5: order_shipped (dynamic URL button) ─────────────────────── */

export interface OrderShippedVars {
  customerName: string;
  orderNumber: string;
  carrier: string;
  trackingId: string;
  /**
   * Tracking URL WITHOUT the `https://` prefix (template button is
   * `https://{{5}}`). Pass e.g. `delhivery.com/track/package/7891234567`.
   */
  trackingUrlHostAndPath: string;
}

export function buildOrderShipped(
  phone: string,
  vars: OrderShippedVars,
  callbackData?: string,
): InteraktPayload {
  return baseEnvelope(
    phone,
    TEMPLATE_KEYS.orderShipped,
    callbackData,
    [clean(vars.customerName), clean(vars.orderNumber), clean(vars.carrier), clean(vars.trackingId)],
    { '0': [clean(vars.trackingUrlHostAndPath)] },
  );
}

/* ── Template 6: mockup_updated ─────────────────────────────────────────── */

export interface MockupUpdatedVars {
  customerName: string;
  orderNumber: string;
}

export function buildMockupUpdated(
  phone: string,
  vars: MockupUpdatedVars,
  callbackData?: string,
): InteraktPayload {
  return baseEnvelope(phone, TEMPLATE_KEYS.mockupUpdated, callbackData, [
    clean(vars.customerName),
    clean(vars.orderNumber),
  ]);
}

/* ── Template 7: qc_status_updated ──────────────────────────────────────── */

export interface QcStatusUpdatedVars {
  customerName: string;
  orderNumber: string;
}

export function buildQcStatusUpdated(
  phone: string,
  vars: QcStatusUpdatedVars,
  callbackData?: string,
): InteraktPayload {
  return baseEnvelope(phone, TEMPLATE_KEYS.qcStatusUpdated, callbackData, [
    clean(vars.customerName),
    clean(vars.orderNumber),
  ]);
}

/* ── Template 8: tracking_otp (AUTHENTICATION) ──────────────────────────── */

export interface TrackingOtpVars {
  /** The 6-digit OTP code, as a string. */
  otp: string;
}

export function buildTrackingOtp(
  phone: string,
  vars: TrackingOtpVars,
  callbackData?: string,
): InteraktPayload {
  if (!/^\d{4,8}$/.test(vars.otp)) {
    throw new Error(`Invalid OTP shape: ${vars.otp}`);
  }
  // Meta auto-generates the copy-code button; some Interakt setups still
  // require the OTP echoed under buttonValues["0"] for the Copy action.
  // Cheap to include; harmless if ignored.
  return baseEnvelope(phone, TEMPLATE_KEYS.trackingOtp, callbackData, [vars.otp], {
    '0': [vars.otp],
  });
}
