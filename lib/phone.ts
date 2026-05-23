/**
 * Phone number normalization to E.164 format (CLAUDE.md hard rule 8).
 *
 * India-focused: the only "implicit country" we handle is +91. Any number that
 * already has a `+` prefix is taken as authoritative E.164 (must match the
 * E.164 shape).  Anything else is interpreted as Indian local format.
 *
 * Throws on input we can't confidently normalize — silently producing the
 * wrong number is worse than failing loudly. Callers should catch and present
 * a useful error rather than store unnormalized data.
 */
export class PhoneFormatError extends Error {
  constructor(input: string) {
    super(`Cannot normalize phone number: "${input}"`);
    this.name = 'PhoneFormatError';
  }
}

/** Loose E.164 shape: + followed by 8–15 digits. */
const E164_RE = /^\+\d{8,15}$/;

export function normalizePhone(input: string | null | undefined): string {
  if (!input) throw new PhoneFormatError(String(input));

  // Strip everything that isn't a digit or a leading `+`.
  const cleaned = input.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+')) {
    if (!E164_RE.test(cleaned)) throw new PhoneFormatError(input);
    return cleaned;
  }

  let digits = cleaned;
  // Indian numbers commonly written with a trunk 0 (e.g., 09876543210).
  if (digits.startsWith('0')) digits = digits.slice(1);

  // 91 + 10 digits = full Indian E.164 without the +.
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;

  // 10 digits = bare Indian mobile.
  if (digits.length === 10) return `+91${digits}`;

  throw new PhoneFormatError(input);
}

/**
 * Returns the last 10 digits of an E.164 phone — used for index lookups
 * (e.g., customer global search matches by last-10).
 */
export function last10Digits(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 10) throw new PhoneFormatError(e164);
  return digits.slice(-10);
}

/**
 * Splits an E.164 phone into the shape Interakt's API expects:
 *   countryCode: "+91" (with the leading +)
 *   phoneNumber: "9876543210" (national number, no + or leading 0)
 *
 * Assumes 10-digit subscriber numbers (the global norm; matches Indian usage).
 */
export function splitE164(e164: string): { countryCode: string; phoneNumber: string } {
  if (!e164.startsWith('+')) throw new PhoneFormatError(e164);
  const digits = e164.slice(1);
  if (!/^\d{11,15}$/.test(digits)) throw new PhoneFormatError(e164);
  return {
    countryCode: `+${digits.slice(0, -10)}`,
    phoneNumber: digits.slice(-10),
  };
}
