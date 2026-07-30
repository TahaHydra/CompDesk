-- Attachment content verification, malware scan state, ownership, and temporary quota reservations.
CREATE TYPE "AttachmentScanStatus" AS ENUM ('NOT_CONFIGURED', 'CLEAN', 'INFECTED', 'ERROR');

ALTER TABLE "attachments"
    ADD COLUMN "uploader_id" TEXT,
    ADD COLUMN "detected_mimetype" TEXT,
    ADD COLUMN "sha256" TEXT,
    ADD COLUMN "scan_status" "AttachmentScanStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    ADD COLUMN "scanned_at" TIMESTAMP(3),
    ADD COLUMN "blob_removed_at" TIMESTAMP(3);

-- Existing files predate content verification. Keep them explicitly unscanned and
-- retain their declared type until an administrator runs a future rescan tool.
UPDATE "attachments"
SET "detected_mimetype" = "mimetype",
    "sha256" = 'legacy-unverified'
WHERE "detected_mimetype" IS NULL OR "sha256" IS NULL;

ALTER TABLE "attachments"
    ALTER COLUMN "detected_mimetype" SET NOT NULL,
    ALTER COLUMN "sha256" SET NOT NULL;

ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_uploader_id_fkey"
    FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "attachments_ticket_id_deleted_at_idx" ON "attachments"("ticket_id", "deleted_at");
CREATE INDEX "attachments_scan_status_idx" ON "attachments"("scan_status");

CREATE TABLE "temporary_attachments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "detected_mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "scan_status" "AttachmentScanStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "scanned_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "temporary_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "temporary_attachments_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "temporary_attachments_path_key" ON "temporary_attachments"("path");
CREATE INDEX "temporary_attachments_user_id_expires_at_idx" ON "temporary_attachments"("user_id", "expires_at");
CREATE INDEX "temporary_attachments_expires_at_idx" ON "temporary_attachments"("expires_at");

-- Rollback notes: remove temporary_attachments, the attachment indexes/foreign key,
-- the six attachment columns, then drop AttachmentScanStatus. Files written after
-- this migration remain private on disk and must be reconciled before rollback.
