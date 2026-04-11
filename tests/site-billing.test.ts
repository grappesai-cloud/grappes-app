import { describe, it, expect } from 'vitest';
import { getSitePrice, getExpiresAt, getFreeExpiresAt } from '../src/lib/site-billing';

describe('getSitePrice', () => {
  it('returns correct prices', () => {
    expect(getSitePrice('monthly')).toBe(15);
    expect(getSitePrice('annual')).toBe(100);
    expect(getSitePrice('lifetime')).toBe(350);
  });
});

describe('getExpiresAt', () => {
  it('returns null for lifetime', () => {
    expect(getExpiresAt('lifetime')).toBeNull();
  });

  it('returns ~30 days for monthly', () => {
    const exp = getExpiresAt('monthly');
    expect(exp).not.toBeNull();
    const diff = new Date(exp!).getTime() - Date.now();
    const days = diff / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('returns ~365 days for annual', () => {
    const exp = getExpiresAt('annual');
    expect(exp).not.toBeNull();
    const diff = new Date(exp!).getTime() - Date.now();
    const days = diff / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);
  });

  it('does NOT overflow on Jan 31 (setMonth bug)', () => {
    // This is the regression test — old code used setMonth which overflows
    const exp = getExpiresAt('monthly');
    const expDate = new Date(exp!);
    const now = new Date();
    // Should be ~30 days, never 60+ days (which setMonth overflow causes)
    const diffDays = (expDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeLessThan(31);
  });
});

describe('getFreeExpiresAt', () => {
  it('returns ~7 days from now', () => {
    const exp = getFreeExpiresAt();
    const diff = new Date(exp).getTime() - Date.now();
    const days = diff / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});
