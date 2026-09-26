-- CreateTable
CREATE TABLE "rider_cash_remittances" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_cash_remittances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rider_cash_remittances_riderId_idx" ON "rider_cash_remittances"("riderId");

-- AddForeignKey
ALTER TABLE "rider_cash_remittances" ADD CONSTRAINT "rider_cash_remittances_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "rider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
