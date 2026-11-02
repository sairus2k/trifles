import {
  deleteApiV1TransactionsId,
  getApiV1AccountsId,
  patchApiV1TransactionsId,
  postApiV1RecurringTransactions,
  postApiV1Transactions,
  type ErrorResponse,
  type PatchApiV1TransactionsIdBody,
  type PostApiV1RecurringTransactionsBody,
  type PostApiV1TransactionsBody,
} from "../api/generated/sure";
import { SureError } from "../api/http";
import type { EntryPayload, OutboxRecord, UpdatePayload } from "../db/schema";
import { claimNext, markDone, markFailed, markPaused, markRetry, transferLegs } from "./outbox";

const SOURCE = "sure-quick-entry";

const REQUEST_TIMEOUT_MS = 30_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;

const ACCOUNT_GONE = "The account is no longer in Sure or no longer shared with you.";
const ACCOUNT_READ_ONLY =
  "This account is read-only for you in Sure. Ask its owner for full control, or move the entry to another account.";

export interface PushResult {
  /** Records that reached `done` in this run. */
  sent: number;
  /** Stopped on 401, 403 or missing settings: no request will succeed until the settings change. */
  paused: boolean;
}

type Reply = { status: number; data: unknown; appliedAt?: number };

type Outcome =
  | { kind: "done"; appliedAt?: number }
  | { kind: "failed" | "paused" | "retry"; error: string };

/**
 * Sends the outbox to Sure one record at a time, in creation order, until the queue is empty, its
 * head is backing off, or the queue pauses. Run one worker at a time (TASK-10 holds a Web Lock).
 */
export async function push(): Promise<PushResult> {
  let sent = 0;
  for (let record = await claimNext(); record; record = await claimNext()) {
    let outcome: Outcome;
    try {
      outcome = await attempt(record);
    } catch (error) {
      // A bug must not leave the record `sending`: that would hold the queue for good.
      await markRetry(record.clientId, String(error), backoff(record.attempts));
      throw error;
    }
    switch (outcome.kind) {
      case "done":
        await markDone(record.clientId, outcome.appliedAt);
        sent++;
        break;
      case "failed":
        await markFailed(record.clientId, outcome.error);
        break;
      case "retry":
        await markRetry(record.clientId, outcome.error, backoff(record.attempts));
        break;
      case "paused":
        await markPaused(record.clientId, outcome.error);
        return { sent, paused: true };
    }
  }
  return { sent, paused: false };
}

async function attempt(record: OutboxRecord): Promise<Outcome> {
  let reply: Reply;
  try {
    reply = await send(record);
  } catch (error) {
    if (!(error instanceof SureError)) throw error;
    if (error.kind === "not-configured" || error.status === 401) {
      return { kind: "paused", error: error.message };
    }
    // 429, 5xx, network failures, timeouts and non-JSON answers may or may not have reached Sure;
    // a retry is safe because every create carries its external_id.
    return { kind: "retry", error: error.message };
  }
  if (isSuccess(reply)) return { kind: "done", appliedAt: reply.appliedAt };
  // A read-only key: every write would answer 403, so failing the records one by one would lose them.
  if (reply.status === 403) return { kind: "paused", error: serverMessage(reply) };
  // 422, and statuses the spec does not declare such as 404, are definitive answers.
  return { kind: "failed", error: serverMessage(reply) };
}

async function send(record: OutboxRecord): Promise<Reply> {
  switch (record.op) {
    case "create":
      return create(record.clientId, record.payload);
    case "transfer": {
      // Both legs go out on every attempt: Sure answers 200 for a leg it already has.
      const [out, into] = transferLegs(record.clientId, record.payload);
      const first = await create(out.externalId, out.payload);
      if (!isSuccess(first)) return first;
      const second = await create(into.externalId, into.payload);
      // Both accounts are recalculated after the :out leg, so its time serves the transfer.
      return { ...second, appliedAt: first.appliedAt };
    }
    case "update":
      return patchApiV1TransactionsId(
        record.payload.transactionId,
        updateBody(record.payload.changes),
        timeout(),
      );
    case "delete": {
      const reply = await deleteApiV1TransactionsId(record.payload.transactionId, timeout());
      // A retry after a lost response finds the transaction already gone.
      return reply.status === 404 ? { status: 200, data: reply.data } : reply;
    }
  }
}

// A repeated external_id answers 200 with the original transaction, so `created_at` is when Sure
// first applied the write.
async function create(externalId: string, entry: EntryPayload): Promise<Reply> {
  let reply;
  try {
    reply = await postApiV1Transactions(createBody(externalId, entry), timeout());
  } catch (error) {
    if (error instanceof SureError && error.status === 500) {
      const reason = await refusal(entry);
      if (reason) return { status: 404, data: { error: "not_found", message: reason } };
    }
    throw error;
  }
  if (reply.status === 422) return reply;
  return { ...reply, appliedAt: Date.parse(reply.data.created_at) };
}

// Sure answers a create for an account the key cannot write with the same 500 as any other failure:
// `create` rescues the RecordNotFound itself. Retrying would hold the queue for good, so a 500 asks
// whether the account is still there and, if it is, whether the key's user may write to it: Sure
// lists and finds every account shared with the user, but writes only to an owned one or a
// `full_control` share, and no answer carries the permission. Returns why Sure refused the create,
// or nothing to retry it. A failed request leaves the 500 to be retried: even a 401 must not pause
// the record, since a pause keeps a create editable and the 500 may follow a saved entry.
async function refusal({ accountId, currency }: EntryPayload): Promise<string | undefined> {
  try {
    const account = await getApiV1AccountsId(accountId, { include_disabled: true }, timeout());
    if (account.status === 404) return ACCOUNT_GONE;
    const probe = await postApiV1RecurringTransactions(writeProbe(accountId, currency), timeout());
    return probe.status === 404 ? ACCOUNT_READ_ONLY : undefined;
  } catch (error) {
    if (error instanceof SureError) return undefined;
    throw error;
  }
}

// A recurring transaction create resolves its account with the same `writable_by` scope as a
// transaction create, before it checks anything else: 404 without write access, and with it 422
// for the blank dates, which fail it before it saves. The day of 0 fails the model validation too,
// should a later Sure stop checking the dates. The contract suite pins both answers.
function writeProbe(accountId: string, currency: string): PostApiV1RecurringTransactionsBody {
  return {
    recurring_transaction: {
      account_id: accountId,
      name: SOURCE,
      amount: 0,
      currency,
      expected_day_of_month: 0,
      last_occurrence_date: "",
      next_expected_date: "",
    },
  };
}

function createBody(externalId: string, entry: EntryPayload): PostApiV1TransactionsBody {
  return {
    transaction: {
      account_id: entry.accountId,
      date: entry.date,
      amount: toNumber(entry.amount),
      nature: entry.nature,
      currency: entry.currency,
      name: entry.name,
      notes: entry.notes ?? undefined,
      category_id: entry.categoryId ?? undefined,
      merchant_id: entry.merchantId ?? undefined,
      external_id: externalId,
      source: SOURCE,
    },
  };
}

// Sure's update ignores null fields and blank category or merchant ids, so neither can be cleared;
// notes clear with an empty string.
function updateBody(changes: UpdatePayload["changes"]): PatchApiV1TransactionsIdBody {
  return {
    transaction: {
      date: changes.date,
      amount: toNumber(changes.amount),
      nature: changes.nature,
      currency: changes.currency,
      name: changes.name,
      notes: changes.notes ?? "",
      category_id: changes.categoryId ?? undefined,
      merchant_id: changes.merchantId ?? undefined,
    },
  };
}

// The spec types `amount` as a number and Sure reads it with `to_f`. A decimal string of up to 15
// significant digits converts to a double that serialises back to the same digits.
function toNumber(amount: string): number {
  return Number(amount);
}

function timeout(): RequestInit {
  return { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
}

function isSuccess(reply: Reply): boolean {
  return reply.status >= 200 && reply.status < 300;
}

// Equal jitter: half of the delay is fixed so a retry never fires at once, half is random so devices
// and tabs that failed together spread out.
function backoff(attempts: number): number {
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempts);
  return Math.round(Date.now() + delay / 2 + (Math.random() * delay) / 2);
}

// Sure's 422 puts the specific reasons in `errors` and a generic summary in `message`.
function serverMessage({ status, data }: Reply): string {
  const { errors, message, error } = (data ?? {}) as Partial<ErrorResponse>;
  if (errors?.length) return errors.join("; ");
  return message || error || `Sure answered ${status}`;
}
