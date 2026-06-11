import { describe, it, expect } from 'vitest';
import { calculateCompleteness, parseHaikuResponse, applySmartDefaults, sanitizeExtracted } from '../src/lib/onboarding';

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

  it('strips transient underscore-prefixed keys so they never reach generation', () => {
    const data = {
      business: { name: 'Acme', industry: 'tech' },
      _lastUiAction: { type: 'upload', variant: 'logo' },
      _scratch: 'x',
    };
    const result = applySmartDefaults(data);
    expect(result._lastUiAction).toBeUndefined();
    expect(result._scratch).toBeUndefined();
    expect(result.business.name).toBe('Acme');
  });
});

describe('sanitizeExtracted', () => {
  it('keeps valid hex colours, drops colour names', () => {
    const out = sanitizeExtracted({
      'branding.colors.primary': '#8B0000',
      'branding.colors.secondary': 'dark red',
      'branding.colors.accent': '#fff',
    });
    expect(out['branding.colors.primary']).toBe('#8B0000');
    expect(out['branding.colors.accent']).toBe('#fff');
    expect('branding.colors.secondary' in out).toBe(false);
  });

  it('keeps in-enum values (normalised), drops out-of-enum', () => {
    const out = sanitizeExtracted({
      'preferences.websiteType': 'multi-page',
      'content.copy_ownership': 'GENERATE',
      'content.pricing_mode': 'bananas',
    });
    expect(out['preferences.websiteType']).toBe('multi-page');
    expect(out['content.copy_ownership']).toBe('generate');
    expect('content.pricing_mode' in out).toBe(false);
  });

  it('passes unknown keys through untouched', () => {
    const out = sanitizeExtracted({ 'business.name': 'Acme', 'content.headline': 'Hi' });
    expect(out['business.name']).toBe('Acme');
    expect(out['content.headline']).toBe('Hi');
  });
});

describe('parseHaikuResponse — JSON leak guard', () => {
  it('strips a leaked dot-path JSON blob when markers are missing', () => {
    const raw = 'Sună bine? {"branding.colors.primary": "#8B0000", "content.headline": "Hello"}';
    const result = parseHaikuResponse(raw);
    expect(result.reply).toBe('Sună bine?');
    expect(result.reply).not.toContain('{');
  });

  it('strips a leaked special-key blob', () => {
    const raw = 'Gata! {"_complete": true}';
    const result = parseHaikuResponse(raw);
    expect(result.reply).toBe('Gata!');
  });

  it('does not touch normal prose containing a brace but no schema key', () => {
    const raw = 'Use the format {name} in your copy.';
    const result = parseHaikuResponse(raw);
    expect(result.reply).toContain('{name}');
  });
});
