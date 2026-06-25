import { describe, expect, it } from 'vitest';
import { isValidPhone, normalizePhone, phoneToAuthEmail } from './phone';

describe('normalizePhone', () => {
  it('strips non-digit characters', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
  });
});

describe('isValidPhone', () => {
  it('accepts valid Korean mobile numbers', () => {
    expect(isValidPhone('01012345678')).toBe(true);
    expect(isValidPhone('010-1234-5678')).toBe(true);
    expect(isValidPhone('011-123-4567')).toBe(true);
  });

  it('rejects invalid numbers', () => {
    expect(isValidPhone('0212345678')).toBe(false);
    expect(isValidPhone('010-123')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});

describe('phoneToAuthEmail', () => {
  it('produces a deterministic pseudo-email keyed by normalized phone', () => {
    expect(phoneToAuthEmail('010-1234-5678')).toBe(
      'p01012345678@members.solomonstudycafe.internal'
    );
    expect(phoneToAuthEmail('01012345678')).toBe(phoneToAuthEmail('010-1234-5678'));
  });
});
