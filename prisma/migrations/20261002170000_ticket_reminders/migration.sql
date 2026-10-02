CREATE TABLE "ticket_reminders" (
 "id" TEXT PRIMARY KEY, "ticket_id" TEXT NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "scheduled_at" TIMESTAMP(3) NOT NULL, "note" TEXT NOT NULL DEFAULT '', "email" BOOLEAN NOT NULL DEFAULT false,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lease_token" TEXT, "lease_until" TIMESTAMP(3),
 "delivered_at" TIMESTAMP(3), "email_accepted" BOOLEAN NOT NULL DEFAULT false,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ticket_reminders_status_scheduled_at_next_attempt_at_idx" ON "ticket_reminders"("status", "scheduled_at", "next_attempt_at");
CREATE INDEX "ticket_reminders_user_id_delivered_at_idx" ON "ticket_reminders"("user_id", "delivered_at");
