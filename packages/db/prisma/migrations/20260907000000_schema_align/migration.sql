-- Schema alignment catch-up (PRD §Data Model).
--
-- The committed migration history predates the tenancy/productization work
-- (Client.environment, ApiKey.keyPrefix/name/environment/expiresAt/revokedAt,
-- Recipient.amlStatus, SettlementConfig versioning, and the Organization /
-- Membership / Project / IdempotencyRecord / WebhookDelivery / AnalyticsDaily
-- tables). A fresh `prisma migrate deploy` therefore produced a schema that
-- did not match the generated client. This migration is fully idempotent and
-- brings any fresh database up to the schema in prisma/schema.prisma; on
-- databases that already carry these columns it is a no-op.

-- --- Columns added to existing tables ---
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'TEST';

ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "keyPrefix" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'TEST';
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);

ALTER TABLE "Recipient" ADD COLUMN IF NOT EXISTS "amlStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW';

ALTER TABLE "SettlementConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SettlementConfig" ADD COLUMN IF NOT EXISTS "changeReason" TEXT;
ALTER TABLE "SettlementConfig" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
ALTER TABLE "SettlementConfig" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ApiKey_clientId_enabled_idx" ON "ApiKey"("clientId", "enabled");

-- --- Tables introduced by tenancy/productization ---
CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'DEVELOPER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'DEVELOPMENT',
    "clientId" TEXT NOT NULL,
    "liveClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "organizationId" TEXT,
    "projectId" TEXT,
    "operation" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "responseCode" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AnalyticsDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "deposits" INTEGER NOT NULL DEFAULT 0,
    "settled" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "volume" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "settledVolume" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- --- Constraints, indexes and uniques (guarded so they are safe to re-run) ---
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId");
CREATE INDEX IF NOT EXISTS "Membership_userId_status_idx" ON "Membership"("userId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Project_clientId_key" ON "Project"("clientId");
CREATE UNIQUE INDEX IF NOT EXISTS "Project_liveClientId_key" ON "Project"("liveClientId");
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_key_operation_key" ON "IdempotencyRecord"("key", "operation");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsDaily_projectId_clientId_day_key" ON "AnalyticsDaily"("projectId", "clientId", "day");
CREATE INDEX IF NOT EXISTS "AnalyticsDaily_organizationId_projectId_day_idx" ON "AnalyticsDaily"("organizationId", "projectId", "day");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Organization_ownerId_fkey') THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Membership_organizationId_fkey') THEN
    ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Membership_userId_fkey') THEN
    ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Project_organizationId_fkey') THEN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Project_clientId_fkey') THEN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Project_liveClientId_fkey') THEN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_liveClientId_fkey" FOREIGN KEY ("liveClientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='WebhookDelivery_subscriptionId_fkey') THEN
    ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;