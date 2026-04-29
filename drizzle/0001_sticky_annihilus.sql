ALTER TABLE "pages" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "content" text NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" DROP COLUMN "embedding";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "scraped_at";