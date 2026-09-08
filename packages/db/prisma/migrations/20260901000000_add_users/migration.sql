DO $$
BEGIN
  IF to_regclass('"User"') IS NULL THEN
    CREATE TABLE "User" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "User_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
  ELSE
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
  END IF;
END $$;
