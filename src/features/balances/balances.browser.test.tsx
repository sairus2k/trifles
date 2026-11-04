import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { db, type AccountRecord, type EntryPayload, type OutboxRecord } from "../../db/schema";
import { formatAmount } from "../../domain/money";
import { Balances } from "./balances";

function account(id: string, name: string, overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id,
    name,
    currency: "EUR",
    classification: "asset",
    balanceCents: 0,
    status: "active",
    updatedAt: 1_000,
    ...overrides,
  };
}

const coffee: EntryPayload = {
  accountId: "acc-cash",
  date: "2026-11-01",
  amount: "12",
  nature: "expense",
  currency: "EUR",
  name: "Coffee",
  notes: null,
  categoryId: null,
  merchantId: null,
};

function create(clientId: string, state: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    clientId,
    op: "create",
    payload: coffee,
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
    account("acc-cash", "Cash", { accountType: "depository", balanceCents: 120_000 }),
    account("acc-yen", "Yen wallet", {
      accountType: "depository",
      currency: "JPY",
      balanceCents: 5_000,
    }),
    account("acc-card", "Card", {
      classification: "liability",
      accountType: "credit_card",
      balanceCents: 35_000,
    }),
    account("acc-draft", "Draft", { status: "draft" }),
  ]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const eur = (decimal: string) => formatAmount(decimal, "EUR");
const region = (name: string) => screen.findByRole("region", { name });
// "Cash" is both an account and its group's heading.
const row = (group: HTMLElement, name: string) =>
  within(group).getByText(name, { selector: "li span" }).closest("li")!;
// Looked up again on every call: a new query result renders new rows.
const text = (group: string, name: string) =>
  row(screen.getByRole("region", { name: group }), name).textContent;

test("accounts are split into assets and liabilities with balances in their own currency", async () => {
  render(() => <Balances />);

  const assets = await region("Assets");
  const liabilities = await region("Liabilities");
  expect(row(assets, "Cash").textContent).toContain(eur("1200"));
  expect(row(assets, "Yen wallet").textContent).toContain(formatAmount("5000", "JPY"));
  expect(row(liabilities, "Card").textContent).toContain(eur("350"));
  expect(within(assets).queryByText("Card")).toBeNull();
  expect(screen.queryByText("Draft")).toBeNull();
  expect(screen.queryByText(/≈/)).toBeNull();
});

test("each type is a group under its heading, in Sure's order, unknown types last", async () => {
  await db.accounts.bulkPut([
    account("acc-broker", "Brokerage", { accountType: "investment" }),
    account("acc-old", "Old cache"),
  ]);
  render(() => <Balances />);

  const headings = async (name: string) =>
    within(await region(name))
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
  await vi.waitFor(async () =>
    expect(await headings("Assets")).toEqual(["Cash", "Investments", "Other Assets"]),
  );
  expect(await headings("Liabilities")).toEqual(["Credit Cards"]);
  expect(row(await region("Investments"), "Brokerage").textContent).toContain(eur("0"));
  expect(within(await region("Cash")).getAllByRole("listitem")).toHaveLength(2);
  expect(row(await region("Other Assets"), "Old cache")).toBeTruthy();
});

test("with no accounts cached, the screen says they come with the first sync", async () => {
  await db.accounts.clear();
  render(() => <Balances />);

  expect(await screen.findByText(/appear here after the first sync/)).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Assets" })).toBeNull();
});

test("an unsynced entry shows the projected balance as ≈ next to Sure's balance and the delta", async () => {
  await db.outbox.put(create("c1"));
  render(() => <Balances />);

  await region("Assets");
  await vi.waitFor(() => expect(text("Assets", "Cash")).toContain(`≈ ${eur("1188")}`));
  expect(text("Assets", "Cash")).toContain(`Sure ${eur("1200")} · ${eur("-12")}`);
  expect(text("Liabilities", "Card")).not.toContain("≈");
});

test("a liability shows an expense as a rise in what is owed", async () => {
  await db.outbox.put(create("c1", { payload: { ...coffee, accountId: "acc-card" } }));
  render(() => <Balances />);

  await region("Liabilities");
  await vi.waitFor(() => expect(text("Liabilities", "Card")).toContain(`≈ ${eur("362")}`));
  expect(text("Liabilities", "Card")).toContain(`· +${eur("12")}`);
});

test("the delta disappears once pull brings a newer balance", async () => {
  await db.outbox.put(create("c1", { status: "done", appliedAt: 2_000 }));
  render(() => <Balances />);

  await region("Assets");
  await vi.waitFor(() => expect(text("Assets", "Cash")).toContain(`≈ ${eur("1188")}`));

  // What pullRecent() writes once Sure has recalculated the account.
  await db.accounts.put(account("acc-cash", "Cash", { balanceCents: 118_800, updatedAt: 2_000 }));

  await vi.waitFor(() => expect(text("Assets", "Cash")).not.toContain("≈"));
  expect(text("Assets", "Cash")).toContain(eur("1188"));
});

test("a failed entry adds no delta", async () => {
  await db.outbox.put(create("c1", { status: "failed", lastError: "Invalid" }));
  render(() => <Balances />);

  await region("Assets");
  expect(text("Assets", "Cash")).toContain(eur("1200"));
  expect(text("Assets", "Cash")).not.toContain("≈");
});
