-- Personal saved replies for staff. Additive only: no existing table changes.
CREATE TABLE "saved_replies" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_replies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saved_replies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "saved_replies_owner_id_title_key" ON "saved_replies"("owner_id", "title");
CREATE INDEX "saved_replies_owner_id_use_count_idx" ON "saved_replies"("owner_id", "use_count");
