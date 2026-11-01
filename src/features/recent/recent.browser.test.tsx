import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  db,
  type AccountRecord,
  type EntryPayload,
  type OutboxRecord,
  type TransactionRecord,
} from "../../db/schema";
import { toLocalDate } from "../../domain/dates";
// Swiping uncovers the delete button by layout: without the styles the row would still cover it.
import "../../index.css";
import { LOCKED_MESSAGE } from "./editor";
import { Recent } from "./recent";
import { SENDING_REASON } from "./rows";

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

const row = (name: string) => screen.getAllByText(name)[0]!.closest("li")!;
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
  expect(todayRows.map((li) => /Lunch|Coffee|Salary/.exec(li.textContent!)?.[0])).toEqual([
    "Lunch",
    "Coffee",
    "Salary",
  ]);
  expect(row("Coffee").textContent).toContain("Pending");
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

function transferLegs(): TransactionRecord[] {
  return [
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
  ];
}

// What a finger does: press, slide left past half the button, lift.
function swipe(name: string) {
  const target = screen.getAllByText(name)[0]!.closest("button")!;
  const at = (type: string, clientX: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX,
        clientY: 10,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  at("pointerdown", 300);
  at("pointermove", 250);
  at("pointermove", 180);
  at("pointerup", 180);
}

async function open(name: string) {
  await userEvent.click((await screen.findAllByText(name))[0]!);
  return screen.findByRole("dialog", { name });
}

const outbox = () => db.outbox.orderBy("createdAt").toArray();

describe("edit", () => {
  test("a pending entry is rewritten in the outbox, date included", async () => {
    await db.outbox.put(create("c-1"));
    await renderRecent();
    const dialog = await open("Coffee");

    const amount = await within(dialog).findByLabelText<HTMLInputElement>("Amount");
    expect(amount.value).toBe("3.50");
    await userEvent.fill(amount, "4+0.2");
    await userEvent.fill(within(dialog).getByLabelText("Date"), "2026-10-30");
    await userEvent.selectOptions(within(dialog).getByLabelText("Category"), "");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await outbox()).toEqual([
      expect.objectContaining({
        clientId: "c-1",
        op: "create",
        status: "pending",
        payload: { ...coffee, amount: "4.20", date: "2026-10-30", categoryId: null },
      }),
    ]);
  });

  test("a synced transaction queues an update with full values and its stored amount", async () => {
    await db.transactions.put(
      tx("Bakery", { amountDecimal: "12.3456", categoryId: "cat-food", notes: "Bread" }),
    );
    await renderRecent();
    const dialog = await open("Bakery");

    expect(within(dialog).getByText("Cash · EUR")).toBeTruthy();
    expect(within(dialog).queryByRole("combobox", { name: "Account" })).toBeNull();
    await userEvent.fill(within(dialog).getByLabelText("Note"), "Bread and cake");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await vi.waitFor(async () => expect(await outbox()).toHaveLength(1));
    expect((await outbox())[0]).toMatchObject({
      op: "update",
      payload: {
        transactionId: "Bakery",
        changes: {
          date: today,
          amount: "12.3456",
          nature: "expense",
          currency: "EUR",
          name: "Bakery",
          notes: "Bread and cake",
          categoryId: "cat-food",
          merchantId: null,
        },
      },
    });
    await vi.waitFor(() => expect(row("Bakery").textContent).toContain("Pending"));
  });

  test("Sure cannot clear a synced category or merchant, and the editor says so", async () => {
    await db.transactions.put(tx("Lidl", { categoryId: "cat-food", merchantId: "mer-lidl" }));
    await renderRecent();
    const dialog = await open("Lidl");

    // The dialog opens before its form leaves <Loading>.
    const none = await within(dialog).findByRole<HTMLOptionElement>("option", {
      name: "No category",
    });
    expect(none.disabled).toBe(true);
    expect(within(dialog).queryByText(/Sure keeps the merchant/)).toBeNull();
    await userEvent.fill(within(dialog).getByLabelText("Merchant"), "Corner shop");
    expect(within(dialog).getByText("Sure keeps the merchant Lidl.")).toBeTruthy();
  });

  test("a row on its way to Sure explains why it cannot be changed", async () => {
    await db.outbox.put(create("c-1", {}, { status: "sending" }));
    await renderRecent();
    const dialog = await open("Coffee");

    expect(within(dialog).getByText(SENDING_REASON)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  test("an entry the sync engine claims while the editor is open is reported, not lost", async () => {
    await db.outbox.put(create("c-1"));
    await renderRecent();
    const dialog = await open("Coffee");

    await db.outbox.update("c-1", { status: "sending" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(LOCKED_MESSAGE);
  });

  test("a failed change can be discarded, leaving the transaction as Sure has it", async () => {
    await db.transactions.put(tx("Bakery"));
    await db.outbox.put({
      clientId: "u-1",
      op: "delete",
      payload: { transactionId: "Bakery" },
      status: "failed",
      attempts: 1,
      nextAttemptAt: 0,
      lastError: "Forbidden",
      createdAt: 1,
    });
    await renderRecent();
    const dialog = await open("Bakery");

    expect(within(dialog).getByText("Forbidden")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard change" }));

    await vi.waitFor(async () => expect(await outbox()).toEqual([]));
    await vi.waitFor(() => expect(row("Bakery").textContent).not.toContain("Failed"));
  });
});

describe("delete", () => {
  test("swiping a pending entry and tapping Delete removes it from the outbox", async () => {
    await db.outbox.put(create("c-1"));
    await renderRecent();
    await screen.findByText("Coffee");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    swipe("Coffee");
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await vi.waitFor(async () => expect(await outbox()).toEqual([]));
    expect(await screen.findByText("No transactions yet.")).toBeTruthy();
  });

  test("deleting a synced transaction queues a delete and hides the row", async () => {
    await db.transactions.put(tx("Bakery"));
    await renderRecent();
    await screen.findByText("Bakery");

    swipe("Bakery");
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await vi.waitFor(() => expect(screen.queryByText("Bakery")).toBeNull());
    expect(await outbox()).toEqual([
      expect.objectContaining({ op: "delete", payload: { transactionId: "Bakery" } }),
    ]);
  });

  test("deleting a synced transfer queues a delete for each leg", async () => {
    await db.transactions.bulkPut(transferLegs());
    await renderRecent();
    const dialog = await open("Card → Cash");

    expect(within(dialog).getByText(/Transfers are changed in Sure/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await vi.waitFor(async () => expect(await outbox()).toHaveLength(2));
    expect((await outbox()).map((r) => r.payload)).toEqual(
      expect.arrayContaining([{ transactionId: "leg-out" }, { transactionId: "leg-in" }]),
    );
  });

  test("a failed transfer is dismissed with a warning that a leg may be in Sure", async () => {
    await db.outbox.put({
      clientId: "t-1",
      op: "transfer",
      payload: {
        fromAccountId: "acc-card",
        toAccountId: "acc-cash",
        date: today,
        amount: "100",
        currency: "EUR",
        name: "Card → Cash",
        notes: null,
      },
      status: "failed",
      attempts: 1,
      nextAttemptAt: 0,
      lastError: "Account is closed",
      createdAt: 1,
    });
    await renderRecent();
    await screen.findAllByText("Card → Cash");
    expect(row("Card → Cash").textContent).toMatch(
      /Account is closed One leg .* may already be in Sure/,
    );

    swipe("Card → Cash");
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    await vi.waitFor(async () => expect(await outbox()).toEqual([]));
  });

  test("a row on its way to Sure cannot be swiped away", async () => {
    await db.outbox.put(create("c-1", {}, { attempts: 1, lastError: "Network error" }));
    await renderRecent();
    await screen.findByText("Coffee");

    swipe("Coffee");

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
