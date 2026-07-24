-- Store API clients as independent rows so concurrent authentication and admin
-- changes cannot overwrite one another. Preserve clients from the legacy JSON
-- AppSetting when that value is valid.
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "allowed_queue_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_clients_key_hash_key" ON "api_clients"("key_hash");
CREATE INDEX "api_clients_is_active_idx" ON "api_clients"("is_active");

DO $$
DECLARE
    legacy_value TEXT;
    item JSONB;
BEGIN
    SELECT "value" INTO legacy_value FROM "app_settings" WHERE "key" = 'api_clients';
    IF legacy_value IS NULL THEN
        RETURN;
    END IF;

    BEGIN
        IF jsonb_typeof(legacy_value::jsonb) <> 'array' THEN
            RAISE NOTICE 'Skipping non-array legacy api_clients setting.';
            RETURN;
        END IF;

        FOR item IN SELECT value FROM jsonb_array_elements(legacy_value::jsonb)
        LOOP
            IF COALESCE(item->>'id', '') = '' OR COALESCE(item->>'keyHash', '') = '' THEN
                CONTINUE;
            END IF;
            INSERT INTO "api_clients" (
                "id", "name", "key_hash", "scopes", "allowed_queue_ids",
                "is_active", "last_used_at", "created_at", "updated_at"
            ) VALUES (
                item->>'id',
                COALESCE(NULLIF(BTRIM(item->>'name'), ''), 'Migrated API client'),
                item->>'keyHash',
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'scopes', '[]'::jsonb))),
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'allowedQueueIds', '[]'::jsonb))),
                COALESCE((item->>'isActive')::boolean, true),
                CASE WHEN COALESCE(item->>'lastUsedAt', '') = '' THEN NULL ELSE (item->>'lastUsedAt')::timestamp END,
                CASE WHEN COALESCE(item->>'createdAt', '') = '' THEN CURRENT_TIMESTAMP ELSE (item->>'createdAt')::timestamp END,
                CASE WHEN COALESCE(item->>'updatedAt', '') = '' THEN CURRENT_TIMESTAMP ELSE (item->>'updatedAt')::timestamp END
            ) ON CONFLICT DO NOTHING;
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Legacy api_clients migration skipped: %', SQLERRM;
    END;
END $$;


-- Keep the legacy setting as a rollback safety net. Runtime code ignores it;
-- a later migration may remove it once operators have verified the row copy.
