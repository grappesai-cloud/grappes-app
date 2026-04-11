// ─── Generation Core ──────────────────────────────────────────────────────────
// Shared types, constants, and utilities used by the HTML generation flow.
// The Astro build flow has been removed — all generation is single-file HTML.

import { normalizeGFontName } from './template';

export const SONNET_MODEL        = 'claude-sonnet-4-6';
export const SONNET_INPUT_COST   = 0.000003;  // $3  / 1M tokens
export const SONNET_OUTPUT_COST  = 0.000015;  // $15 / 1M tokens

export const OPUS_MODEL          = 'claude-opus-4-6';
export const OPUS_INPUT_COST     = 0.000015;  // $15 / 1M tokens
export const OPUS_OUTPUT_COST    = 0.000075;  // $75 / 1M tokens

// ─── Site architecture derived from brief ────────────────────────────────────

export interface SiteArch {
  pages: string[];
  websiteType: 'landing' | 'multi-page';
  landingSections: Array<{ id: string; title: string }>;
  businessName: string;
  industry: string;
  style: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  headline: string;
  tagline: string;
  about: string;
  services: string[];
  email: string;
  phone: string;
  address: string;
  social: Record<string, string>;
  features: Record<string, any>;
  animations: string;
  metaTitle: string;
  metaDescription: string;
  heroStyle: string;
  locale: string;
}

export function buildSiteArchitecture(brief: Record<string, any>): SiteArch {
  const websiteType: 'landing' | 'multi-page' =
    brief?.preferences?.websiteType === 'multi-page' ? 'multi-page' : 'landing';

  const pages =
    websiteType === 'landing'
      ? ['Home']
      : (brief?.content?.pages as string[] | undefined)?.slice(0, 5) ?? [
          'Home',
          'About',
          'Contact',
        ];

  const defaultLandingSections = [
    { id: 'services',      title: 'Services' },
    { id: 'about',         title: 'About' },
    { id: 'contact',       title: 'Contact' },
  ];
  const landingSections: Array<{ id: string; title: string }> =
    websiteType === 'landing'
      ? ((brief?.content?.sections as Array<{ id: string; title: string }> | undefined) ??
          defaultLandingSections)
      : [];

  return {
    pages,
    websiteType,
    landingSections,
    businessName:    brief?.business?.name ?? 'Brand',
    industry:        brief?.business?.industry ?? '',
    style:           brief?.branding?.style ?? '',
    primaryColor:    brief?.branding?.colors?.primary ?? '',
    secondaryColor:  brief?.branding?.colors?.secondary ?? '',
    accentColor:     brief?.branding?.colors?.accent ?? (brief?.branding?.colors?.primary ?? ''),
    headingFont:     normalizeGFontName(brief?.branding?.fonts?.heading ?? ''),
    bodyFont:        normalizeGFontName(brief?.branding?.fonts?.body ?? ''),
    headline:        brief?.content?.headline ?? `Welcome to ${brief?.business?.name ?? 'Brand'}`,
    tagline:         brief?.business?.tagline ?? brief?.content?.tagline ?? '',
    about:           brief?.content?.about ?? brief?.business?.description ?? '',
    services:        (brief?.content?.services as string[] | undefined) ?? [],
    email:           brief?.contact?.email ?? '',
    phone:           brief?.contact?.phone ?? '',
    address:         brief?.contact?.address ?? '',
    social:          (brief?.social as Record<string, string>) ?? {},
    features:        { ...(brief?.features ?? {}) },
    animations:      brief?.preferences?.animations ?? '',
    metaTitle:       brief?.meta?.title ?? (brief?.business?.name ?? 'Brand'),
    metaDescription: brief?.meta?.description ?? (brief?.business?.description ?? ''),
    heroStyle:       brief?.media?.hero_style ?? '',
    locale:          brief?.business?.locale ?? 'en',
  };
}

