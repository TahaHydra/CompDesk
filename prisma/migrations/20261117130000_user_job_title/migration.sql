-- Optional job title shown on person cards. Additive and nullable: existing rows are unchanged.
ALTER TABLE "users" ADD COLUMN "job_title" TEXT;
