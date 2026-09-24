-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'partially_refunded';

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");
