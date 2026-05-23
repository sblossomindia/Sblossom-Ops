/**
 * Pure logic for legal order state transitions. No DB access. Imported by the
 * runtime state machine (index.ts) and by tests.
 */

export type OrderState =
  | 'approval_pending'
  | 'in_production'
  | 'qc_passed'
  | 'shipped'
  | 'delivered';

/**
 * For each state, the list of states we're allowed to move to.
 *
 *   approval_pending → in_production   (Tab 1 submit)
 *   in_production    → qc_passed        (QC grace timer elapses)
 *   qc_passed        → shipped          (Tab 4 ship-label button)
 *   qc_passed        → in_production    (admin re-opens QC post-grace)
 *   shipped          → delivered        (Shopify fulfillment / Shipmozo)
 *   delivered        → (terminal — purged 30 days later)
 */
export const LEGAL_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  approval_pending: ['in_production'],
  in_production: ['qc_passed'],
  qc_passed: ['shipped', 'in_production'],
  shipped: ['delivered'],
  delivered: [],
};

export function isLegalTransition(from: OrderState, to: OrderState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: OrderState | null,
    public readonly to: OrderState,
    extra?: string,
  ) {
    super(
      from
        ? `Illegal order transition: ${from} → ${to}${extra ? ` (${extra})` : ''}`
        : `Illegal target state: ${to}${extra ? ` (${extra})` : ''}`,
    );
    this.name = 'IllegalTransitionError';
  }
}
