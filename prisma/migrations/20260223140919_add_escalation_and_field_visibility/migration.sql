-- AlterEnum
ALTER TYPE "TimelineEventType" ADD VALUE 'ESCALATED';

-- AlterTable
ALTER TABLE "form_fields" ADD COLUMN     "visible_to" TEXT[] DEFAULT ARRAY['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN']::TEXT[];

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "escalated_at" TIMESTAMP(3),
ADD COLUMN     "escalated_by_id" TEXT,
ADD COLUMN     "escalated_to_id" TEXT,
ADD COLUMN     "escalation_level" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "tickets_escalation_level_idx" ON "tickets"("escalation_level");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_escalated_by_id_fkey" FOREIGN KEY ("escalated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_escalated_to_id_fkey" FOREIGN KEY ("escalated_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
