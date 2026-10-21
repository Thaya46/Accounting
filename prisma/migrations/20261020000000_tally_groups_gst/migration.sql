-- Tally-style ledger groups, bill-wise allocations, party ledgers and GST fields
-- on vouchers. Generated from schema.prisma (prisma migrate diff); additive only.

-- CreateEnum
CREATE TYPE "BillAllocationType" AS ENUM ('NEW_REF', 'AGST_REF', 'ADVANCE', 'ON_ACCOUNT');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "address" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "partyType" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "cgstAmount" DECIMAL(18,2),
ADD COLUMN     "gstRate" DECIMAL(5,2),
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "igstAmount" DECIMAL(18,2),
ADD COLUMN     "invoiceDate" DATE,
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "partyLedgerId" TEXT,
ADD COLUMN     "sgstAmount" DECIMAL(18,2),
ADD COLUMN     "taxableAmount" DECIMAL(18,2),
ADD COLUMN     "voucherType" TEXT;

-- CreateTable
CREATE TABLE "account_groups" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentGroupId" TEXT,
    "nature" "AccountType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "affectsGrossProfit" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_allocations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "BillAllocationType" NOT NULL DEFAULT 'NEW_REF',
    "refNo" TEXT NOT NULL,
    "dueDate" DATE,
    "amount" DECIMAL(18,2) NOT NULL,
    "pendingAmount" DECIMAL(18,2) NOT NULL,
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_groups_workspaceId_parentGroupId_idx" ON "account_groups"("workspaceId", "parentGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "account_groups_workspaceId_name_key" ON "account_groups"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "bill_allocations_workspaceId_accountId_isSettled_idx" ON "bill_allocations"("workspaceId", "accountId", "isSettled");

-- CreateIndex
CREATE INDEX "bill_allocations_workspaceId_refNo_idx" ON "bill_allocations"("workspaceId", "refNo");

-- CreateIndex
CREATE INDEX "accounts_workspaceId_groupId_idx" ON "accounts"("workspaceId", "groupId");

-- AddForeignKey
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "account_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "account_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_partyLedgerId_fkey" FOREIGN KEY ("partyLedgerId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

