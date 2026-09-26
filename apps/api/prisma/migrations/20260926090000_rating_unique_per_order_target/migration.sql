-- CreateIndex
CREATE UNIQUE INDEX "ratings_orderId_targetType_key" ON "ratings"("orderId", "targetType");
