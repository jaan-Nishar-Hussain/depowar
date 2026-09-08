-- Project-first refactor (PRD §Onboarding): the Project becomes the scoping
-- unit for API keys, recipients, deposits, webhooks and events. The hidden
-- Client layer is removed entirely.
--
-- 1. Add `projectId` to every client-scoped table.
-- 2. Backfill it from the Project.clientId / Project.liveClientId mapping.
-- 3. Orphan clients (no project) get a Project (their org's default client,
--    else a "Legacy" org) so no existing data is dropped silently.
-- 4. Drop Client and the clientId columns.

CREATE TEMP TABLE _client_proj AS
SELECT c.id AS cid, p.id AS pid
FROM "Client" c
JOIN "Project" p ON (p."clientId" = c.id OR p."liveClientId" = c.id);

DO $$
DECLARE c RECORD; newpid TEXT; orgid TEXT;
BEGIN
  FOR c IN SELECT * FROM "Client" WHERE id NOT IN (SELECT cid FROM _client_proj) LOOP
    orgid := NULL;
    SELECT o.id INTO orgid FROM "Organization" o WHERE o."defaultClientId" = c.id LIMIT 1;
    IF orgid IS NULL THEN
      INSERT INTO "Organization" ("id", "name", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'Legacy', NOW(), NOW()) RETURNING id INTO orgid;
    END IF;
    INSERT INTO "Project" ("id", "organizationId", "name", "environment", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, orgid, c.name, 'TEST', NOW(), NOW()) RETURNING id INTO newpid;
    INSERT INTO _client_proj (cid, pid) VALUES (c.id, newpid);
  END LOOP;
END $$;

ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "Recipient" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "DepositIntent" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "AnalyticsDaily" ADD COLUMN IF NOT EXISTS "projectId" TEXT;

UPDATE "ApiKey" a SET "projectId" = cp.pid FROM _client_proj cp WHERE cp.cid = a."clientId";
UPDATE "Recipient" r SET "projectId" = cp.pid FROM _client_proj cp WHERE cp.cid = r."clientId";
UPDATE "DepositIntent" d SET "projectId" = cp.pid FROM _client_proj cp WHERE cp.cid = d."clientId";
UPDATE "WebhookSubscription" w SET "projectId" = cp.pid FROM _client_proj cp WHERE cp.cid = w."clientId";
UPDATE "Event" e SET "projectId" = cp.pid FROM _client_proj cp WHERE cp.cid = e."clientId";
UPDATE "AuditLog" al SET "projectId" = cp.pid FROM _client_proj cp WHERE cp.cid = al."clientId";
UPDATE "AnalyticsDaily" ad SET "projectId" = cp.pid FROM _client_proj cp WHERE cp.cid = ad."clientId";

-- Drop any rows that could not be mapped (no client reference at all).
DELETE FROM "ApiKey" WHERE "projectId" IS NULL;
DELETE FROM "Recipient" WHERE "projectId" IS NULL;
DELETE FROM "DepositIntent" WHERE "projectId" IS NULL;
DELETE FROM "WebhookSubscription" WHERE "projectId" IS NULL;
DELETE FROM "Event" WHERE "projectId" IS NULL;
DELETE FROM "AnalyticsDaily" WHERE "projectId" IS NULL;

-- Normalize Project.environment to TEST|LIVE.
UPDATE "Project" SET "environment" = 'TEST' WHERE "environment" NOT IN ('TEST', 'LIVE');

-- Make projectId required + add FKs and indexes.
ALTER TABLE "ApiKey" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Recipient" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "DepositIntent" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "WebhookSubscription" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "projectId" SET NOT NULL;

ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepositIntent" ADD CONSTRAINT "DepositIntent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ApiKey_projectId_enabled_idx" ON "ApiKey"("projectId", "enabled");
CREATE INDEX IF NOT EXISTS "Project_organizationId_environment_idx" ON "Project"("organizationId", "environment");
CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsDaily_projectId_day_key" ON "AnalyticsDaily"("projectId", "day");

-- Remove the old Client layer.
ALTER TABLE "ApiKey" DROP COLUMN IF EXISTS "clientId";
ALTER TABLE "Recipient" DROP COLUMN IF EXISTS "clientId";
ALTER TABLE "DepositIntent" DROP COLUMN IF EXISTS "clientId";
ALTER TABLE "WebhookSubscription" DROP COLUMN IF EXISTS "clientId";
ALTER TABLE "Event" DROP COLUMN IF EXISTS "clientId";
ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "clientId";
ALTER TABLE "AnalyticsDaily" DROP COLUMN IF EXISTS "clientId";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "clientId";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "liveClientId";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "defaultClientId";
DROP TABLE IF EXISTS "Client";

DROP TABLE IF EXISTS _client_proj;