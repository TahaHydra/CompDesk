ALTER TABLE "tickets" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "tickets_requester_id_idempotency_key_key"
    ON "tickets"("requester_id", "idempotency_key");
