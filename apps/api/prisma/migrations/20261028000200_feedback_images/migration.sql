-- AlterTable
ALTER TABLE "feedbacks" ADD COLUMN "image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
