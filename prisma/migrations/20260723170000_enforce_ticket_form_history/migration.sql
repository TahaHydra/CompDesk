BEGIN;

-- Legacy tickets may have had no queue-owned custom values. Store an explicit empty object
-- so every ticket has a complete, immutable form submission record.
UPDATE "tickets"
SET "submitted_form_values" = '{}'::jsonb
WHERE "submitted_form_values" IS NULL;

-- Refuse to weaken history guarantees if an earlier migration did not resolve every ticket.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "tickets"
    WHERE "resolved_template_id" IS NULL
       OR "resolved_template_version" IS NULL
       OR "form_schema_snapshot" IS NULL
       OR "submitted_form_values" IS NULL
  ) THEN
    RAISE EXCEPTION 'Ticket form history backfill is incomplete';
  END IF;
END;
$$;

ALTER TABLE "tickets"
  ALTER COLUMN "resolved_template_id" SET NOT NULL,
  ALTER COLUMN "resolved_template_version" SET NOT NULL,
  ALTER COLUMN "form_schema_snapshot" SET NOT NULL,
  ALTER COLUMN "submitted_form_values" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "submitted_form_values" SET NOT NULL;

ALTER TABLE "tickets" DROP CONSTRAINT "tickets_resolved_template_id_fkey";
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_resolved_template_id_fkey"
  FOREIGN KEY ("resolved_template_id") REFERENCES "ticket_form_templates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;