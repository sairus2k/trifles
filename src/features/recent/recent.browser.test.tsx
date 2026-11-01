import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  db,
  type AccountRecord,
  type EntryPayload,
  type OutboxRecord,
  type TransactionRecord,
} from "../../db/schema";
import { toLocalDate } from "../../domain/dates";
import { Recent } from "./recent";

const today = toLocalDate(new Date());
const yesterday = toLocalDate(new Date(Date.now() - 86_400_000));
const lastYear = `${new Date().getFullYear() - 1}-06-15`;

function account(id: string, name: string, overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id,
    name,
    currency: "EUR",
    classification: "asset",
    balanceCents: 0,
    status: "active",
    updatedAt: 0,
    ...overrides,
  };
}

function tx(id: string, overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id,
    accountId: "acc-cash",
    date: today,
    name: id,
    amountDecimal: "3.5",
    currency: "EUR",
    categoryId: null,
    merchantId: null,
    notes: null,
    externalId: null,
    createdAt: 1_000,
    transferId: null,
    ...overrides,
  };
}

const coffee: EntryPayload = {
  accountId: "acc-cash",
  date: today,
  amount: "3.50",
  nature: "expense",
  currency: "EUR",
  name: "Coffee",
  notes: null,
  categoryId: "cat-food",
  merchantId: null,
};

function create(
  clientId: string,
  payload: Partial<EntryPayload> = {},
  state: Partial<OutboxRecord> = {},
): OutboxRecord {
  return {
    clientId,
    op: "create",
    payload: { ...coffee, ...payload },
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: Date.now(),
    ...state,
  } as OutboxRecord;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.bulkPut([
    account("acc-cash", "Cash"),
    account("acc-card", "Card", { classification: "liability" }),
  ]);
  await db.categories.bulkPut([
    { id: "cat-food", name: "Food", color: "#22c55e", icon: "utensils" },
    { id: "cat-salary", name: "Salary", color: "#3b82f6", icon: "briefcase" },
  ]);
  await db.merchants.bulkPut([{ id: "mer-lidl", name: "Lidl" }]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (name: string) => screen.getByText(name).closest("li")!;
const headings = () => screen.getAllByRole("heading").map((h) => h.textContent);

async function renderRecent() {
  render(() => <Recent />);
  await screen.findByRole("region", { name: "Recent transactions" });
}

test("server and pending transactions are grouped by local day, newest first", async () => {
  await db.transactions.bulkPut([
    tx("Rent", { date: lastYear, amountDecimal: "800.0" }),
    tx("Bakery", { date: yesterday, categoryId: "cat-food" }),
    tx("Salary", { amountDecimal: "-2500.0", categoryId: "cat-salary", createdAt: 1_000 }),
    tx("Lunch", { createdAt: Date.now() + 60_000 }),
  ]);
  await db.outbox.put(create("c-1"));
  await renderRecent();

  await vi.waitFor(() => expect(headings()).toHaveLength(3));
  expect(headings().slice(0, 2)).toEqual(["Today", "Yesterday"]);
  expect(headings()[2]).toMatch(String(new Date().getFullYear() - 1));
  const todayRows = within(screen.getAllByRole("list")[0]!).getAllByRole("listitem");
  expect(todayRows.map((li) => li.firstElementChild!.firstElementChild!.textContent)).toEqual([
    "Lunch",
    "CoffeePending",
    "Salary",
  ]);
  expect(row("Salary").textContent).toContain("Salary · Cash");
  expect(row("Salary").textContent).toContain("+€2,500.00");
  expect(row("Coffee").textContent).toContain("-€3.50");
});

test("a sent entry and its pulled transaction show once", async () => {
  await db.transactions.put(tx("Coffee", { externalId: "c-1" }));
  await db.outbox.put(create("c-1", {}, { status: "done", attempts: 1 }));
  await renderRecent();

  await screen.findByText("Coffee");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.queryByText("Pending")).toBeNull();
});

test("pending entries are marked and failed ones show the server error", async () => {
  await db.outbox.bulkPut([
    create("c-1", { name: "Queued" }),
    create("c-2", { name: "Retried" }, { attempts: 1, lastError: "Sure answered 503" }),
    create(
      "c-3",
      { name: "Rejected" },
      { status: "failed", attempts: 1, lastError: "Amount is invalid" },
    ),
  ]);
  await renderRecent();

  await screen.findByText("Queued");
  expect(row("Queued").textContent).toContain("Pending");
  expect(row("Retried").textContent).toContain("Retrying");
  expect(row("Retried").textContent).toContain("Sure answered 503");
  expect(row("Rejected").textContent).toContain("Failed");
  expect(row("Rejected").textContent).toContain("Amount is invalid");
});

test("a transfer is one row from one account to the other", async () => {
  await db.transactions.bulkPut([
    tx("leg-out", {
      name: "Card → Cash",
      accountId: "acc-card",
      amountDecimal: "100.0",
      transferId: "trf-1",
    }),
    tx("leg-in", {
      name: "Card → Cash",
      accountId: "acc-cash",
      amountDecimal: "-100.0",
      transferId: "trf-1",
    }),
  ]);
  await renderRecent();

  await vi.waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
  expect(screen.getByRole("listitem").textContent).toContain("€100.00");
  expect(screen.getByRole("listitem").textContent).not.toMatch(/[+-]€/);
});

test("an empty cache says so", async () => {
  await renderRecent();

  expect(await screen.findByText("No transactions yet.")).toBeTruthy();
});
