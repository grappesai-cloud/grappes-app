-- Add metadata JSONB column to assets table.
-- Upload code writes sectionId, altText, note, order, variants, variantPaths into this column.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS metadata JSONB;

NOTIFY pgrst, 'reload schema';
