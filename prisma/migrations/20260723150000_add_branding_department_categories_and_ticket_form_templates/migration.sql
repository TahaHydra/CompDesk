-- CompDesk reusable branding, department categories, and ticket form templates.
-- This migration is intentionally guarded, fully transactional, and safe against partial application.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ticket_form_templates') IS NOT NULL THEN
    RAISE EXCEPTION 'ticket form template migration has already been applied';
  END IF;
END $$;

CREATE TYPE "BuiltInTicketField" AS ENUM (
  'TITLE', 'DESCRIPTION', 'PRIORITY', 'SEVERITY', 'ATTACHMENTS', 'TAGS'
);

CREATE TABLE "ticket_form_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_system_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_form_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_form_templates_system_default_valid_check"
    CHECK (NOT "is_system_default" OR ("is_active" AND "archived_at" IS NULL))
);

CREATE TABLE "ticket_form_template_fields" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "field_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "type" "FormFieldType" NOT NULL,
  "built_in" "BuiltInTicketField",
  "placeholder" TEXT,
  "help_text" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "default_value" JSONB,
  "options" JSONB,
  "validation_rules" JSONB,
  "conditional_rules" JSONB,
  "visible_to" TEXT[] NOT NULL DEFAULT ARRAY['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN']::TEXT[],
  "editable_by" TEXT[] NOT NULL DEFAULT ARRAY['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN']::TEXT[],
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "width" INTEGER NOT NULL DEFAULT 12,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_form_template_fields_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_form_template_fields_width_check" CHECK ("width" BETWEEN 1 AND 12)
);

-- Older installations received this Auth.js field through db push, while a pristine migration-only
-- database did not. IF NOT EXISTS brings both histories to the same tracked schema safely.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" TIMESTAMP(3);
ALTER TABLE "queues"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "default_template_id" TEXT;

ALTER TABLE "categories"
  ADD COLUMN "queue_id" TEXT,
  ADD COLUMN "template_id" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "tickets" RENAME COLUMN "form_data" TO "submitted_form_values";
ALTER TABLE "tickets"
  ADD COLUMN "resolved_template_id" TEXT,
  ADD COLUMN "resolved_template_version" INTEGER,
  ADD COLUMN "form_schema_snapshot" JSONB;

CREATE UNIQUE INDEX "ticket_form_templates_single_system_default_key"
  ON "ticket_form_templates" ("is_system_default")
  WHERE "is_system_default" = true;
CREATE INDEX "ticket_form_templates_is_system_default_is_active_idx"
  ON "ticket_form_templates" ("is_system_default", "is_active");
CREATE INDEX "ticket_form_templates_archived_at_idx"
  ON "ticket_form_templates" ("archived_at");
CREATE UNIQUE INDEX "ticket_form_template_fields_template_id_field_key_key"
  ON "ticket_form_template_fields" ("template_id", "field_key");
CREATE INDEX "ticket_form_template_fields_template_id_sort_order_idx"
  ON "ticket_form_template_fields" ("template_id", "sort_order");
CREATE INDEX "queues_is_active_idx" ON "queues" ("is_active");
CREATE INDEX "queues_default_template_id_idx" ON "queues" ("default_template_id");

ALTER TABLE "ticket_form_template_fields"
  ADD CONSTRAINT "ticket_form_template_fields_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "ticket_form_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The protected system form exists independently of seed execution.
INSERT INTO "ticket_form_templates" (
  "id", "name", "description", "version", "is_system_default", "is_active", "updated_at"
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'System Default Ticket Form',
  'Protected fallback form used when a department or category has no active template assignment.',
  1, true, true, CURRENT_TIMESTAMP
);

INSERT INTO "ticket_form_template_fields" (
  "id", "template_id", "field_key", "label", "type", "built_in", "placeholder",
  "help_text", "required", "options", "visible_to", "editable_by", "sort_order", "width", "updated_at"
) VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'title', 'Title', 'TEXT', 'TITLE', 'Brief summary of your request', NULL, true, NULL, ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], 10, 12, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'description', 'Description', 'TEXTAREA', 'DESCRIPTION', 'Provide as much detail as possible', NULL, false, NULL, ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], 20, 12, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'priority', 'Priority', 'DROPDOWN', 'PRIORITY', NULL, NULL, true, '["LOW","NORMAL","HIGH","URGENT"]'::jsonb, ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], 30, 6, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'severity', 'Severity', 'DROPDOWN', 'SEVERITY', NULL, NULL, false, '["S1","S2","S3","S4"]'::jsonb, ARRAY['AGENT','ADMIN','SUPER_ADMIN'], ARRAY['AGENT','ADMIN','SUPER_ADMIN'], 40, 6, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'attachments', 'Attachments', 'FILE', 'ATTACHMENTS', NULL, 'Up to five files, 10 MB each.', false, NULL, ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], 50, 12, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0001-000000000006', '00000000-0000-0000-0000-000000000001', 'tags', 'Tags', 'MULTISELECT', 'TAGS', NULL, NULL, false, '[]'::jsonb, ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN'], 60, 12, CURRENT_TIMESTAMP);

-- Built-in field keys are reserved. If a legacy custom field reused one, preserve its value under
-- a deterministic collision-free key before adding the built-in field with the canonical key.
WITH conflicts AS (
  SELECT
    "queue_id",
    "field_key" AS old_key,
    'legacy_' || substr(md5("id"), 1, 8) || '_' || "field_key" AS new_key
  FROM "form_fields"
  WHERE lower("field_key") IN ('title','description','priority','severity','attachments','tags')
), rewritten AS (
  SELECT
    t."id",
    jsonb_object_agg(COALESCE(c.new_key, entry.key), entry.value) AS values
  FROM "tickets" t
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(t."submitted_form_values") = 'object' THEN t."submitted_form_values" ELSE '{}'::jsonb END) entry
  LEFT JOIN conflicts c ON c."queue_id" = t."queue_id" AND c.old_key = entry.key
  WHERE jsonb_typeof(t."submitted_form_values") = 'object'
  GROUP BY t."id"
)
UPDATE "tickets" t
SET "submitted_form_values" = rewritten.values
FROM rewritten
WHERE rewritten."id" = t."id";
-- Convert each legacy department-owned field collection into its own template.
INSERT INTO "ticket_form_templates" (
  "id", "name", "description", "version", "is_system_default", "is_active", "created_at", "updated_at"
)
SELECT
  substr(md5('legacy-template:' || q."id"),1,8) || '-' || substr(md5('legacy-template:' || q."id"),9,4) || '-' || substr(md5('legacy-template:' || q."id"),13,4) || '-' || substr(md5('legacy-template:' || q."id"),17,4) || '-' || substr(md5('legacy-template:' || q."id"),21,12),
  q."name" || ' Migrated Ticket Form',
  'Migrated from the legacy department-owned form fields.',
  1, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "queues" q
WHERE EXISTS (SELECT 1 FROM "form_fields" f WHERE f."queue_id" = q."id");

INSERT INTO "ticket_form_template_fields" (
  "id", "template_id", "field_key", "label", "type", "built_in", "required", "options",
  "validation_rules", "conditional_rules", "visible_to", "editable_by", "sort_order", "width",
  "is_active", "created_at", "updated_at"
)
SELECT
  f."id",
  substr(md5('legacy-template:' || f."queue_id"),1,8) || '-' || substr(md5('legacy-template:' || f."queue_id"),9,4) || '-' || substr(md5('legacy-template:' || f."queue_id"),13,4) || '-' || substr(md5('legacy-template:' || f."queue_id"),17,4) || '-' || substr(md5('legacy-template:' || f."queue_id"),21,12),
  CASE WHEN lower(f."field_key") IN ('title','description','priority','severity','attachments','tags')
    THEN 'legacy_' || substr(md5(f."id"), 1, 8) || '_' || f."field_key"
    ELSE f."field_key" END,
  f."label",
  f."type",
  NULL,
  f."required",
  f."options",
  f."validation_rules",
  f."conditional_rules",
  COALESCE(f."visible_to", ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN']::TEXT[]),
  COALESCE(f."visible_to", ARRAY['USER','AGENT','ADMIN','SUPER_ADMIN']::TEXT[]),
  f."sort_order" + 100,
  12,
  true,
  f."created_at",
  f."updated_at"
FROM "form_fields" f;

-- Migrated templates also include the routing-safe built-in fields from the system default.
INSERT INTO "ticket_form_template_fields" (
  "id", "template_id", "field_key", "label", "type", "built_in", "placeholder", "help_text",
  "required", "default_value", "options", "validation_rules", "conditional_rules", "visible_to",
  "editable_by", "sort_order", "width", "is_active", "created_at", "updated_at"
)
SELECT
  substr(md5(t."id" || ':' || f."id"),1,8) || '-' || substr(md5(t."id" || ':' || f."id"),9,4) || '-' || substr(md5(t."id" || ':' || f."id"),13,4) || '-' || substr(md5(t."id" || ':' || f."id"),17,4) || '-' || substr(md5(t."id" || ':' || f."id"),21,12),
  t."id", f."field_key", f."label", f."type", f."built_in", f."placeholder", f."help_text",
  f."required", f."default_value", f."options", f."validation_rules", f."conditional_rules",
  f."visible_to", f."editable_by", f."sort_order", f."width", f."is_active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ticket_form_templates" t
CROSS JOIN "ticket_form_template_fields" f
WHERE t."description" = 'Migrated from the legacy department-owned form fields.'
  AND f."template_id" = '00000000-0000-0000-0000-000000000001';

UPDATE "queues" q
SET "default_template_id" = substr(md5('legacy-template:' || q."id"),1,8) || '-' || substr(md5('legacy-template:' || q."id"),9,4) || '-' || substr(md5('legacy-template:' || q."id"),13,4) || '-' || substr(md5('legacy-template:' || q."id"),17,4) || '-' || substr(md5('legacy-template:' || q."id"),21,12)
WHERE EXISTS (SELECT 1 FROM "form_fields" f WHERE f."queue_id" = q."id");

-- Legacy categories were global. Make a deterministic copy for every department because every
-- legacy category was selectable in every department, then remap tickets using their real queue.
DROP INDEX "categories_name_key";

INSERT INTO "categories" (
  "id", "queue_id", "template_id", "name", "description", "is_active", "archived_at",
  "created_at", "updated_at"
)
SELECT
  substr(md5(q."id" || ':' || c."id"),1,8) || '-' || substr(md5(q."id" || ':' || c."id"),9,4) || '-' || substr(md5(q."id" || ':' || c."id"),13,4) || '-' || substr(md5(q."id" || ':' || c."id"),17,4) || '-' || substr(md5(q."id" || ':' || c."id"),21,12),
  q."id", NULL, c."name", c."description", c."is_active",
  CASE WHEN c."is_active" THEN NULL ELSE CURRENT_TIMESTAMP END,
  c."created_at", CURRENT_TIMESTAMP
FROM "queues" q
CROSS JOIN "categories" c
WHERE c."queue_id" IS NULL;

UPDATE "tickets" t
SET "category_id" =
  substr(md5(t."queue_id" || ':' || t."category_id"),1,8) || '-' || substr(md5(t."queue_id" || ':' || t."category_id"),9,4) || '-' || substr(md5(t."queue_id" || ':' || t."category_id"),13,4) || '-' || substr(md5(t."queue_id" || ':' || t."category_id"),17,4) || '-' || substr(md5(t."queue_id" || ':' || t."category_id"),21,12)
WHERE t."category_id" IS NOT NULL;

DELETE FROM "categories" WHERE "queue_id" IS NULL;
ALTER TABLE "categories" ALTER COLUMN "queue_id" SET NOT NULL;
ALTER TABLE "categories" ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE UNIQUE INDEX "categories_queue_id_name_key" ON "categories" ("queue_id", "name");
CREATE INDEX "categories_queue_id_is_active_idx" ON "categories" ("queue_id", "is_active");
CREATE INDEX "categories_template_id_idx" ON "categories" ("template_id");
CREATE INDEX "tickets_category_id_idx" ON "tickets" ("category_id");
CREATE INDEX "tickets_resolved_template_id_idx" ON "tickets" ("resolved_template_id");

-- Older installations received this Auth.js field through db push, while a pristine migration-only
-- database did not. IF NOT EXISTS brings both histories to the same tracked schema safely.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" TIMESTAMP(3);
ALTER TABLE "queues"
  ADD CONSTRAINT "queues_default_template_id_fkey"
  FOREIGN KEY ("default_template_id") REFERENCES "ticket_form_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_queue_id_fkey"
  FOREIGN KEY ("queue_id") REFERENCES "queues"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "ticket_form_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_resolved_template_id_fkey"
  FOREIGN KEY ("resolved_template_id") REFERENCES "ticket_form_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_category_id_fkey";
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot the effective schema for every historical ticket before removing legacy fields.
WITH resolved AS (
  SELECT
    t."id" AS ticket_id,
    COALESCE(c."template_id", q."default_template_id", '00000000-0000-0000-0000-000000000001') AS template_id
  FROM "tickets" t
  JOIN "queues" q ON q."id" = t."queue_id"
  LEFT JOIN "categories" c ON c."id" = t."category_id"
), snapshots AS (
  SELECT
    r.ticket_id,
    ft."id" AS template_id,
    ft."name" AS template_name,
    ft."version",
    jsonb_build_object(
      'templateId', ft."id",
      'templateName', ft."name",
      'version', ft."version",
      'fields', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', f."id",
            'fieldKey', f."field_key",
            'label', f."label",
            'type', f."type"::text,
            'builtIn', CASE WHEN f."built_in" IS NULL THEN NULL ELSE f."built_in"::text END,
            'placeholder', f."placeholder",
            'helpText', f."help_text",
            'required', f."required",
            'defaultValue', f."default_value",
            'options', COALESCE(f."options", '[]'::jsonb),
            'validationRules', f."validation_rules",
            'conditionalRules', f."conditional_rules",
            'visibleTo', to_jsonb(f."visible_to"),
            'editableBy', to_jsonb(f."editable_by"),
            'sortOrder', f."sort_order",
            'width', f."width",
            'isActive', f."is_active"
          ) ORDER BY f."sort_order", f."created_at"
        ) FILTER (WHERE f."id" IS NOT NULL),
        '[]'::jsonb
      )
    ) AS schema_snapshot
  FROM resolved r
  JOIN "ticket_form_templates" ft ON ft."id" = r.template_id
  LEFT JOIN "ticket_form_template_fields" f ON f."template_id" = ft."id" AND f."is_active" = true
  GROUP BY r.ticket_id, ft."id", ft."name", ft."version"
)
UPDATE "tickets" t
SET
  "resolved_template_id" = s.template_id,
  "resolved_template_version" = s."version",
  "form_schema_snapshot" = s.schema_snapshot
FROM snapshots s
WHERE s.ticket_id = t."id";

DROP TABLE "form_fields";

-- Database-level protection keeps the single system default valid even outside the application.
CREATE OR REPLACE FUNCTION protect_system_ticket_form_template()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."is_system_default" THEN
    RAISE EXCEPTION 'The system default ticket form template cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."is_system_default" AND (
    NOT NEW."is_system_default" OR NOT NEW."is_active" OR NEW."archived_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The system default ticket form template cannot be demoted or archived';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "protect_system_ticket_form_template_trigger"
BEFORE UPDATE OR DELETE ON "ticket_form_templates"
FOR EACH ROW EXECUTE FUNCTION protect_system_ticket_form_template();

COMMIT;
