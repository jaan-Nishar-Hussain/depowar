-- Route-decision audit trail + audit-log request context (Next-Gen Routing PRD
-- §Monitoring, §Security).
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "score" DOUBLE PRECISION;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "alternatesSnapshot" JSONB;

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ip" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
