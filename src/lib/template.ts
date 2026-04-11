// ─── Template Utilities ───────────────────────────────────────────────────────
// Shared utilities for section derivation, font URLs, and naming.
// The Astro scaffold builder has been removed — only HTML generation remains.

import type { SiteArch } from './generation';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface SectionDef {
  id: string;
  title: string;
  placement: 'nav' | 'main' | 'footer';
  condition: boolean;
}

// ─── Shared utilities ────────────────────────────────────────────────────────

export function sectionComponentName(id: string): string {
  return id
    .split(/[-_\s]+/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

export function buildGoogleFontsUrl(heading: string, body: string): string {
  const families = [...new Set([heading, body])];
  const params = families
    .map(f => `family=${encodeURIComponent(f)}:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

export function normalizeGFontName(font: string): string {
  if (!font || font.length < 2) return 'Inter';
  return font.trim().replace(/[_+]/g, ' ');
}

/**
 * Canonical ordered section list for a landing page.
 * Single source of truth for which sections to generate.
 */
export function deriveSections(arch: SiteArch): SectionDef[] {
  const hasServices = arch.services.length > 0;
  const hasAbout = arch.about.trim().length > 0;
  const hasContact =
    !!(arch.email || arch.phone || arch.address) ||
    arch.features?.contact_form !== false;

  const sections: SectionDef[] = [
    { id: 'nav',     title: 'Nav',     placement: 'nav',    condition: true },
    { id: 'hero',    title: 'Hero',    placement: 'main',   condition: true },
    { id: 'services',title: 'Services',placement: 'main',   condition: hasServices },
    { id: 'about',   title: 'About',   placement: 'main',   condition: hasAbout },
    { id: 'stats',   title: 'Stats',   placement: 'main',   condition: true },
  ];

  const coreIds = new Set(sections.map(s => s.id));
  for (const s of arch.landingSections) {
    if (!coreIds.has(s.id)) {
      sections.push({ id: s.id, title: s.title, placement: 'main', condition: true });
    }
  }

  sections.push(
    { id: 'cta',     title: 'Cta',     placement: 'main',   condition: true },
    { id: 'contact', title: 'Contact', placement: 'main',   condition: hasContact },
    { id: 'footer',  title: 'Footer',  placement: 'footer', condition: true },
  );

  return sections;
}
