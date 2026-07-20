-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" TEXT;

-- CreateTable
CREATE TABLE "queue_members" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'agent',

    CONSTRAINT "queue_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "queue_members_queue_id_user_id_role_key"
    ON "queue_members"("queue_id", "user_id", "role");

-- AddForeignKey
ALTER TABLE "queue_members"
    ADD CONSTRAINT "queue_members_queue_id_fkey"
    FOREIGN KEY ("queue_id") REFERENCES "queues"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_members"
    ADD CONSTRAINT "queue_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
