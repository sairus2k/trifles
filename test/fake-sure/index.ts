import { faker } from "@faker-js/faker";
import { delay, http, HttpResponse, type HttpHandler } from "msw";
import type {
  AccountDetail,
  ErrorResponse,
  PatchApiV1TransactionsIdBody,
  PostApiV1TransactionsBody,
  Transaction,
} from "../../src/api/generated/sure";
import { toCents } from "../../src/domain/money";
import { FAMILY_CURRENCY, defaultSeed, formatMoney, type FakeSureSeed } from "./seed";

// A stateful stand-in for the Sure API, mirroring Sure 131e786 (see spec/README.md) closely enough
// for the sync engine: idempotent creates, account balances that move after a write, and failures a
// test can schedule. Entry validation (missing name, bad date…) is not modelled; schedule a 422.

export { FAMILY_CURRENCY, defaultSeed, type FakeSureSeed } from "./seed";

export const FAKE_SURE_URL = "https://sure.test";

export type FakeSureRoute =
  | "GET /api/v1/accounts"
  | "GET /api/v1/categories"
  | "GET /api/v1/merchants"
  | "GET /api/v1/transactions"
  | "POST /api/v1/transactions"
  | "PATCH /api/v1/transactions/:id"
  | "DELETE /api/v1/transactions/:id";

/**
 * - `{ status }`: answer with that status (and a Sure-like error body) without touching state.
 * - `"drop"`: the connection fails before the server sees the request's effect.
 * - `"lose-response"`: the server applies the request, then the connection fails.
 * - `"hang"`: the server never answers, for client timeouts.
 */
export type FakeSureFault =
  | { status: number; body?: ErrorResponse }
  | "drop"
  | "lose-response"
  | "hang";

export interface FakeSureRequest {
  method: string;
  /** Path plus query string. */
  path: string;
  body: unknown;
}

export type FakeSure = ReturnType<typeof createFakeSure>;

const ERROR_BODIES: Record<number, ErrorResponse> = {
  401: { error: "unauthorized", message: "Access token is invalid or expired" },
  404: { error: "record_not_found", message: "The requested resource was not found" },
  422: { error: "validation_failed", message: "Transaction could not be created", errors: [] },
};
// Sure's TransactionLookup, used by show/update/destroy, renders its own body instead of BaseController's.
const TRANSACTION_NOT_FOUND: ErrorResponse = {
  error: "not_found",
  message: "Transaction not found",
};
const INTERNAL_ERROR: ErrorResponse = {
  error: "internal_server_error",
  message: "An unexpected error occurred",
};

function validationFailed(message: string) {
  return HttpResponse.json(
    { error: "validation_failed", message, errors: [message] },
    { status: 422 },
  );
}

/** Rails `Time#iso8601`: UTC, whole seconds. */
function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Sure stores amounts as decimal(19,4) and renders them with `BigDecimal#to_s("F")`. */
function storedDecimal(amount: number) {
  const [int, frac = ""] = amount.toFixed(4).split(".");
  return `${int}.${frac.replace(/0+$/, "") || "0"}`;
}

function signedAmount(amount: number, nature: string | undefined) {
  switch (nature?.toLowerCase()) {
    case "income":
    case "inflow":
      return -Math.abs(amount);
    case "expense":
    case "outflow":
      return Math.abs(amount);
    default:
      return amount;
  }
}

/** Sure's `safe_per_page_param` and pagy's page metadata. */
function paginate<T>(items: T[], url: URL) {
  const requested = Number.parseInt(url.searchParams.get("per_page") ?? "", 10);
  const perPage = requested >= 1 ? Math.min(requested, 100) : 25;
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "", 10) || 1, 1);
  return {
    items: items.slice((page - 1) * perPage, page * perPage),
    pagination: {
      page,
      per_page: perPage,
      total_count: items.length,
      total_pages: Math.max(Math.ceil(items.length / perPage), 1),
    },
  };
}

function byName<T extends { name: string }>(items: T[]) {
  return items.toSorted((a, b) => a.name.localeCompare(b.name));
}

export function createFakeSure(seed: Partial<FakeSureSeed> = {}) {
  const state = structuredClone({ ...defaultSeed(), ...seed });
  const faults = new Map<FakeSureRoute, FakeSureFault[]>();
  const requests: FakeSureRequest[] = [];
  let accountSyncPaused = false;
  let pendingAccountSync: { account: AccountDetail; cents: number }[] = [];

  // Sure recalculates balances in a background job; `pauseAccountSync` lets a test observe the
  // stale balance a client sees right after a write.
  function syncAccount(account: AccountDetail, cents: number) {
    // An expense (positive amount) lowers an asset and raises a liability. Seeded currencies all
    // have two minor digits.
    account.balance_cents += account.classification === "liability" ? cents : -cents;
    account.cash_balance_cents = account.balance_cents;
    account.balance = formatMoney(account.balance_cents / 100, account.currency);
    account.cash_balance = account.balance;
    account.updated_at = now();
  }

  function moveBalance(accountId: string, cents: number) {
    const account = state.accounts.find((a) => a.id === accountId)!;
    if (accountSyncPaused) pendingAccountSync.push({ account, cents });
    else syncAccount(account, cents);
  }

  function createTransaction(body: unknown) {
    const tx = (body as Partial<PostApiV1TransactionsBody> | undefined)?.transaction;
    if (!tx?.account_id) return validationFailed("Account ID is required");
    const externalId = tx.external_id || undefined;
    if (tx.source && !externalId) return validationFailed("Source requires external_id");

    // Sure's `create` rescues every StandardError itself, so the RecordNotFound from an unknown or
    // read-only account becomes a 500 before BaseController's rescue_from could make it a 404.
    const account = state.accounts.find((a) => a.id === tx.account_id);
    if (!account) return HttpResponse.json(INTERNAL_ERROR, { status: 500 });

    const source = tx.source || "api";
    if (externalId) {
      const existing = state.transactions.find(
        (t) => t.account.id === account.id && t.external_id === externalId && t.source === source,
      );
      if (existing) return HttpResponse.json(existing, { status: 200 });
    }

    const amount = signedAmount(tx.amount, tx.nature);
    const currency = tx.currency || FAMILY_CURRENCY;
    const category = state.categories.find((c) => c.id === tx.category_id);
    const merchant = state.merchants.find((m) => m.id === tx.merchant_id);
    const timestamp = now();
    const transaction: Transaction = {
      id: faker.string.uuid(),
      entry_id: faker.string.uuid(),
      date: tx.date,
      amount: formatMoney(amount, currency),
      amount_decimal: storedDecimal(amount),
      currency,
      name: tx.name || tx.description || "",
      notes: tx.notes ?? null,
      external_id: externalId ?? null,
      source: externalId ? source : null,
      user_modified: tx.user_modified ?? false,
      classification: amount < 0 ? "income" : "expense",
      kind: "standard",
      excluded: false,
      split_parent: false,
      account: { id: account.id, name: account.name, account_type: account.account_type },
      category: category
        ? { id: category.id, name: category.name, color: category.color, icon: category.icon }
        : null,
      merchant: merchant ? { id: merchant.id, name: merchant.name } : null,
      tags: [],
      transfer: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    state.transactions.push(transaction);

    moveBalance(account.id, toCents(transaction.amount_decimal, 2));

    return HttpResponse.json(transaction, { status: 201 });
  }

  // Sure's `entry_params_for_update`: nil fields are kept (`compact`), so is a blank category or
  // merchant (`compact_blank`), and `currency` is ignored. A new amount is signed by `nature`.
  function updateTransaction(id: string, body: unknown) {
    const transaction = state.transactions.find((t) => t.id === id);
    if (!transaction) return HttpResponse.json(TRANSACTION_NOT_FOUND, { status: 404 });
    const tx = (body as PatchApiV1TransactionsIdBody | undefined)?.transaction ?? {};

    const name = tx.name ?? tx.description;
    if (name != null) transaction.name = name;
    if (tx.date != null) transaction.date = tx.date;
    if (tx.notes != null) transaction.notes = tx.notes;
    const category = tx.category_id && state.categories.find((c) => c.id === tx.category_id);
    if (category) {
      const { id, name, color, icon } = category;
      transaction.category = { id, name, color, icon };
    }
    const merchant = tx.merchant_id && state.merchants.find((m) => m.id === tx.merchant_id);
    if (merchant) transaction.merchant = { id: merchant.id, name: merchant.name };
    if (tx.amount != null) {
      const before = toCents(transaction.amount_decimal, 2);
      const amount = signedAmount(tx.amount, tx.nature);
      transaction.amount = formatMoney(amount, transaction.currency);
      transaction.amount_decimal = storedDecimal(amount);
      transaction.classification = amount < 0 ? "income" : "expense";
      moveBalance(transaction.account.id, toCents(transaction.amount_decimal, 2) - before);
    }
    transaction.updated_at = now();
    return HttpResponse.json(transaction);
  }

  function deleteTransaction(id: string) {
    const index = state.transactions.findIndex((t) => t.id === id);
    if (index === -1) return HttpResponse.json(TRANSACTION_NOT_FOUND, { status: 404 });
    const [transaction] = state.transactions.splice(index, 1);
    moveBalance(transaction!.account.id, -toCents(transaction!.amount_decimal, 2));
    return HttpResponse.json({ message: "Transaction deleted successfully" });
  }

  function listTransactions(url: URL) {
    // Newest date first; Sure breaks ties by created_at with sub-second precision, for which
    // insertion order stands in.
    const ordered = state.transactions
      .map((t, index) => ({ t, index }))
      .toSorted((a, b) => b.t.date.localeCompare(a.t.date) || b.index - a.index)
      .map(({ t }) => t);
    const { items, pagination } = paginate(ordered, url);
    return HttpResponse.json({ transactions: items, pagination });
  }

  const resolvers: Record<
    FakeSureRoute,
    (url: URL, body: unknown, params: Record<string, string>) => Response
  > = {
    "GET /api/v1/accounts": (url) => {
      const { items, pagination } = paginate(byName(state.accounts), url);
      return HttpResponse.json({ accounts: items, pagination });
    },
    "GET /api/v1/categories": (url) => {
      const { items, pagination } = paginate(byName(state.categories), url);
      return HttpResponse.json({ categories: items, pagination });
    },
    // Sure answers merchants as a bare, unpaginated array.
    "GET /api/v1/merchants": () => HttpResponse.json(byName(state.merchants)),
    "GET /api/v1/transactions": (url) => listTransactions(url),
    "POST /api/v1/transactions": (_, body) => createTransaction(body),
    "PATCH /api/v1/transactions/:id": (_, body, params) => updateTransaction(params.id!, body),
    "DELETE /api/v1/transactions/:id": (_, __, params) => deleteTransaction(params.id!),
  };

  const handlers: HttpHandler[] = Object.entries(resolvers).map(([route, resolve]) => {
    const [method, path] = route.split(" ") as ["GET" | "POST" | "PATCH" | "DELETE", string];
    const on = { GET: http.get, POST: http.post, PATCH: http.patch, DELETE: http.delete }[method];
    return on(FAKE_SURE_URL + path, async ({ request, params }) => {
      const url = new URL(request.url);
      const hasBody = method === "POST" || method === "PATCH";
      const body = hasBody ? await request.json() : undefined;
      requests.push({ method, path: url.pathname + url.search, body });

      const fault = faults.get(route as FakeSureRoute)?.shift();
      if (fault === "drop") return HttpResponse.error();
      if (fault === "hang") await delay("infinite");
      if (typeof fault === "object") {
        const fallback = fault.status >= 500 ? INTERNAL_ERROR : ERROR_BODIES[fault.status];
        return HttpResponse.json(fault.body ?? fallback ?? { error: "error" }, {
          status: fault.status,
        });
      }
      const response = resolve(url, body, params as Record<string, string>);
      return fault === "lose-response" ? HttpResponse.error() : response;
    });
  });

  return {
    /** Pass to `setupServer` (Node) or `setupWorker` (browser), or to `server.use()`. */
    handlers,
    accounts: state.accounts,
    transactions: state.transactions,
    requests,
    /** Queues a fault for the next request to `route`; each fault is used once, in order. */
    failNext(route: FakeSureRoute, fault: FakeSureFault) {
      faults.set(route, [...(faults.get(route) ?? []), fault]);
    },
    pauseAccountSync() {
      accountSyncPaused = true;
    },
    /** Applies the writes held since `pauseAccountSync`, stamped with the current time. */
    resumeAccountSync() {
      accountSyncPaused = false;
      for (const { account, cents } of pendingAccountSync) syncAccount(account, cents);
      pendingAccountSync = [];
    },
  };
}
