// ── Brand Book mockup templates ──────────────────────────────────────────────
// Catalog of "blank product" base illustrations + the rectangular region where
// the user's logo gets composited. Each template lives in /public/mockups/<id>.jpg.
//
// PR 3 ships flat-illustration SVG bases (approach B in the spec). The Recraft-
// generated photographic version (approach A) is wired through
// scripts/generate-mockups.mjs — re-run once a real RECRAFT_API_KEY is
// populated in Vercel env to upgrade the bases to photoreal JPEGs.

export type MockupId =
  | "business_card"
  | "billboard"
  | "tote_bag"
  | "t_shirt"
  | "phone_case"
  | "coffee_cup"
  | "signage"
  | "vehicle";

export interface MockupTemplate {
  id: MockupId;
  label: string;
  /** Path served from /public — used both for the base image and as fallback. */
  base_url: string;
  /** Logical canvas size of the base image (px). */
  width: number;
  height: number;
  /** Logo placement rectangle in pixels relative to base_url. */
  logo_region: { x: number; y: number; w: number; h: number };
  /** Sharp blend mode for the composite step. */
  blend?: "over" | "multiply" | "screen";
  /**
   * Optional retint of the logo before compositing — useful when the base
   * is a dark product (black phone case → white logo).
   *   - "auto"  → derive from base avg luminance
   *   - "white" → recolor all non-transparent pixels white
   *   - "black" → recolor all non-transparent pixels black
   */
  logo_tint?: "auto" | "white" | "black";
}

export const MOCKUPS: Record<MockupId, MockupTemplate> = {
  business_card: {
    id: "business_card",
    label: "Business Card",
    base_url: "/mockups/business_card.jpg",
    width: 1024, height: 1024,
    logo_region: { x: 202, y: 382, w: 260, h: 260 },
    blend: "over",
  },
  billboard: {
    id: "billboard",
    label: "Billboard",
    base_url: "/mockups/billboard.jpg",
    width: 1024, height: 1024,
    logo_region: { x: 160, y: 210, w: 704, h: 380 },
    blend: "over",
  },
  tote_bag: {
    id: "tote_bag",
    label: "Tote Bag",
    base_url: "/mockups/tote_bag.jpg",
    width: 1024, height: 1024,
    logo_region: { x: 290, y: 380, w: 444, h: 444 },
    blend: "over",
  },
  t_shirt: {
    id: "t_shirt",
    label: "T-Shirt",
    base_url: "/mockups/t_shirt.jpg",
    width: 1024, height: 1024,
    logo_region: { x: 396, y: 500, w: 232, h: 232 },
    blend: "over",
  },
  phone_case: {
    id: "phone_case",
    label: "Phone Case",
    base_url: "/mockups/phone_case.jpg",
    width: 1024, height: 1024,
    logo_region: { x: 372, y: 260, w: 280, h: 280 },
    blend: "over",
    logo_tint: "white",
  },
  coffee_cup: {
    id: "coffee_cup",
    label: "Coffee Cup",
    base_url: "/mockups/coffee_cup.jpg",
    width: 1024, height: 1024,
    logo_region: { x: 372, y: 430, w: 280, h: 280 },
    blend: "over",
  },
  signage: {
    id: "signage",
    label: "Signage",
    base_url: "/mockups/signage.jpg",
    width: 1024, height: 1024,
    logo_region: { x: 170, y: 430, w: 684, h: 180 },
    blend: "over",
  },
  vehicle: {
    id: "vehicle",
    label: "Delivery Vehicle",
    base_url: "/mockups/vehicle.jpg",
    width: 1024, height: 1024,
    logo_region: { x: 280, y: 520, w: 560, h: 220 },
    blend: "over",
  },
};

export const MOCKUP_LIST: MockupTemplate[] = Object.values(MOCKUPS);

export function isMockupId(s: string): s is MockupId {
  return Object.prototype.hasOwnProperty.call(MOCKUPS, s);
}
