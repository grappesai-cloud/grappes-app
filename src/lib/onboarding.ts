import type { ConversationMessage, ConversationPhase } from './db';

// ─── Completeness weights ────────────────────────────────────────────────────
// P0 = 60% weight — must-have fields
const P0_FIELDS = [
  'preferences.websiteType',
  'business.name',
  'business.industry',
  'business.description',
  'target_audience.primary',
  'content.headline',
  'branding.colors.primary',
];

// P1 = 25% weight — should-have fields
const P1_FIELDS = [
  'content.about',
  'content.services',
  'contact.email',
  'branding.fonts.heading',
  'meta.title',
  'meta.description',
  'preferences.primary_goal',
  'content.copy_ownership',
];

// P2 = 15% weight — nice-to-have fields
const P2_FIELDS = [
  'media.has_logo',
  'features.contact_form',
  'business.tagline',
  'business.entity_type',
  'branding.colors.secondary',
  'branding.style',
  'branding.voice.traits',
  'branding.logo',      // actual logo upload URL
  'media.heroImage',    // actual hero image upload URL
];

function getNestedValue(obj: Record<string, any>, dotPath: string): any {
  return dotPath.split('.').reduce((acc, key) => acc?.[key], obj);
}

function hasValue(val: any): boolean {
  if (val === undefined || val === null) return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'string') return val.trim().length > 0;
  return true; // boolean, number, etc.
}

export function calculateCompleteness(data: Record<string, any>): number {
  const p0 = P0_FIELDS.filter(f => hasValue(getNestedValue(data, f))).length / P0_FIELDS.length;
  const p1 = P1_FIELDS.filter(f => hasValue(getNestedValue(data, f))).length / P1_FIELDS.length;
  const p2 = P2_FIELDS.filter(f => hasValue(getNestedValue(data, f))).length / P2_FIELDS.length;
  return p0 * 0.6 + p1 * 0.25 + p2 * 0.15;
}

// ─── Parse Haiku structured response ─────────────────────────────────────────

function flattenObject(obj: Record<string, any>, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, any>, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

export interface UiAction {
  type: 'upload' | 'choice';
  variant?: 'logo' | 'hero' | 'section' | 'og' | 'favicon' | 'gallery' | 'menu';
  sectionId?: string;
  sectionTitle?: string;
  options?: string[];
}

export function parseHaikuResponse(raw: string): {
  reply: string;
  extracted: Record<string, any>;
  newPhase?: ConversationPhase;
  isComplete: boolean;
  uiAction?: UiAction;
} {
  // Extract reply and data — handle missing ---REPLY---, ---DATA---, or ---END---
  const dataIndex = raw.indexOf('---DATA---');
  let reply: string;
  let rawDataBlock: string | null = null;

  if (dataIndex !== -1) {
    // Extract reply: everything before ---DATA--- (strip ---REPLY--- marker if present)
    let replyPart = raw.slice(0, dataIndex);
    replyPart = replyPart.replace(/^---REPLY---\s*/i, '').trim();
    reply = replyPart;

    // Extract data: everything after ---DATA--- (strip ---END--- if present)
    let dataPart = raw.slice(dataIndex + '---DATA---'.length);
    const endIndex = dataPart.indexOf('---END---');
    if (endIndex !== -1) dataPart = dataPart.slice(0, endIndex);
    rawDataBlock = dataPart.trim();
  } else {
    // No ---DATA--- at all — entire response is the reply
    reply = raw.replace(/^---REPLY---\s*/i, '').trim();
  }

  // Post-process: force line breaks before bullet points that Haiku inlines
  reply = reply.replace(/([^\n]) [-–—] (?=[A-Z\u00C0-\u024F])/g, '$1\n- ');
  reply = reply.replace(/([?:]) [-–—] /g, '$1\n- ');

  // Safety: strip any remaining ---DATA--- or JSON that leaked into reply
  reply = reply.replace(/---DATA---[\s\S]*/g, '').replace(/---END---[\s\S]*/g, '').trim();

  let extracted: Record<string, any> = {};
  let newPhase: ConversationPhase | undefined;
  let isComplete = false;
  let uiAction: UiAction | undefined;

  if (rawDataBlock) {
    let rawJson = rawDataBlock
      .replace(/,\s*}/g, '}')           // trailing commas in objects
      .replace(/,\s*]/g, ']')           // trailing commas in arrays
      .replace(/```(?:json)?\s*/gi, '') // code fences
      .replace(/\s*```\s*$/g, '')
      .replace(/(?<!:)\/\/[^\n]*/g, '') // single-line comments (preserve URLs like https://)
      .replace(/\/\*[\s\S]*?\*\//g, '') // multi-line comments
      .trim();

    try {
      const parsed = JSON.parse(rawJson);

      // Find _phase and _complete anywhere in the object (Haiku sometimes nests them)
      function extractSpecialKeys(obj: Record<string, any>): void {
        for (const [key, val] of Object.entries(obj)) {
          if (key === '_phase' && typeof val === 'string') { newPhase = val as ConversationPhase; delete obj[key]; }
          if (key === '_complete' && val) { isComplete = true; delete obj[key]; }
          if (key === 'uiAction' && val && typeof val === 'object') { uiAction = val as UiAction; delete obj[key]; }
          if (val && typeof val === 'object' && !Array.isArray(val)) extractSpecialKeys(val);
        }
      }
      extractSpecialKeys(parsed);
      // Flatten in case Haiku returned nested JSON instead of dot-paths
      extracted = flattenObject(parsed);
    } catch (e) {
      console.error('[parseHaikuResponse] JSON parse failed. Raw DATA block:', rawJson.slice(0, 500), 'Error:', e);
    }
  }

  return { reply, extracted, newPhase, isComplete, uiAction };
}

// ─── Smart defaults by industry ──────────────────────────────────────────────

type Defaults = Record<string, any>;

// Industry defaults — only structural (pages + features).
// No branding colors, styles, or hero_style — let the AI decide those creatively.
const INDUSTRY_DEFAULTS: Record<string, Defaults> = {
  restaurant: {
    'content.pages': ['Home', 'Menu', 'About', 'Reservations', 'Contact'],
    'features.contact_form': true,
    'features.booking': true,
  },
  tech: {
    'content.pages': ['Home', 'Features', 'Pricing', 'About', 'Contact'],
    'features.contact_form': true,
  },
  saas: {
    'content.pages': ['Home', 'Features', 'Pricing', 'Blog', 'Contact'],
    'features.contact_form': true,
    'features.blog': true,
  },
  software: {
    'content.pages': ['Home', 'Features', 'Pricing', 'Docs', 'Contact'],
    'features.contact_form': true,
  },
  fitness: {
    'content.pages': ['Home', 'Classes', 'Trainers', 'Pricing', 'Contact'],
    'features.contact_form': true,
    'features.booking': true,
  },
  gym: {
    'content.pages': ['Home', 'Classes', 'Memberships', 'About', 'Contact'],
    'features.contact_form': true,
  },
  healthcare: {
    'content.pages': ['Home', 'Services', 'About', 'Team', 'Contact'],
    'features.contact_form': true,
    'features.booking': true,
  },
  medical: {
    'content.pages': ['Home', 'Services', 'Doctors', 'About', 'Contact'],
    'features.contact_form': true,
    'features.booking': true,
  },
  retail: {
    'content.pages': ['Home', 'Products', 'About', 'Contact'],
    'features.contact_form': true,
    'features.ecommerce': true,
  },
  shop: {
    'content.pages': ['Home', 'Shop', 'About', 'Contact'],
    'features.ecommerce': true,
  },
  agency: {
    'content.pages': ['Home', 'Work', 'Services', 'About', 'Contact'],
    'features.contact_form': true,
  },
  marketing: {
    'content.pages': ['Home', 'Services', 'Case Studies', 'About', 'Contact'],
    'features.contact_form': true,
  },
  law: {
    'content.pages': ['Home', 'Practice Areas', 'Attorneys', 'About', 'Contact'],
    'features.contact_form': true,
  },
  finance: {
    'content.pages': ['Home', 'Services', 'About', 'Team', 'Contact'],
    'features.contact_form': true,
  },
  consulting: {
    'content.pages': ['Home', 'Services', 'Case Studies', 'About', 'Contact'],
    'features.contact_form': true,
  },
  education: {
    'content.pages': ['Home', 'Courses', 'About', 'Blog', 'Contact'],
    'features.contact_form': true,
    'features.blog': true,
  },
  portfolio: {
    'content.pages': ['Home', 'Work', 'About', 'Contact'],
    'features.contact_form': true,
  },
  photography: {
    'content.pages': ['Home', 'Portfolio', 'Services', 'About', 'Contact'],
    'features.contact_form': true,
  },
  artist: {
    'content.pages': ['Home', 'Work', 'About', 'Press', 'Contact'],
    'features.contact_form': true,
  },
  musician: {
    'content.pages': ['Home', 'Music', 'Tour', 'About', 'Contact'],
    'features.contact_form': true,
  },
  music: {
    'content.pages': ['Home', 'Music', 'Tour', 'About', 'Contact'],
    'features.contact_form': true,
  },
  band: {
    'content.pages': ['Home', 'Music', 'Tour', 'About', 'Contact'],
    'features.contact_form': true,
  },
  dj: {
    'content.pages': ['Home', 'Music', 'Events', 'About', 'Contact'],
    'features.contact_form': true,
  },
  producer: {
    'content.pages': ['Home', 'Work', 'About', 'Contact'],
    'features.contact_form': true,
  },
  creator: {
    'content.pages': ['Home', 'Work', 'About', 'Contact'],
    'features.contact_form': true,
  },
  author: {
    'content.pages': ['Home', 'Books', 'About', 'Events', 'Contact'],
    'features.contact_form': true,
  },
  writer: {
    'content.pages': ['Home', 'Work', 'About', 'Contact'],
    'features.contact_form': true,
  },
  coach: {
    'content.pages': ['Home', 'Services', 'About', 'Testimonials', 'Contact'],
    'features.contact_form': true,
    'features.booking': true,
  },
  therapist: {
    'content.pages': ['Home', 'Services', 'About', 'Contact'],
    'features.contact_form': true,
    'features.booking': true,
  },
  filmmaker: {
    'content.pages': ['Home', 'Work', 'About', 'Contact'],
    'features.contact_form': true,
  },
  designer: {
    'content.pages': ['Home', 'Work', 'About', 'Contact'],
    'features.contact_form': true,
  },
};

function setNestedValue(obj: Record<string, any>, dotPath: string, value: any): void {
  const keys = dotPath.split('.');
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!target[keys[i]] || typeof target[keys[i]] !== 'object') {
      target[keys[i]] = {};
    }
    target = target[keys[i]];
  }
  const finalKey = keys[keys.length - 1];
  if (!hasValue(target[finalKey])) {
    target[finalKey] = value;
  }
}

export function applySmartDefaults(data: Record<string, any>): Record<string, any> {
  const result = structuredClone(data);
  const industry = (data?.business?.industry ?? '').toLowerCase();

  // Find matching industry defaults
  let defaults: Defaults = {};
  for (const [key, vals] of Object.entries(INDUSTRY_DEFAULTS)) {
    if (industry.includes(key)) {
      defaults = vals;
      break;
    }
  }

  // Apply industry-specific defaults (only for missing fields)
  for (const [dotPath, value] of Object.entries(defaults)) {
    setNestedValue(result, dotPath, value);
  }

  // Universal fallback defaults — site type defaults to landing unless user
  // explicitly asked for multi-page. Pages then follow from that decision.
  if (!hasValue(result?.preferences?.websiteType)) {
    setNestedValue(result, 'preferences.websiteType', 'landing');
  }
  if (!hasValue(result?.content?.pages)) {
    const isMulti = result?.preferences?.websiteType === 'multi-page';
    setNestedValue(result, 'content.pages', isMulti ? ['Home', 'About', 'Services', 'Contact'] : ['Home']);
  }
  if (!hasValue(result?.features?.contact_form)) {
    setNestedValue(result, 'features.contact_form', true);
  }

  // Auto-fill P1/P2 fields from brief context so completeness can reach 100%
  const bName = result?.business?.name ?? '';
  const bDesc = result?.business?.description ?? '';
  const bIndustry = result?.business?.industry ?? '';

  // P1 defaults
  if (!hasValue(result?.meta?.title) && bName) {
    setNestedValue(result, 'meta.title', `${bName} — ${bIndustry || 'Official Website'}`);
  }
  if (!hasValue(result?.meta?.description) && bDesc) {
    setNestedValue(result, 'meta.description', bDesc.slice(0, 160));
  }
  if (!hasValue(result?.branding?.fonts?.heading)) {
    setNestedValue(result, 'branding.fonts.heading', 'Inter');
  }

  // P2 defaults
  if (!hasValue(result?.business?.tagline) && bDesc) {
    setNestedValue(result, 'business.tagline', bDesc.split('.')[0]?.trim() || bDesc.slice(0, 80));
  }
  if (!hasValue(result?.media?.has_logo)) {
    setNestedValue(result, 'media.has_logo', !!result?.branding?.logo);
  }

  return result;
}

// ─── History compression ──────────────────────────────────────────────────────

export function compressHistory(messages: ConversationMessage[]): ConversationMessage[] {
  if (messages.length <= 40) return messages;
  // Keep first 4 messages (initial context) + last 30 most recent
  // Combined with the ALREADY COLLECTED summary in system prompt, this prevents re-asking
  return [...messages.slice(0, 4), ...messages.slice(messages.length - 30)];
}
