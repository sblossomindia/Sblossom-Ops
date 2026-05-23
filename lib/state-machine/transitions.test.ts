import { describe, expect, it } from 'vitest';

import {
  IllegalTransitionError,
  LEGAL_TRANSITIONS,
  type OrderState,
  isLegalTransition,
} from './transitions';

const ALL_STATES: OrderState[] = [
  'approval_pending',
  'in_production',
  'qc_passed',
  'shipped',
  'delivered',
];

describe('isLegalTransition', () => {
  it('allows every documented legal transition', () => {
    expect(isLegalTransition('approval_pending', 'in_production')).toBe(true);
    expect(isLegalTransition('in_production', 'qc_passed')).toBe(true);
    expect(isLegalTransition('qc_passed', 'shipped')).toBe(true);
    expect(isLegalTransition('qc_passed', 'in_production')).toBe(true); // admin reopen
    expect(isLegalTransition('shipped', 'delivered')).toBe(true);
  });

  it('rejects every transition not in the table', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const allowed = LEGAL_TRANSITIONS[from].includes(to);
        expect(isLegalTransition(from, to)).toBe(allowed);
      }
    }
  });

  it('explicitly forbids notable invalid transitions', () => {
    // Self transitions
    for (const s of ALL_STATES) expect(isLegalTransition(s, s)).toBe(false);
    // Backwards rollbacks (except qc_passed → in_production for admin reopen)
    expect(isLegalTransition('in_production', 'approval_pending')).toBe(false);
    expect(isLegalTransition('shipped', 'qc_passed')).toBe(false);
    expect(isLegalTransition('delivered', 'shipped')).toBe(false);
    // Skipping steps
    expect(isLegalTransition('approval_pending', 'qc_passed')).toBe(false);
    expect(isLegalTransition('approval_pending', 'shipped')).toBe(false);
    expect(isLegalTransition('approval_pending', 'delivered')).toBe(false);
    expect(isLegalTransition('in_production', 'shipped')).toBe(false);
    expect(isLegalTransition('in_production', 'delivered')).toBe(false);
    expect(isLegalTransition('qc_passed', 'delivered')).toBe(false);
    // Delivered is terminal
    expect(isLegalTransition('delivered', 'shipped')).toBe(false);
    expect(isLegalTransition('delivered', 'in_production')).toBe(false);
    expect(isLegalTransition('delivered', 'approval_pending')).toBe(false);
  });
});

describe('IllegalTransitionError', () => {
  it('formats with from/to states', () => {
    const err = new IllegalTransitionError('shipped', 'approval_pending');
    expect(err.message).toContain('shipped');
    expect(err.message).toContain('approval_pending');
    expect(err.from).toBe('shipped');
    expect(err.to).toBe('approval_pending');
  });
});
