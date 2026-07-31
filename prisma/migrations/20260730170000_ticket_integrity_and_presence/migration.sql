-- Ticket integrity additions are backward-compatible. The legacy locked_by and
-- locked_at columns are deliberately retained in PostgreSQL during this release
-- so an upgrade never discards data, but the application no longer maps or uses
-- them.

ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';

ALTER TABLE "tickets"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "first_assigned_at" TIMESTAMP(3);

UPDATE "tickets" AS ticket
SET "first_assigned_at" = assignment."first_assigned_at"
FROM (
    SELECT "ticket_id", MIN("assigned_at") AS "first_assigned_at"
    FROM "ticket_assignees"
    GROUP BY "ticket_id"
) AS assignment
WHERE assignment."ticket_id" = ticket."id"
  AND ticket."first_assigned_at" IS NULL;

CREATE TABLE "ticket_presence" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_presence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ticket_presence_ticket_id_fkey"
        FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ticket_presence_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ticket_presence_ticket_id_user_id_key"
    ON "ticket_presence"("ticket_id", "user_id");
CREATE INDEX "ticket_presence_ticket_id_last_seen_at_idx"
    ON "ticket_presence"("ticket_id", "last_seen_at");

ALTER TABLE "timeline_events"
    ADD COLUMN "deleted_at" TIMESTAMP(3),
    ADD COLUMN "deleted_by_id" TEXT,
    ADD COLUMN "delete_reason" TEXT;

ALTER TABLE "attachments"
    ADD COLUMN "deleted_at" TIMESTAMP(3),
    ADD COLUMN "deleted_by_id" TEXT,
    ADD COLUMN "delete_reason" TEXT;

-- Rollback notes:
-- - ticket_presence can be dropped without changing ticket business history.
-- - version and first_assigned_at can be dropped only after old application
--   binaries are restored.
-- - deleted_* fields contain retention evidence and must be exported before any
--   rollback that drops them.
-- - PostgreSQL enum values cannot be safely removed while referenced; leave
--   WITHDRAWN in place during rollback.
