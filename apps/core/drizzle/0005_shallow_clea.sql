ALTER TABLE "review_logs" ADD COLUMN "client_id" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_logs_client_idx" ON "review_logs" ("card_id","client_id");