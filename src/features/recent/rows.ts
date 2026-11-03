import type {
  AccountRecord,
  CategoryRecord,
  EntryPayload,
  OutboxRecord,
  TransactionRecord,
} from "../../db/schema";
import { isEditable, type PendingWrite } from "../../sync/outbox";
import type { Tab } from "../entry/entry";

// The list shows the cache of server transactions and the outbox as one: each entry is one row, with
// what the user last asked for and how far that got. Pure, so every rule is unit-tested.

export interface RecentData {
  transactions: TransactionRecord[];
  outbox: OutboxRecord[];
  accounts: AccountRecord[];
  categories: CategoryRecord[];
}

export type RowStatus = "pending" | "sending" | "retrying" | "failed";

/** What tapping and deleting a row do. */
export type RowTarget =
  /** Not on the server: `editPending` / `removePending`. */
  | { kind: "pending"; clientId: string; write: PendingWrite }
  /** `enqueueUpdate` / `enqueueDelete`; `values` include any queued update. */
  | { kind: "transaction"; transactionId: string; values: EntryPayload }
  /** Deleted leg by leg; edited in Sure, where a changed leg would no longer match its pair. */
  | { kind: "transfer"; transactionIds: string[] }
  /** One leg may already be in Sure, so it can only be dismissed (`discardFailed`). */
  | { kind: "failedTransfer"; clientId: string }
  /** May be on the server, but not in the cache yet: nothing to edit until the next pull. */
  | { kind: "locked"; reason: string };

export interface RecentRow {
  key: string;
  date: string;
  createdAt: number;
  name: string;
  detail: string;
  transfer: boolean;
  /** Decimal string, positive for money coming in; a transfer's is its unsigned amount. */
  amount: string;
  currency: string;
  status?: RowStatus;
  error?: string;
  target: RowTarget;
  /** Failed updates or deletes the user can drop, keeping the transaction as Sure has it. */
  discard: string[];
}

export interface RecentDay {
  date: string;
  rows: RecentRow[];
}

export const SENDING_REASON = "Sending to Sure. It can be changed once it has synced.";
export const UNPULLED_REASON = "Saved in Sure. It can be changed after the next sync.";
export const FAILED_TRANSFER_ERROR = "One leg of the transfer may already be in Sure.";

const LEG = /^(.+):(out|in)$/;

export function recentDays(data: RecentData): RecentDay[] {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const byExternalId = new Map(
    data.transactions.filter((t) => t.externalId).map((t) => [t.externalId!, t]),
  );
  const accountName = (id: string) => accounts.get(id)?.name ?? "";
  const rows: RecentRow[] = [];
  const shown = new Set<string>();

  // Creates and transfers this app sent or will send.
  for (const record of data.outbox) {
    if (record.op !== "create" && record.op !== "transfer") continue;
    const matched =
      record.op === "create"
        ? [byExternalId.get(record.clientId)]
        : [byExternalId.get(`${record.clientId}:out`), byExternalId.get(`${record.clientId}:in`)];
    const pulled = matched.filter((t) => t !== undefined);
    // Once sent and pulled, the server row stands for it.
    if (record.status === "done" && pulled.length > 0) continue;
    for (const t of pulled) shown.add(t.id);

    const target: RowTarget = isEditable(record)
      ? { kind: "pending", clientId: record.clientId, write: record }
      : record.status === "failed"
        ? { kind: "failedTransfer", clientId: record.clientId }
        : {
            kind: "locked",
            reason: record.status === "done" ? UNPULLED_REASON : SENDING_REASON,
          };
    const common = {
      key: record.clientId,
      date: record.payload.date,
      createdAt: record.createdAt,
      name: record.payload.name,
      currency: record.payload.currency,
      ...statusOf(record),
      target,
      discard: [],
    };
    if (record.op === "create") {
      rows.push({ ...common, ...entryFields(record.payload, accountName, categories) });
    } else {
      const { fromAccountId, toAccountId, amount } = record.payload;
      rows.push({
        ...common,
        detail: `${accountName(fromAccountId)} → ${accountName(toAccountId)}`,
        transfer: true,
        amount,
        ...(record.status === "failed" && {
          error: [record.lastError, FAILED_TRANSFER_ERROR].filter(Boolean).join(" "),
        }),
      });
    }
  }

  // The newest update or delete of each transaction decides what the row shows.
  const changes = new Map<string, OutboxRecord>();
  for (const record of data.outbox) {
    if (record.op !== "update" && record.op !== "delete") continue;
    const current = changes.get(record.payload.transactionId);
    if (!current || record.createdAt > current.createdAt) {
      changes.set(record.payload.transactionId, record);
    }
  }
  const hidden = (t: TransactionRecord) => {
    const change = changes.get(t.id);
    return change?.op === "delete" && change.status !== "failed";
  };
  const failed = (t: TransactionRecord) => {
    const change = changes.get(t.id);
    return change?.status === "failed" ? [change] : [];
  };

  const legs = new Map<string, TransactionRecord[]>();
  for (const t of data.transactions) {
    if (shown.has(t.id)) continue;
    const pair = t.transferId ?? LEG.exec(t.externalId ?? "")?.[1];
    if (pair) {
      legs.set(pair, [...(legs.get(pair) ?? []), t]);
      continue;
    }
    if (hidden(t)) continue;
    const change = changes.get(t.id);
    const values: EntryPayload =
      change?.op === "update"
        ? { ...change.payload.changes, accountId: t.accountId }
        : {
            accountId: t.accountId,
            date: t.date,
            amount: unsigned(t.amountDecimal),
            // Sure stores an outflow as positive.
            nature: t.amountDecimal.startsWith("-") ? "income" : "expense",
            currency: t.currency,
            name: t.name,
            notes: t.notes,
            categoryId: t.categoryId,
            merchantId: t.merchantId,
          };
    rows.push({
      key: t.id,
      date: values.date,
      createdAt: t.createdAt,
      name: values.name,
      currency: values.currency,
      ...entryFields(values, accountName, categories),
      ...(change && statusOf(change)),
      target: { kind: "transaction", transactionId: t.id, values },
      discard: failed(t).map((r) => r.clientId),
    });
  }

  for (const [pair, group] of legs) {
    if (group.some(hidden)) continue;
    // Sure stores the outflow leg as positive.
    const out = group.find((t) => !t.amountDecimal.startsWith("-"));
    const into = group.find((t) => t.amountDecimal.startsWith("-"));
    const lead = out ?? into!;
    const failedChanges = group.flatMap(failed);
    rows.push({
      key: pair,
      date: lead.date,
      createdAt: Math.max(...group.map((t) => t.createdAt)),
      name: lead.name,
      detail: [out, into].map((t) => (t ? accountName(t.accountId) : "?")).join(" → "),
      transfer: true,
      amount: unsigned(lead.amountDecimal),
      currency: lead.currency,
      ...(failedChanges[0] && statusOf(failedChanges[0])),
      target: { kind: "transfer", transactionIds: group.map((t) => t.id) },
      discard: failedChanges.map((r) => r.clientId),
    });
  }

  rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt - a.createdAt || b.key.localeCompare(a.key),
  );
  const days: RecentDay[] = [];
  for (const row of rows) {
    const day = days.at(-1);
    if (day?.date === row.date) day.rows.push(row);
    else days.push({ date: row.date, rows: [row] });
  }
  return days;
}

/** The entry form tab a row belongs to, judged by what the row shows. */
export function rowKind(row: RecentRow): Tab {
  if (row.transfer) return "transfer";
  return row.amount.startsWith("-") ? "expense" : "income";
}

export function ofKind(days: RecentDay[], kind: Tab): RecentDay[] {
  return days
    .map((day) => ({ ...day, rows: day.rows.filter((row) => rowKind(row) === kind) }))
    .filter((day) => day.rows.length > 0);
}

function statusOf(record: OutboxRecord): { status?: RowStatus; error?: string } {
  switch (record.status) {
    case "done":
      return {};
    case "sending":
      return { status: "sending" };
    case "failed":
      return { status: "failed", error: record.lastError ?? undefined };
    case "pending":
      // A pause leaves its error on a record it did not count as an attempt; the header says why.
      return record.attempts > 0
        ? { status: "retrying", error: record.lastError ?? undefined }
        : { status: "pending" };
  }
}

function entryFields(
  values: EntryPayload,
  accountName: (id: string) => string,
  categories: Map<string, CategoryRecord>,
) {
  const category = values.categoryId ? categories.get(values.categoryId)?.name : undefined;
  return {
    detail: [category, accountName(values.accountId)].filter(Boolean).join(" · "),
    transfer: false,
    amount: values.nature === "income" ? values.amount : `-${values.amount}`,
  };
}

function unsigned(decimal: string): string {
  return decimal.startsWith("-") ? decimal.slice(1) : decimal;
}
