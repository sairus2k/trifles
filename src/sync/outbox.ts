import {
  db,
  type AccountRecord,
  type DeletePayload,
  type EntryPayload,
  type OutboxRecord,
  type TransferPayload,
  type UpdatePayload,
} from "../db/schema";
import { fromCents, toCents } from "../domain/money";

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

const writeListeners = new Set<() => void>();

/**
 * Calls `listener` after every committed write that has something to send, so the sync engine
 * sends it at once without depending on the UI to ask (outbox cannot import the engine, which
 * imports push). Returns the unsubscribe function.
 */
export function onOutboxWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

function notifyWrite() {
  for (const listener of writeListeners) listener();
}

export async function enqueue(write: PendingWrite): Promise<string> {
  const clientId = await db.transaction("rw", db.outbox, () => add(write));
  notifyWrite();
  return clientId;
}

export async function editPending(clientId: string, write: PendingWrite): Promise<void> {
  await db.transaction("rw", db.outbox, async () => {
    const record = await editable(clientId);
    await db.outbox.put({ ...record, ...write, ...QUEUED });
  });
  notifyWrite();
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

// Sure stores amounts with four fraction digits, so sums at this scale are exact for every currency.
const DELTA_SCALE = 4;

/**
 * Per cached account, what the outbox will still change in its `balanceCents`, as a decimal string
 * at scale 4: an expense lowers an asset and raises a liability. Creates and transfers count while
 * queued or sending, and once sent until Sure recalculates the account in its background job, seen
 * as `updatedAt` reaching `appliedAt` (both whole seconds on the server clock). A failed record adds
 * nothing: a create was rejected, and of a failed transfer it is unknown which leg reached Sure.
 * Updates and deletes add nothing either: a DELETE answer has no server time to compare with.
 */
export async function pendingDeltas(): Promise<Map<string, string>> {
  const [records, cached] = await Promise.all([db.outbox.toArray(), db.accounts.toArray()]);
  const accounts = new Map(cached.map((account) => [account.id, account]));
  const sums = new Map<string, number>();
  for (const record of records) {
    if (record.status === "failed") continue;
    const entries =
      record.op === "create"
        ? [record.payload]
        : record.op === "transfer"
          ? transferLegs(record.clientId, record.payload).map((leg) => leg.payload)
          : [];
    for (const { accountId, amount, nature } of entries) {
      const account = accounts.get(accountId);
      if (!account || isApplied(record, account)) continue;
      const outflow = toCents(amount, DELTA_SCALE) * (nature === "expense" ? 1 : -1);
      const delta = account.classification === "liability" ? outflow : -outflow;
      sums.set(accountId, (sums.get(accountId) ?? 0) + delta);
    }
  }
  return new Map(
    [...sums].filter(([, sum]) => sum !== 0).map(([id, sum]) => [id, fromCents(sum, DELTA_SCALE)]),
  );
}

function isApplied(record: OutboxRecord, account: AccountRecord): boolean {
  return record.status === "done" && account.updatedAt >= (record.appliedAt ?? 0);
}

// Strict creation order: only the oldest unfinished record is a candidate, so a head that is backing off
// or still sending holds the rest of the queue.
export function claimNext(): Promise<OutboxRecord | undefined> {
  return db.transaction("rw", db.outbox, async () => {
    const head = await queueHead();
    if (head?.status !== "pending" || head.nextAttemptAt > Date.now()) return undefined;
    const claimed: OutboxRecord = { ...head, status: "sending" };
    await db.outbox.put(claimed);
    return claimed;
  });
}

/** When the head of the queue is due again, if it is backing off. */
export async function headRetryAt(): Promise<number | undefined> {
  const head = await queueHead();
  return head?.status === "pending" && head.nextAttemptAt > Date.now()
    ? head.nextAttemptAt
    : undefined;
}

function queueHead(): Promise<OutboxRecord | undefined> {
  return db.outbox
    .orderBy("createdAt")
    .filter((r) => r.status === "pending" || r.status === "sending")
    .first();
}

/**
 * Puts records left `sending` back in the queue. Call it only while holding the sync lock: then no
 * push is running, so such a record was abandoned by a tab that closed or crashed mid-request. That
 * request may have reached Sure, so it counts as an attempt.
 */
export async function requeueStuck(): Promise<void> {
  await db.outbox
    .filter((r) => r.status === "sending")
    .modify((r) => {
      r.status = "pending";
      r.attempts++;
      r.nextAttemptAt = 0;
    });
}

/** Ends every backoff, for when the connection comes back: the failures were most likely offline. */
export async function retryNow(): Promise<void> {
  await db.outbox
    .filter((r) => r.status === "pending" && r.nextAttemptAt > 0)
    .modify({ nextAttemptAt: 0 });
}

export function markDone(clientId: string, appliedAt?: number): Promise<void> {
  return finishAttempt(clientId, { status: "done", lastError: null, appliedAt });
}

export function markFailed(clientId: string, error: string): Promise<void> {
  return finishAttempt(clientId, { status: "failed", lastError: error });
}

export function markRetry(clientId: string, error: string, nextAttemptAt: number): Promise<void> {
  return finishAttempt(clientId, { status: "pending", lastError: error, nextAttemptAt });
}

/**
 * Requeues a record stopped by a rejected key or missing settings. Sure applied nothing, so a create
 * keeps its attempt count and stays editable; a transfer counts it, since its first leg may have been
 * accepted before the second was rejected.
 */
export function markPaused(clientId: string, error: string): Promise<void> {
  return finishAttempt(
    clientId,
    { status: "pending", lastError: error, nextAttemptAt: Date.now() },
    (record) => record.op === "transfer",
  );
}

async function finishAttempt(
  clientId: string,
  changes: Pick<OutboxRecord, "status" | "lastError" | "appliedAt"> & { nextAttemptAt?: number },
  counts: (record: OutboxRecord) => boolean = () => true,
): Promise<void> {
  await db.transaction("rw", db.outbox, async () => {
    const record = await db.outbox.get(clientId);
    if (record?.status !== "sending") {
      throw new Error(`Outbox record ${clientId} is not being sent`);
    }
    const attempts = record.attempts + (counts(record) ? 1 : 0);
    await db.outbox.put({ ...record, ...changes, attempts });
  });
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
async function replaceQueued(write: SyncedWrite): Promise<string> {
  const clientId = await db.transaction("rw", db.outbox, async () => {
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
  notifyWrite();
  return clientId;
}
