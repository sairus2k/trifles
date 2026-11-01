import { beforeAll, expect, test } from "vitest";
import {
  getApiV1Transactions,
  postApiV1Transactions,
  type PostApiV1TransactionsBody,
} from "../../src/api/generated/sure";
import { todayLocal } from "../../src/domain/dates";
import { as, createTransaction, seeded, uniqueAmount } from "./sure";

let ids: Awaited<ReturnType<typeof seeded>>;

beforeAll(async () => {
  ids = await seeded();
});

test("a repeated external_id answers 200 with the existing transaction", async () => {
  const body: PostApiV1TransactionsBody = {
    transaction: {
      account_id: ids.checking,
      date: todayLocal(),
      amount: uniqueAmount(),
      nature: "expense",
      currency: "USD",
      name: "Repeated",
      external_id: crypto.randomUUID(),
      source: "sure-quick-entry",
    },
  };

  const first = await postApiV1Transactions(body, as());
  const repeat = await postApiV1Transactions(body, as());

  expect(first.status).toBe(201);
  expect(repeat.status).toBe(200);
  if (first.status === 422 || repeat.status === 422) return;
  expect(repeat.data.id).toBe(first.data.id);

  const list = await getApiV1Transactions({ account_id: ids.checking, per_page: 100 }, as());
  if (list.status !== 200) throw new Error(`List answered ${list.status}`);
  const copies = list.data.transactions.filter(
    (transaction) => transaction.external_id === body.transaction.external_id,
  );
  expect(copies).toHaveLength(1);
});

test("an expense is stored positive and an income negative", async () => {
  const expense = await createTransaction({
    account_id: ids.checking,
    amount: 12.34,
    nature: "expense",
  });
  const income = await createTransaction({
    account_id: ids.checking,
    amount: 56.78,
    nature: "income",
  });

  expect(expense.amount_decimal).toBe("12.34");
  expect(income.amount_decimal).toBe("-56.78");
});
