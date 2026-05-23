import { describe, expect, it } from 'vitest';

import { last10Digits, normalizePhone, PhoneFormatError } from './phone';

describe('normalizePhone', () => {
  it('passes through valid E.164', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
    expect(normalizePhone('+14155552671')).toBe('+14155552671');
  });

  it('strips whitespace, dashes, parens before parsing', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+91-98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(987) 654-3210')).toBe('+919876543210');
  });

  it('treats 10 digits as Indian and prepends +91', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('strips a leading trunk 0 then prepends +91', () => {
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });

  it('accepts 12-digit numbers starting with 91 as Indian E.164 without +', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('rejects too-short numbers', () => {
    expect(() => normalizePhone('12345')).toThrow(PhoneFormatError);
  });

  it('rejects E.164 with too few digits', () => {
    expect(() => normalizePhone('+1234567')).toThrow(PhoneFormatError);
  });

  it('rejects null / undefined / empty', () => {
    expect(() => normalizePhone(null)).toThrow(PhoneFormatError);
    expect(() => normalizePhone(undefined)).toThrow(PhoneFormatError);
    expect(() => normalizePhone('')).toThrow(PhoneFormatError);
  });
});

describe('last10Digits', () => {
  it('returns the last 10 digits of an E.164 number', () => {
    expect(last10Digits('+919876543210')).toBe('9876543210');
    expect(last10Digits('+14155552671')).toBe('4155552671');
  });

  it('throws on too-short input', () => {
    expect(() => last10Digits('+1234567')).toThrow(PhoneFormatError);
  });
});
