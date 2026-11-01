import Dexie, { type EntityTable } from "dexie";
import type { AccountDetailStatus } from "../api/generated/sure";

// Local cache and outbox. Field shapes are camelCase records, not raw API responses; timestamps are
// epoch milliseconds so they compare and sort as numbers. Transaction dates stay local YYYY-MM-DD.

export interface AccountRecord {
  id: string;
  name: string;
  currency: string;
  classification: "asset" | "liability";
  balanceCents: number;
  status: AccountDetailStatus;
  updatedAt: number;
}

// Sure dropped category classification; the API no longer returns it.
export interface CategoryRecord {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface MerchantRecord {
  id: string;
  name: string;
}

export interface TransactionRecord {
  id: string;
  accountId: string;
  date: string;
  name: string;
  amountDecimal: string;
  currency: string;
  categoryId: string | null;
  merchantId: string | null;
  notes: string | null;
}

export interface SuggestionRecord {
  merchantName: string;
  merchantId: string;
  categoryId: string;
  count: number;
  lastUsedAt: number;
}

export type OutboxOp = "create" | "transfer" | "update" | "delete";
export type OutboxStatus = "pending" | "sending" | "failed" | "done";

export interface OutboxRecord {
  clientId: string;
  op: OutboxOp;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
}

export interface MetaRecord {
  key: string;
  value: string | number;
}

export const db = new Dexie("sure-quick-entry") as Dexie & {
  accounts: EntityTable<AccountRecord, "id">;
  categories: EntityTable<CategoryRecord, "id">;
  merchants: EntityTable<MerchantRecord, "id">;
  transactions: EntityTable<TransactionRecord, "id">;
  suggestions: EntityTable<SuggestionRecord, "merchantName">;
  outbox: EntityTable<OutboxRecord, "clientId">;
  meta: EntityTable<MetaRecord, "key">;
};

db.version(1).stores({
  accounts: "id",
  categories: "id",
  merchants: "id",
  transactions: "id, date, accountId",
  suggestions: "merchantName",
  outbox: "clientId",
  meta: "key",
});

// clientId is a random UUID, so queue order comes from createdAt.
db.version(2).stores({ outbox: "clientId, createdAt" });
