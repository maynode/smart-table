-- 兼容已用旧 init 建库的环境：若列已存在则跳过逻辑由手工保证。
-- 清空旧无密保用户后补列。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'security_question'
  ) THEN
    DELETE FROM "users";
    ALTER TABLE "users" ADD COLUMN "security_question" TEXT NOT NULL;
    ALTER TABLE "users" ADD COLUMN "security_answer_hash" TEXT NOT NULL;
  END IF;
END $$;
