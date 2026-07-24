-- Store each user's interface language without changing authentication/session tables.
ALTER TABLE "users"
ADD COLUMN "preferred_language" TEXT NOT NULL DEFAULT 'en';

ALTER TABLE "users"
ADD CONSTRAINT "users_preferred_language_check"
CHECK ("preferred_language" IN ('en', 'fr'));

-- Bilingual, searchable help-center structure. Collections cannot be removed
-- while articles still reference them, preventing accidental documentation loss.
CREATE TABLE "help_collections" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_fr" TEXT NOT NULL,
    "description_en" TEXT,
    "description_fr" TEXT,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "help_articles" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_fr" TEXT NOT NULL,
    "summary_en" TEXT,
    "summary_fr" TEXT,
    "content_en" TEXT NOT NULL,
    "content_fr" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "help_collections_slug_key" ON "help_collections"("slug");
CREATE INDEX "help_collections_is_published_sort_order_idx" ON "help_collections"("is_published", "sort_order");
CREATE UNIQUE INDEX "help_articles_slug_key" ON "help_articles"("slug");
CREATE INDEX "help_articles_collection_id_is_published_sort_order_idx" ON "help_articles"("collection_id", "is_published", "sort_order");

ALTER TABLE "help_articles"
ADD CONSTRAINT "help_articles_collection_id_fkey"
FOREIGN KEY ("collection_id") REFERENCES "help_collections"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;