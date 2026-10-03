-- The original attachment migration omitted this generated-client field.
-- Add it in a new migration so already installed databases are repaired too.
ALTER TABLE "temporary_attachments"
    ADD COLUMN IF NOT EXISTS "blob_removed_at" TIMESTAMP(3);
