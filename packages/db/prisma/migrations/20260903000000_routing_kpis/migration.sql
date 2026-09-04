-- Provider KPI columns on Quote and Transaction (Next-Gen Routing PRD §Monitoring).
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "simulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "fallbackFromQuoteId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "fallbackFromHop" INTEGER;

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3);