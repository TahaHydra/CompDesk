-- Default-deny API clients and durable signed webhook delivery history.
ALTER TABLE "api_clients"
    ADD COLUMN "allow_all_queues" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "webhook_configs"
    ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Webhook',
    ADD COLUMN "failure_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "disabled_at" TIMESTAMP(3);

CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMP(3),
    "response_status" INTEGER,
    "error_stage" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_deliveries_webhook_id_fkey"
        FOREIGN KEY ("webhook_id") REFERENCES "webhook_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx"
    ON "webhook_deliveries"("status", "next_attempt_at");
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx"
    ON "webhook_deliveries"("webhook_id", "created_at");

-- Existing API clients with an empty department list become default-deny. An
-- administrator must explicitly enable allow_all_queues after reviewing them.
-- Existing plaintext webhook secrets remain readable only for one-time
-- application encryption; the API never returns either plaintext or ciphertext.
-- Rollback removes delivery history and reintroduces the previous unsafe empty-list semantics.
