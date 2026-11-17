-- Help articles suggested per category during ticket creation. Additive only.
CREATE TABLE "category_help_articles" (
    "category_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_help_articles_pkey" PRIMARY KEY ("category_id","article_id"),
    CONSTRAINT "category_help_articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "category_help_articles_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "help_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "category_help_articles_article_id_idx" ON "category_help_articles"("article_id");
