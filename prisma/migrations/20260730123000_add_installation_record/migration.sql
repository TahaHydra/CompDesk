BEGIN;

ALTER TABLE "users" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "installation_records" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installed_by_email" TEXT NOT NULL,
    "deployment_mode" TEXT NOT NULL,
    "application_url" TEXT NOT NULL,
    "demo_data_installed" BOOLEAN NOT NULL DEFAULT false,
    "setup_version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "installation_records_pkey" PRIMARY KEY ("id")
);

-- Existing installations already have an active Super Admin. Backfill a single
-- immutable completion record so an upgrade never reopens first-run setup.
INSERT INTO "installation_records" (
    "id", "installed_at", "installed_by_email", "deployment_mode",
    "application_url", "demo_data_installed", "setup_version"
)
SELECT 'primary', CURRENT_TIMESTAMP, LOWER(TRIM("email")), 'legacy-upgrade', '', false, 1
FROM "users"
WHERE "role" = 'SUPER_ADMIN' AND "is_active" = true
ORDER BY "created_at" ASC
LIMIT 1
ON CONFLICT ("id") DO NOTHING;

COMMIT;

-- Rollback: dropping installation_records does not remove users, tickets, or
-- settings, but it removes the permanent setup-completion marker. Do not roll
-- back on a running installation without also preventing bootstrap startup.