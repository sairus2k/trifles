import {
  getApiV1Accounts,
  getApiV1Categories,
  getApiV1Merchants,
  getApiV1Transactions,
  type AccountDetail,
  type Pagination,
  type Transaction,
} from "../api/generated/sure";
import { SureError } from "../api/http";
import { db, type AccountRecord, type TransactionRecord } from "../db/schema";

// Screens read only from the cache, so pull replaces it with what Sure returns. Requests come first
// and the cache is written in one transaction after them, so a failed pull changes nothing.

const PER_PAGE = 100; // Sure's maximum

/** Accounts, categories and merchants. */
export async function pullReference(): Promise<void> {
  const accounts = await fetchAccounts();
  const categories = await allPages(async (page) => {
    const { categories, pagination } = ok(
      await getApiV1Categories({ page, per_page: PER_PAGE }),
      "/api/v1/categories",
    );
    return { items: categories, pagination };
  });
  const merchants = ok(await getApiV1Merchants(), "/api/v1/merchants");

  await db.transaction("rw", [db.accounts, db.categories, db.merchants], async () => {
    await db.accounts.clear();
    await db.accounts.bulkPut(accounts);
    await db.categories.clear();
    await db.categories.bulkPut(
      categories.map(({ id, name, color, icon }) => ({ id, name, color, icon })),
    );
    await db.merchants.clear();
    await db.merchants.bulkPut(merchants.map(({ id, name }) => ({ id, name })));
  });
}

/** Accounts, for fresh balances, and the latest 100 transactions. */
export async function pullRecent(): Promise<void> {
  const accounts = await fetchAccounts();
  // Sure lists them newest first.
  const { transactions } = ok(
    await getApiV1Transactions({ per_page: PER_PAGE }),
    "/api/v1/transactions",
  );

  await db.transaction("rw", [db.accounts, db.transactions], async () => {
    await db.accounts.clear();
    await db.accounts.bulkPut(accounts);
    await db.transactions.clear();
    await db.transactions.bulkPut(transactions.map(toTransaction));
  });
}

async function fetchAccounts(): Promise<AccountRecord[]> {
  const accounts = await allPages(async (page) => {
    const { accounts, pagination } = ok(
      await getApiV1Accounts({ page, per_page: PER_PAGE }),
      "/api/v1/accounts",
    );
    return { items: accounts, pagination };
  });
  return accounts.map(toAccount);
}

function toAccount(account: AccountDetail): AccountRecord {
  return {
    id: account.id,
    name: account.name,
    currency: account.currency,
    // Sure has only these two; the spec types the field as a plain string.
    classification: account.classification === "liability" ? "liability" : "asset",
    balanceCents: account.balance_cents,
    status: account.status,
    updatedAt: Date.parse(account.updated_at),
  };
}

// `amount` is a display string; `amount_decimal` is the exact value.
function toTransaction(transaction: Transaction): TransactionRecord {
  return {
    id: transaction.id,
    accountId: transaction.account.id,
    date: transaction.date,
    name: transaction.name,
    amountDecimal: transaction.amount_decimal,
    currency: transaction.currency,
    categoryId: transaction.category?.id ?? null,
    merchantId: transaction.merchant?.id ?? null,
    notes: transaction.notes ?? null,
    externalId: transaction.external_id ?? null,
  };
}

async function allPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; pagination: Pagination }>,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await fetchPage(page);
    items.push(...result.items);
    if (page >= result.pagination.total_pages) return items;
  }
}

// The spec declares only 200 for these reads, but sureFetch returns any JSON 4xx except 401 as a
// value; caching an error body as data would wipe the cache.
function ok<T>(reply: { status: number; data: T }, path: string): T {
  if (reply.status !== 200) {
    throw new SureError("http", `GET ${path} failed with status ${reply.status}`, reply.status);
  }
  return reply.data;
}
