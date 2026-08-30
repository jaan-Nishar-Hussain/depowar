-- Store the destination balance observed when a quote is created. This lets
-- the worker prove that a real bridge increased the recipient's balance after
-- the source transaction instead of treating source confirmation as settlement.
ALTER TABLE "Quote" ADD COLUMN "settlementBaseline" DECIMAL(78,0);
