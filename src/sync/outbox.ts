import {
  db,
  type DeletePayload,
  type EntryPayload,
  type OutboxRecord,
  type TransferPayload,
  type UpdatePayload,
} from "../db/schema";

// The outbox is the optimistic layer: every write lands here first and the UI reads it back.

export type PendingWrite =
  | { op: "create"; payload: EntryPayload }
  | { op: "transfer"; payload: TransferPayload };

type SyncedWrite =
  | { op: "update"; payload: UpdatePayload }
  | { op: "delete"; payload: DeletePayload };

const QUEUED = { status: "pending", attempts: 0, nextAttemptAt: 0, lastError: null } as const;

// A write that may have reached Sure cannot change: a retry with the same external_id answers 200 with
// the old values, and a different account creates a second transaction (the key is scoped to the account).
export class OutboxLockedError extends Error {
  constructor(readonly clientId: string) {
    super(`Outbox record ${clientId} may already be on the server and cannot be changed`);
    this.name = "OutboxLockedError";
  }
}

export function enqueue(write: PendingWrite): Promise<string> {
  return db.transaction("rw", db.outbox, () => add(write));
}

export async function editPending(clientId: string, write: PendingWrite): Promise<void> {
  await db.transaction("rw", db.outbox, async () => {
    const record = await editable(clientId);
    await db.outbox.put({ ...record, ...write, ...QUEUED });
  });
}

export async function removePending(clientId: string): Promise<void> {
  await db.transaction("rw", db.outbox, async () => {
    await editable(clientId);
    await db.outbox.delete(clientId);
  });
}

export function enqueueUpdate(transactionId: string, changes: UpdatePayload["changes"]) {
  return replaceQueued({ op: "update", payload: { transactionId, changes } });
}

export function enqueueDelete(transactionId: string) {
  return replaceQueued({ op: "delete", payload: { transactionId } });
}

export interface TransferLeg {
  externalId: string;
  payload: EntryPayload;
}

// Sure cannot create a transfer, so it goes out as two transactions that Sure auto-matches
// (README → Transfers). Each leg has its own external_id, so a half-sent transfer resumes safely.
export function transferLegs(
  clientId: string,
  transfer: TransferPayload,
): [TransferLeg, TransferLeg] {
  const { fromAccountId, toAccountId, ...shared } = transfer;
  const leg = (accountId: string, nature: EntryPayload["nature"]): EntryPayload => ({
    ...shared,
    accountId,
    nature,
    categoryId: null,
    merchantId: null,
  });
  return [
    { externalId: `${clientId}:out`, payload: leg(fromAccountId, "expense") },
    { externalId: `${clientId}:in`, payload: leg(toAccountId, "income") },
  ];
}

// Call inside a rw transaction on db.outbox.
async function add(write: PendingWrite | SyncedWrite): Promise<string> {
  const last = await db.outbox.orderBy("createdAt").last();
  // Strictly increasing, so two writes in the same millisecond keep their order.
  const createdAt = Math.max(Date.now(), (last?.createdAt ?? 0) + 1);
  const clientId = crypto.randomUUID();
  await db.outbox.add({ clientId, ...write, ...QUEUED, createdAt });
  return clientId;
}

// Editable only while the write certainly is not on the server: never attempted, or a single create
// rejected for good (422/404). A failed transfer may have one leg on the server already.
async function editable(clientId: string): Promise<OutboxRecord> {
  const record = await db.outbox.get(clientId);
  const untouched =
    record?.status === "pending" &&
    record.attempts === 0 &&
    (record.op === "create" || record.op === "transfer");
  const rejected = record?.status === "failed" && record.op === "create";
  if (!record || !(untouched || rejected)) throw new OutboxLockedError(clientId);
  return record;
}

// A full-value PATCH and a DELETE are idempotent, so a queued operation on the same transaction is
// overwritten whatever its attempts; only one in flight keeps its place and gets a successor.
function replaceQueued(write: SyncedWrite): Promise<string> {
  return db.transaction("rw", db.outbox, async () => {
    const queued = await db.outbox
      .filter(
        (r) =>
          (r.op === "update" || r.op === "delete") &&
          r.payload.transactionId === write.payload.transactionId &&
          (r.status === "pending" || r.status === "failed"),
      )
      .first();
    if (!queued) return add(write);
    await db.outbox.put({ ...queued, ...write, ...QUEUED });
    return queued.clientId;
  });
}
