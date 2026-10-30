ALTER TYPE "consent_purpose" ADD VALUE 'ai_processing';--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "ai_status" varchar(16);--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "ai_provider" varchar(32);--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "ai_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasmi_submissions" ADD COLUMN "ai_error" text;