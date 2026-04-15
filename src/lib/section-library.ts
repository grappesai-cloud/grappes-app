// Universal section library — 25 sections that cover most websites.
// The Haiku consultant proposes a subset based on the user's business
// description, and the user confirms / edits the list before deeper
// per-section questioning.

export type SectionKey =
  | 'hero' | 'about' | 'services' | 'products' | 'portfolio'
  | 'testimonials' | 'team' | 'pricing' | 'process' | 'gallery'
  | 'menu' | 'booking' | 'faq' | 'blog' | 'press'
  | 'awards' | 'clients' | 'stats' | 'video' | 'contact'
  | 'map' | 'newsletter' | 'partners' | 'events' | 'resources';

export interface SectionDef {
  key: SectionKey;
  title: string;
  blurb: string;          // one-line description for AI prompt
  fitFor: string;         // typical use cases
}

export const SECTION_LIBRARY: SectionDef[] = [
  { key: 'hero',         title: 'Hero',                     blurb: 'Big headline + tagline + CTA at the top of the homepage.',                       fitFor: 'every site' },
  { key: 'about',        title: 'About / Mission',          blurb: 'Story, mission, what the brand stands for.',                                     fitFor: 'every site' },
  { key: 'services',     title: 'Services / Features',      blurb: 'List of services or product features with short descriptions.',                   fitFor: 'service business, SaaS, agency' },
  { key: 'products',     title: 'Products',                 blurb: 'Product grid or feature cards.',                                                  fitFor: 'e-commerce, SaaS' },
  { key: 'portfolio',    title: 'Portfolio / Case studies', blurb: 'Showcase past work, projects, or case studies with imagery + outcomes.',          fitFor: 'agency, consultancy, IT, creative' },
  { key: 'testimonials', title: 'Testimonials / Reviews',   blurb: 'Quotes from happy clients, optionally with photos and ratings.',                 fitFor: 'any business with customers' },
  { key: 'team',         title: 'Team / Founders',          blurb: 'Photos and roles of the team or founders.',                                       fitFor: 'agency, startup, professional services' },
  { key: 'pricing',      title: 'Pricing / Plans',          blurb: 'Pricing tiers or packages.',                                                      fitFor: 'SaaS, services, freelance, courses' },
  { key: 'process',      title: 'How it works / Process',   blurb: 'Step-by-step explanation of working together or using the product.',              fitFor: 'service business, SaaS' },
  { key: 'gallery',      title: 'Gallery / Photos',         blurb: 'Image gallery — interior, events, products in context.',                          fitFor: 'restaurant, venue, photography, retail' },
  { key: 'menu',         title: 'Menu',                     blurb: 'Food/drink menu with sections and prices.',                                       fitFor: 'restaurant, cafe, bar' },
  { key: 'booking',      title: 'Booking / Hours',          blurb: 'Opening hours and a booking/reservation widget or contact button.',               fitFor: 'local services, salons, restaurants' },
  { key: 'faq',          title: 'FAQ',                      blurb: 'Common questions and answers.',                                                   fitFor: 'every site' },
  { key: 'blog',         title: 'Blog / Articles',          blurb: 'Recent posts or article previews.',                                               fitFor: 'content, SEO, education' },
  { key: 'press',        title: 'Press / Featured in',      blurb: 'Logos of publications/podcasts that featured the brand.',                         fitFor: 'brand building, PR' },
  { key: 'awards',       title: 'Awards / Certifications',  blurb: 'Badges for awards, certifications, accreditations.',                              fitFor: 'professional, medical, legal, finance' },
  { key: 'clients',      title: 'Clients / Brands',         blurb: 'Logos of clients or brands they have worked with.',                               fitFor: 'B2B, agency, freelance' },
  { key: 'stats',        title: 'Stats / Numbers',          blurb: 'Big-number metrics — years in business, projects done, satisfied clients.',       fitFor: 'agency, corporate, established business' },
  { key: 'video',        title: 'Video showcase',           blurb: 'Embedded explainer or hero video.',                                               fitFor: 'creative, demo, product launches' },
  { key: 'contact',      title: 'Contact',                  blurb: 'Email, phone, contact form.',                                                     fitFor: 'every site' },
  { key: 'map',          title: 'Location / Map',           blurb: 'Embedded map of the physical location.',                                          fitFor: 'local business, retail, venue' },
  { key: 'newsletter',   title: 'Newsletter / CTA',         blurb: 'Newsletter signup or strong final CTA before the footer.',                        fitFor: 'content, lead-gen, e-commerce' },
  { key: 'partners',     title: 'Partners / Integrations',  blurb: 'Logos of partner brands, technologies, or integrations.',                         fitFor: 'SaaS, B2B' },
  { key: 'events',       title: 'Events / Calendar',        blurb: 'Upcoming events list or calendar embed.',                                         fitFor: 'cultural, fitness, club, conference' },
  { key: 'resources',    title: 'Downloads / Resources',    blurb: 'Whitepapers, e-books, free tools, brochures.',                                    fitFor: 'B2B, education, lead magnets' },
];

/** Compact reference list rendered into the Haiku system prompt. */
export function sectionLibraryAsPrompt(): string {
  return SECTION_LIBRARY.map(s => `- ${s.key} (${s.title}): ${s.blurb} — fits: ${s.fitFor}`).join('\n');
}
