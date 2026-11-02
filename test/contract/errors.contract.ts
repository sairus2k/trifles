import { beforeAll, expect, test } from "vitest";
import {
  deleteApiV1TransactionsId,
  getApiV1AccountsId,
  getApiV1RecurringTransactions,
  getApiV1Transactions,
  patchApiV1TransactionsId,
  postApiV1RecurringTransactions,
  postApiV1Transactions,
  type PatchApiV1TransactionsIdBodyTransaction,
} from "../../src/api/generated/sure";
import { SureError } from "../../src/api/http";
import { todayLocal } from "../../src/domain/dates";
import { as, createTransaction, seeded, uniqueAmount, unsharedAccountId } from "./sure";

let ids: Awaited<ReturnType<typeof seeded>>;

beforeAll(async () => {
  ids = await seeded();
});

test("PATCH keeps null and blank fields and the currency, and clears notes with an empty string", async () => {
  const created = await createTransaction({
    account_id: ids.checking,
    name: "Original",
    notes: "Keep me until cleared",
    category_id: ids.groceries,
    merchant_id: ids.cornerShop,
  });
  // The generated body type has no nulls, but the app's update may carry them.
  const changes = {
    name: null,
    category_id: "",
    merchant_id: "",
    currency: "EUR",
    notes: "",
  } as unknown as PatchApiV1TransactionsIdBodyTransaction;

  const reply = await patchApiV1TransactionsId(created.id, { transaction: changes }, as());

  expect(reply.status).toBe(200);
  if (reply.status !== 200) return;
  expect(reply.data).toMatchObject({
    name: "Original",
    currency: "USD",
    notes: "",
    category: { id: ids.groceries },
    merchant: { id: ids.cornerShop },
  });
});

test("PATCH and DELETE of an unknown transaction answer 404 not_found", async () => {
  const patch = await patchApiV1TransactionsId(
    crypto.randomUUID(),
    { transaction: { name: "Nobody" } },
    as(),
  );
  const remove = await deleteApiV1TransactionsId(crypto.randomUUID(), as());

  expect(patch).toMatchObject({ status: 404, data: { error: "not_found" } });
  expect(remove).toMatchObject({ status: 404, data: { error: "not_found" } });
});

// Push tells such an account from a transient 500 by looking it up (TASK-19).
test.each([
  ["an unknown account", () => crypto.randomUUID()],
  ["another member's account not shared with the key", () => unsharedAccountId],
])("%s: a create answers 500 and GET /accounts/{id} 404", async (_, accountId) => {
  const id = accountId();
  const create = postApiV1Transactions(
    {
      transaction: {
        account_id: id,
        date: todayLocal(),
        amount: uniqueAmount(),
        nature: "expense",
        currency: "USD",
        name: "Nowhere",
        external_id: crypto.randomUUID(),
        source: "sure-quick-entry",
      },
    },
    as(),
  );

  await expect(create).rejects.toThrow(SureError);
  await expect(create).rejects.toMatchObject({ kind: "http", status: 500 });
  const lookup = await getApiV1AccountsId(id, { include_disabled: true }, as());
  expect(lookup).toMatchObject({
    status: 404,
    data: { error: "not_found", message: "Account not found" },
  });
});

// Sure lists and finds every account shared with the key's user but writes only to an owned one or
// a full_control share. Push asks with a recurring transaction create that blank dates make
// invalid: the account is resolved first, so 404 means no write access and 422 write access (TASK-24).
function writeProbe(accountId: string) {
  return postApiV1RecurringTransactions(
    {
      recurring_transaction: {
        account_id: accountId,
        name: "Write probe",
        amount: 0,
        currency: "USD",
        expected_day_of_month: 0,
        last_occurrence_date: "",
        next_expected_date: "",
      },
    },
    as(),
  );
}

test.each([
  ["a read_write share, which every account of another member gets", () => ids.sharedReadWrite],
  ["a read_only share", () => ids.sharedReadOnly],
])(
  "%s: a create answers 500, GET /accounts/{id} 200 and the write probe 404",
  async (_, accountId) => {
    const id = accountId();

    const create = createTransaction({ account_id: id });

    await expect(create).rejects.toMatchObject({ kind: "http", status: 500 });
    expect((await getApiV1AccountsId(id, { include_disabled: true }, as())).status).toBe(200);
    expect(await writeProbe(id)).toMatchObject({
      status: 404,
      data: { error: "record_not_found" },
    });
  },
);

test.each([
  ["an owned account", () => ids.checking],
  ["a full_control share", () => ids.sharedFullControl],
])("%s: the write probe answers 422 and a create 201", async (_, accountId) => {
  const id = accountId();

  expect(await writeProbe(id)).toMatchObject({ status: 422, data: { error: "validation_failed" } });
  await expect(createTransaction({ account_id: id })).resolves.toMatchObject({
    account: { id },
  });
});

test("the write probe creates no recurring transaction", async () => {
  await writeProbe(ids.checking);
  await writeProbe(ids.sharedReadOnly);

  const list = await getApiV1RecurringTransactions({ per_page: 100 }, as());

  expect(list.status).toBe(200);
  if (list.status !== 200) return;
  expect(list.data.recurring_transactions.filter((r) => r.name === "Write probe")).toEqual([]);
});

test("a read-only key answers 403 to a create and creates nothing", async () => {
  const externalId = crypto.randomUUID();

  const reply = await postApiV1Transactions(
    {
      transaction: {
        account_id: ids.checking,
        date: todayLocal(),
        amount: uniqueAmount(),
        nature: "expense",
        currency: "USD",
        name: "Read only",
        external_id: externalId,
        source: "sure-quick-entry",
      },
    },
    as("read"),
  );

  expect(reply.status as number).toBe(403);
  const list = await getApiV1Transactions({ account_id: ids.checking, per_page: 100 }, as());
  if (list.status !== 200) throw new Error(`List answered ${list.status}`);
  expect(list.data.transactions.some((t) => t.external_id === externalId)).toBe(false);
});

// Settings tells a read-only key apart with this probe (TASK-11): Sure checks the write scope
// before it looks the transaction up.
test("deleting a random id answers 403 insufficient_scope to a read key and 404 to a read_write key", async () => {
  const id = crypto.randomUUID();

  const read = await deleteApiV1TransactionsId(id, as("read"));
  const readWrite = await deleteApiV1TransactionsId(id, as());

  expect(read.status as number).toBe(403);
  expect(read.data).toMatchObject({ error: "insufficient_scope" });
  expect(readWrite).toMatchObject({ status: 404, data: { error: "not_found" } });
});
