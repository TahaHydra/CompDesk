-- Department and category availability for tags. Additive only: every existing tag keeps
-- all_departments = true, so its availability and every ticket's tags are unchanged. Earlier
-- releases ignore the new column and table, so rolling back keeps working (tags are then
-- offered everywhere again).
ALTER TABLE "tags" ADD COLUMN "all_departments" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "tag_scopes" (
    "id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "category_id" TEXT,

    CONSTRAINT "tag_scopes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tag_scopes_queue_id_idx" ON "tag_scopes"("queue_id");
CREATE INDEX "tag_scopes_category_id_idx" ON "tag_scopes"("category_id");
CREATE UNIQUE INDEX "tag_scopes_tag_id_queue_id_category_id_key" ON "tag_scopes"("tag_id", "queue_id", "category_id");

ALTER TABLE "tag_scopes" ADD CONSTRAINT "tag_scopes_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tag_scopes" ADD CONSTRAINT "tag_scopes_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tag_scopes" ADD CONSTRAINT "tag_scopes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
