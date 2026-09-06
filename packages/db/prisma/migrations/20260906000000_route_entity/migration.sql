-- Normalized Route entity (Next-Gen Routing PRD §Data Model): the steps a
-- quote executes plus a summary of the providers involved. Quote owns the FK
-- (`Quote.routeId`), matching the PRD's `Quote.routeId FK` field.
CREATE TABLE IF NOT EXISTS "Route" (
    "id" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "providerChain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- Quote gains an optional routeId (nullable so legacy/test quotes remain valid).
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "routeId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Quote_routeId_key" ON "Quote"("routeId");

ALTER TABLE "Quote"
    ADD CONSTRAINT "Quote_routeId_fkey"
    FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;