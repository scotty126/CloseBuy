-- AlterTable
ALTER TABLE "vendor_profiles" ADD COLUMN "avgDeliveryMinutes" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN "isQuickBuy" BOOLEAN NOT NULL DEFAULT false;
