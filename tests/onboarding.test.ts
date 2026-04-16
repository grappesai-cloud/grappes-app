import { describe, it, expect } from 'vitest';
import { calculateCompleteness, parseHaikuResponse, applySmartDefaults } from '../src/lib/onboarding';

describe('calculateCompleteness', () => {
  it('returns 0 for empty data', () => {
    expect(calculateCompleteness({})).toBe(0);
  });

  it('scores P0 fields highest', () => {
    const withP0 = {
      preferences: { websiteType: 'landing' },
      business: { name: 'Test', industry: 'tech', description: 'A test business' },
      target_audience: { primary: 'developers' },
      content: { headline: 'Hello World' },
      branding: { colors: { primary: '#000' } },
    };
    const score = calculateCompleteness(withP0);
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('returns 1.0 for fully complete brief', () => {
    const full = {
      preferences: { websiteType: 'landing', primary_goal: 'contact' },
      business: { name: 'Test', industry: 'tech', description: 'desc', tagline: 'tag', entity_type: 'organization' },
      target_audience: { primary: 'devs' },
      content: { headline: 'H', about: 'A', services: ['S1'], copy_ownership: 'generate' },
      branding: { colors: { primary: '#000', secondary: '#fff' }, fonts: { heading: 'Inter' }, style: 'modern', logo: 'url', voice: { traits: ['modern','direct'] } },
      contact: { email: 'a@b.com' },
      media: { has_logo: true, heroImage: 'url' },
      features: { contact_form: true },
      meta: { title: 'T', description: 'D' },
    };
    expect(calculateCompleteness(full)).toBeGreaterThanOrEqual(0.95);
  });
});

describe('parseHaikuResponse', () => {
  it('parses valid ---DATA--- / ---END--- response', () => {
    const raw = `---REPLY---
Hello! Let me help you.
---DATA---
{"business.name": "Acme", "business.industry": "tech"}
---END---`;
    const result = parseHaikuResponse(raw);
    expect(result.reply).toContain('Hello');
    expect(result.extracted['business.name']).toBe('Acme');
    expect(result.extracted['business.industry']).toBe('tech');
  });

  it('returns reply-only when no DATA block', () => {
    const raw = 'Just a plain reply with no structured data.';
    const result = parseHaikuResponse(raw);
    expect(result.reply).toContain('plain reply');
    expect(Object.keys(result.extracted).length).toBe(0);
  });

  it('extracts _phase correctly', () => {
    const raw = `---REPLY---
Moving to branding.
---DATA---
{"_phase": "branding", "branding.style": "modern"}
---END---`;
    const result = parseHaikuResponse(raw);
    expect(result.newPhase).toBe('branding');
    expect(result.extracted['_phase']).toBeUndefined(); // stripped
    expect(result.extracted['branding.style']).toBe('modern');
  });

  it('extracts _complete correctly', () => {
    const raw = `---REPLY---
Your brief is complete!
---DATA---
{"_complete": true}
---END---`;
    const result = parseHaikuResponse(raw);
    expect(result.isComplete).toBe(true);
    expect(result.extracted['_complete']).toBeUndefined(); // stripped
  });

  it('handles JSON with trailing commas', () => {
    const raw = `---REPLY---
OK
---DATA---
{"business.name": "Test",}
---END---`;
    const result = parseHaikuResponse(raw);
    expect(result.extracted['business.name']).toBe('Test');
  });
});

describe('applySmartDefaults', () => {
  it('does not overwrite existing values', () => {
    const data = {
      preferences: { websiteType: 'landing' },
      features: { contact_form: false },
    };
    const result = applySmartDefaults(data);
    expect(result.features.contact_form).toBe(false);
  });

  it('adds contact_form default for restaurant', () => {
    const data = {
      business: { industry: 'restaurant' },
      preferences: { websiteType: 'landing' },
    };
    const result = applySmartDefaults(data);
    expect(result.features?.contact_form).toBeDefined();
  });
});
