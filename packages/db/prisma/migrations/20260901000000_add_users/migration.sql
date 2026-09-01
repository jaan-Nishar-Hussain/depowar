DO $$
BEGIN
  IF to_regclass('"User"') IS NULL THEN
    CREATE TABLE "User" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "User_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
  ELSE
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
CREATE INDEX IF NOT EXISTS "User_clientId_idx" ON "User"("clientId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_clientId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
