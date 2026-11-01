import { inject } from "vitest";
import {
  getApiV1Accounts,
  getApiV1Categories,
  getApiV1Merchants,
  postApiV1Transactions,
  type PostApiV1TransactionsBodyTransaction,
  type Transaction,
} from "../../src/api/generated/sure";
import type { SureSettings } from "../../src/api/http";
import { todayLocal } from "../../src/domain/dates";

const { baseUrl, readWriteKey, readKey } = inject("sure");

/** Request options for the generated client: the seeded `read_write` key unless told otherwise. */
export function as(key: "read_write" | "read" = "read_write"): { settings: SureSettings } {
  return { settings: { baseUrl, apiKey: key === "read" ? readKey : readWriteKey } };
}

/** Ids of the records seed.rb creates, looked up by name. */
export async function seeded() {
  const [accounts, categories, merchants] = await Promise.all([
    getApiV1Accounts({ per_page: 100 }, as()),
    getApiV1Categories({ per_page: 100 }, as()),
    getApiV1Merchants(as()),
  ]);
  if (accounts.status !== 200 || categories.status !== 200 || merchants.status !== 200) {
    throw new Error("Sure did not list the seeded records");
  }
  const id = (items: { id: string; name: string }[], name: string) => {
    const item = items.find((candidate) => candidate.name === name);
    if (!item) throw new Error(`Sure has no seeded record named ${name}`);
    return item.id;
  };
  return {
    checking: id(accounts.data.accounts, "Checking"),
    savings: id(accounts.data.accounts, "Savings"),
    groceries: id(categories.data.categories, "Groceries"),
    cornerShop: id(merchants.data, "Corner Shop"),
  };
}

/**
 * An amount no other test uses. Sure pairs any equal expense and income on two accounts within a
 * few days into a transfer, so a shared amount would link unrelated tests.
 */
export function uniqueAmount() {
  return 1000 + Math.floor(Math.random() * 900_000) / 100;
}

/** A create as the app sends it, with a fresh `external_id`. */
export async function createTransaction(
  fields: Partial<PostApiV1TransactionsBodyTransaction> & {
    account_id: string;
  },
): Promise<Transaction> {
  const reply = await postApiV1Transactions(
    {
      transaction: {
        date: todayLocal(),
        amount: uniqueAmount(),
        nature: "expense",
        currency: "USD",
        name: "Contract",
        external_id: crypto.randomUUID(),
        source: "sure-quick-entry",
        ...fields,
      },
    },
    as(),
  );
  if (reply.status !== 201) throw new Error(`Create answered ${reply.status}`);
  return reply.data;
}

/** Polls `read` until it returns a value, for state Sure's background jobs change. */
export async function eventually<T>(
  read: () => Promise<T | undefined>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Gave up after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
