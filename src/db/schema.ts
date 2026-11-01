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
  /** Ours for entries sent by this app: `clientId`, or `<clientId>:out` / `<clientId>:in`. */
  externalId: string | null;
  /** Sure's `created_at`, in whole seconds: orders transactions within a day as Sure lists them. */
  createdAt: number;
  /** Shared by both legs once Sure has paired them into a transfer. */
  transferId: string | null;
}

export interface SuggestionRecord {
  merchantName: string;
  merchantId: string;
  categoryId: string;
  count: number;
  lastUsedAt: number;
}

// `amount` is the calculator's positive decimal string; `nature` carries the sign.
export interface EntryPayload {
  accountId: string;
  date: string;
  amount: string;
  nature: "expense" | "income";
  currency: string;
  name: string;
  notes: string | null;
  categoryId: string | null;
  merchantId: string | null;
}

// One currency for both accounts: cross-currency transfers are out of v1.
export interface TransferPayload {
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: string;
  currency: string;
  name: string;
  notes: string | null;
}

// PATCH /transactions/{id} takes no account_id, so an update cannot move a transaction to another account.
export interface UpdatePayload {
  transactionId: string;
  changes: Omit<EntryPayload, "accountId">;
}

export interface DeletePayload {
  transactionId: string;
}

export type OutboxStatus = "pending" | "sending" | "failed" | "done";

export type OutboxRecord = {
  clientId: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
  /**
   * When Sure applied a sent create or transfer: the transaction's `created_at`, on the server clock
   * and in whole seconds like the account's `updated_at` it is compared with.
   */
  appliedAt?: number;
} & (
  | { op: "create"; payload: EntryPayload }
  | { op: "transfer"; payload: TransferPayload }
  | { op: "update"; payload: UpdatePayload }
  | { op: "delete"; payload: DeletePayload }
);

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
