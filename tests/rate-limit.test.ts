import { describe, it, expect } from 'vitest';
import { checkRateLimit, getClientIp } from '../src/lib/rate-limit';

describe('checkRateLimit', () => {
  it('allows requests within limit', () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    expect(checkRateLimit(key, 3, 60000)).toBe(true);
    expect(checkRateLimit(key, 3, 60000)).toBe(true);
    expect(checkRateLimit(key, 3, 60000)).toBe(true);
  });

  it('blocks requests over limit', () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    checkRateLimit(key, 2, 60000);
    checkRateLimit(key, 2, 60000);
    expect(checkRateLimit(key, 2, 60000)).toBe(false);
  });

  it('resets after window expires', () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    checkRateLimit(key, 1, 1); // 1ms window
    // After 1ms the window expires
    return new Promise(resolve => setTimeout(() => {
      expect(checkRateLimit(key, 1, 1)).toBe(true);
      resolve(undefined);
    }, 5));
  });
});

describe('getClientIp', () => {
  it('prefers x-real-ip', () => {
    const req = new Request('http://localhost', {
      headers: {
        'x-real-ip': '1.2.3.4',
        'x-forwarded-for': '5.6.7.8',
      },
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to x-forwarded-for', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '5.6.7.8, 9.10.11.12' },
    });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it('returns unknown when no headers', () => {
    const req = new Request('http://localhost');
    expect(getClientIp(req)).toBe('unknown');
  });
});
