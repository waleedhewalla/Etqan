-- The syllabus tables were replaced by the memorization programme (migration 0012) and nothing reads them.
-- Hand-ordered: syllabus_passages references syllabi, so it goes first (drizzle-kit emitted the reverse).
DROP TABLE IF EXISTS "syllabus_passages";--> statement-breakpoint
DROP TABLE IF EXISTS "syllabi";
