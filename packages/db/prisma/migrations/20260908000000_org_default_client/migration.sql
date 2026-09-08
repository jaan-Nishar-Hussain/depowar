-- Organization gains a reference to the sign-up TEST client so a user with no
-- project yet can still hold a session clientId (Next-Gen PRD §Onboarding:
-- API keys require an explicit project, so no default project is auto-created).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "defaultClientId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_defaultClientId_key" ON "Organization"("defaultClientId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Organization_defaultClientId_fkey') THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_defaultClientId_fkey" FOREIGN KEY ("defaultClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;