ALTER TYPE "TimelineEventType" ADD VALUE 'REMINDER_SENT';
CREATE TYPE "TicketReminderStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "ticket_reminders" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "sent_by_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "status" "TicketReminderStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "ticket_reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_reminders_ticket_id_status_sent_at_idx" ON "ticket_reminders"("ticket_id", "status", "sent_at");
CREATE INDEX "ticket_reminders_ticket_id_status_created_at_idx" ON "ticket_reminders"("ticket_id", "status", "created_at");
CREATE INDEX "ticket_reminders_recipient_id_sent_at_idx" ON "ticket_reminders"("recipient_id", "sent_at");

ALTER TABLE "ticket_reminders" ADD CONSTRAINT "ticket_reminders_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_reminders" ADD CONSTRAINT "ticket_reminders_sent_by_id_fkey"
    FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_reminders" ADD CONSTRAINT "ticket_reminders_recipient_id_fkey"
    FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
