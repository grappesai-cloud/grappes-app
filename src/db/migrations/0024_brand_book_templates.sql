-- 0024_brand_book_templates.sql
-- Brand Book Lab: selectable visual templates
-- ('editorial' | 'corporate' | 'urban' | 'contemporary').

ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 'editorial';
