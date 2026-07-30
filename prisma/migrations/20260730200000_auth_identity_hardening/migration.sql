-- Refuse to guess how ambiguous case variants should be merged. Operators must
-- reconcile these accounts before retrying the migration.
DO $$
DECLARE
    duplicate_identity TEXT;
BEGIN
    SELECT normalized
    INTO duplicate_identity
    FROM (
        SELECT LOWER(BTRIM("email")) AS normalized
        FROM "users"
        GROUP BY LOWER(BTRIM("email"))
        HAVING COUNT(*) > 1
        ORDER BY normalized
        LIMIT 1
    ) duplicates;

    IF duplicate_identity IS NOT NULL THEN
        RAISE EXCEPTION 'CompDesk normalized-email migration blocked: duplicate identity "%". Reconcile case/whitespace variants before retrying.', duplicate_identity;
    END IF;
END $$;

ALTER TABLE "users"
    ADD COLUMN "normalized_email" TEXT,
    ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "credentials_changed_at" TIMESTAMP(3);

UPDATE "users"
SET "email" = LOWER(BTRIM("email")),
    "normalized_email" = LOWER(BTRIM("email"));

ALTER TABLE "users"
    ALTER COLUMN "normalized_email" SET NOT NULL;

CREATE UNIQUE INDEX "users_normalized_email_key"
    ON "users"("normalized_email");

-- Auth.js adapters may insert a User without knowing application-only fields.
-- A database trigger therefore enforces the canonical identity for every write,
-- including adapter, setup, seed, API, and future integration paths.
CREATE OR REPLACE FUNCTION compdesk_set_normalized_user_email()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."email" := LOWER(BTRIM(NEW."email"));
    NEW."normalized_email" := LOWER(BTRIM(NEW."email"));
    RETURN NEW;
END;
$$;

CREATE TRIGGER "users_normalize_email"
BEFORE INSERT OR UPDATE OF "email" ON "users"
FOR EACH ROW
EXECUTE FUNCTION compdesk_set_normalized_user_email();

CREATE TABLE "login_throttles" (
    "id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "login_throttles_key_hash_key"
    ON "login_throttles"("key_hash");
CREATE INDEX "login_throttles_expires_at_idx"
    ON "login_throttles"("expires_at");

-- Rollback notes:
-- - drop the users_normalize_email trigger and function before dropping the
--   normalized_email column;
-- - dropping session_version/credentials_changed_at re-enables old JWTs and is
--   a security-sensitive rollback;
-- - login_throttles contains only keyed hashes and may be dropped without user
--   data loss, but doing so clears active brute-force lockouts;
-- - export and reconcile normalized identities before reverting application
--   binaries that do not understand this migration.