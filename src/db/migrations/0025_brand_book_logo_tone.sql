-- 0025_brand_book_logo_tone.sql
-- Brand Book Lab: remember whether the uploaded logo is light or dark so the
-- renderer can place it on a contrasting panel WITHOUT recoloring it.

ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS logo_is_light BOOLEAN NOT NULL DEFAULT TRUE;
