BEGIN;

CREATE TYPE "AssignmentSource" AS ENUM ('MANUAL', 'CLAIM', 'ESCALATION', 'AUTOMATION');

CREATE TABLE "ticket_assignees" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "AssignmentSource" NOT NULL DEFAULT 'MANUAL',
    CONSTRAINT "ticket_assignees_pkey" PRIMARY KEY ("id")
);

-- A legacy assignment has no recorded actor. The assigned user is used as the
-- migration actor so the historical owner is retained without inventing a third party.
INSERT INTO "ticket_assignees" ("id", "ticket_id", "user_id", "assigned_by_id", "assigned_at", "source")
SELECT md5(random()::text || clock_timestamp()::text || "id" || "assignee_id"),
       "id", "assignee_id", "assignee_id", COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP),
       'MANUAL'::"AssignmentSource"
FROM "tickets"
WHERE "assignee_id" IS NOT NULL;

DO $$
DECLARE
    legacy_count BIGINT;
    migrated_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO legacy_count FROM "tickets" WHERE "assignee_id" IS NOT NULL;
    SELECT COUNT(*) INTO migrated_count FROM "ticket_assignees";
    IF legacy_count <> migrated_count THEN
        RAISE EXCEPTION 'Ticket assignment backfill verification failed: legacy %, migrated %', legacy_count, migrated_count;
    END IF;
    IF EXISTS (
        SELECT 1 FROM "tickets" t
        LEFT JOIN "ticket_assignees" ta ON ta."ticket_id" = t."id" AND ta."user_id" = t."assignee_id"
        WHERE t."assignee_id" IS NOT NULL AND ta."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Ticket assignment backfill verification found missing rows';
    END IF;
END;
$$;

CREATE UNIQUE INDEX "ticket_assignees_ticket_id_user_id_key" ON "ticket_assignees"("ticket_id", "user_id");
CREATE INDEX "ticket_assignees_ticket_id_idx" ON "ticket_assignees"("ticket_id");
CREATE INDEX "ticket_assignees_user_id_idx" ON "ticket_assignees"("user_id");
CREATE INDEX "ticket_assignees_user_id_ticket_id_idx" ON "ticket_assignees"("user_id", "ticket_id");
CREATE INDEX "ticket_assignees_ticket_id_assigned_at_idx" ON "ticket_assignees"("ticket_id", "assigned_at");

ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets" DROP CONSTRAINT "tickets_assignee_id_fkey";
DROP INDEX "tickets_assignee_id_idx";
ALTER TABLE "tickets" DROP COLUMN "assignee_id";

COMMIT;

-- Maintenance / rollback notes:
-- Apply during a maintenance window because this migration takes a write lock while
-- backfilling and dropping the legacy column. A rollback must first add assignee_id,
-- choose one assignment per ticket deterministically (for example earliest assigned_at),
-- copy it back, verify counts, then drop ticket_assignees and AssignmentSource. Rolling
-- back necessarily loses additional co-assignees, so restore from backup if that data
-- must be retained. Never reset a production database to roll this migration back.