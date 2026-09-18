/*
  Warnings:

  - You are about to drop the column `bankAccountRef` on the `vendor_profiles` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `payouts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayoutStatus" ADD VALUE 'requested';
ALTER TYPE "PayoutStatus" ADD VALUE 'rejected';

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "vendor_profiles" DROP COLUMN "bankAccountRef",
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankCode" TEXT;
