-- AlterTable: allow anonymous feedback (public fill / QR without login)
ALTER TABLE "feedbacks" ALTER COLUMN "user_id" DROP NOT NULL;
