import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { db, type AccountRecord } from "../../db/schema";
import { todayLocal } from "../../domain/dates";
import { Entry } from "./entry";

function account(
  id: string,
  name: string,
  currency: string,
  overrides: Partial<AccountRecord> = {},
): AccountRecord {
  return {
    id,
    name,
    currency,
    classification: "asset",
    balanceCents: 0,
    status: "active",
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.bulkPut([
    account("acc-cash", "Cash", "EUR"),
    account("acc-card", "Credit card", "EUR", { classification: "liability" }),
    account("acc-checking", "Checking", "USD"),
    account("acc-yen", "Yen wallet", "JPY"),
    account("acc-closed", "Closed", "EUR", { status: "disabled" }),
  ]);
  await db.categories.bulkPut([
    { id: "cat-groceries", name: "Groceries", color: "#22c55e", icon: "shopping-cart" },
    { id: "cat-restaurants", name: "Restaurants", color: "#f97316", icon: "utensils" },
    { id: "cat-salary", name: "Salary", color: "#3b82f6", icon: "briefcase" },
  ]);
  await db.merchants.bulkPut([
    { id: "mer-deli", name: "Deli Corner" },
    { id: "mer-lidl", name: "Lidl" },
    { id: "mer-starbucks", name: "Starbucks" },
  ]);
  await db.suggestions.bulkPut([
    {
      merchantName: "Lidl",
      merchantId: "mer-lidl",
      categoryId: "cat-groceries",
      count: 3,
      lastUsedAt: 1,
    },
  ]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const amountField = () => screen.getByLabelText<HTMLInputElement>("Amount");
const select = (label: string) => screen.getByLabelText<HTMLSelectElement>(label);
const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const optionNames = (label: string) => [...select(label).options].map((o) => o.textContent);

async function renderEntry() {
  render(() => <Entry tab="expense" onTabChange={() => {}} />);
  await screen.findByLabelText("Amount");
}

async function waitForOutbox(count: number) {
  await vi.waitFor(async () => expect(await db.outbox.count()).toBe(count));
  return db.outbox.orderBy("createdAt").toArray();
}

test("Expense and Income set the sign, and each tab keeps its own category", async () => {
  await renderEntry();
  await userEvent.selectOptions(select("Category"), "cat-groceries");
  await userEvent.fill(amountField(), "12.5");
  await userEvent.click(screen.getByRole("button", { name: "Add expense" }));
  await waitForOutbox(1);

  await userEvent.click(screen.getByRole("tab", { name: "Income" }));
  expect(screen.getByRole("tab", { name: "Income" }).getAttribute("aria-selected")).toBe("true");
  expect(select("Category").value).toBe("");
  await userEvent.selectOptions(select("Category"), "cat-salary");
  await userEvent.fill(amountField(), "2000");
  await userEvent.click(screen.getByRole("button", { name: "Add income" }));

  const [expense, income] = await waitForOutbox(2);
  expect(expense).toMatchObject({
    op: "create",
    status: "pending",
    payload: {
      accountId: "acc-cash",
      date: todayLocal(),
      amount: "12.50",
      nature: "expense",
      currency: "EUR",
      categoryId: "cat-groceries",
    },
  });
  expect(income).toMatchObject({
    op: "create",
    payload: { amount: "2000.00", nature: "income", categoryId: "cat-salary" },
  });

  await userEvent.click(screen.getByRole("tab", { name: "Expense" }));
  expect(select("Category").value).toBe("cat-groceries");
});

test("Transfer sends both accounts in one currency", async () => {
  await renderEntry();
  await userEvent.click(screen.getByRole("tab", { name: "Transfer" }));

  expect(optionNames("From")).toEqual([
    "Cash · EUR",
    "Checking · USD",
    "Credit card · EUR",
    "Yen wallet · JPY",
  ]);
  // Not Cash itself, not the USD account, not the disabled one.
  expect(optionNames("To")).toEqual(["Credit card · EUR"]);

  await userEvent.fill(amountField(), "50");
  await userEvent.fill(field("Note"), "pay off");
  await userEvent.click(screen.getByRole("button", { name: "Add transfer" }));

  const [transfer] = await waitForOutbox(1);
  expect(transfer).toMatchObject({
    op: "transfer",
    payload: {
      fromAccountId: "acc-cash",
      toAccountId: "acc-card",
      date: todayLocal(),
      amount: "50.00",
      currency: "EUR",
      name: "Cash → Credit card",
      notes: "pay off",
    },
  });
});

test("a transfer from an account with no same-currency peer cannot be sent", async () => {
  await renderEntry();
  await userEvent.click(screen.getByRole("tab", { name: "Transfer" }));
  await userEvent.selectOptions(select("From"), "acc-checking");

  expect(screen.getByRole("status").textContent).toBe("No other USD account to transfer to.");
  expect(screen.queryByLabelText("To")).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add transfer" }).disabled).toBe(
    true,
  );
});

test("the operator row builds an expression that is evaluated on submit", async () => {
  await renderEntry();
  // Phones show the decimal keyboard, which has no operators.
  expect(amountField().inputMode).toBe("decimal");
  await userEvent.click(amountField());
  await userEvent.keyboard("120");
  await userEvent.click(screen.getByRole("button", { name: "plus" }));
  await userEvent.keyboard("35.5");
  await userEvent.click(screen.getByRole("button", { name: "minus" }));
  // The operator buttons leave the focus, and the phone keyboard, in the amount field.
  expect(document.activeElement).toBe(amountField());
  await userEvent.keyboard("10");
  expect(amountField().value).toBe("120+35.5−10");

  await userEvent.click(screen.getByRole("button", { name: "Add expense" }));

  const [entry] = await waitForOutbox(1);
  expect(entry).toMatchObject({ payload: { amount: "145.50" } });
});

test("the amount is rounded to the account currency", async () => {
  await renderEntry();
  await userEvent.selectOptions(select("Account"), "acc-yen");
  await userEvent.fill(amountField(), "100÷3");
  await userEvent.click(screen.getByRole("button", { name: "Add expense" }));

  const [entry] = await waitForOutbox(1);
  expect(entry).toMatchObject({ payload: { amount: "33", currency: "JPY" } });
});

test.each([
  ["12+", "Not a valid amount"],
  ["0", "The amount must be greater than zero"],
  ["", "Enter an amount"],
])("%j shows %j and writes nothing", async (input, message) => {
  await renderEntry();
  await userEvent.fill(amountField(), input);
  await userEvent.click(screen.getByRole("button", { name: "Add expense" }));

  expect((await screen.findByRole("alert")).textContent).toBe(message);
  expect(amountField().getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(amountField());
  expect(await db.outbox.count()).toBe(0);

  await userEvent.keyboard("5");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("after submit amount, merchant and note clear, account and category stay, focus returns to the amount", async () => {
  await renderEntry();
  await userEvent.selectOptions(select("Account"), "acc-card");
  await userEvent.selectOptions(select("Category"), "cat-restaurants");
  await userEvent.fill(amountField(), "5");
  await userEvent.fill(field("Merchant"), "Kiosk");
  await userEvent.fill(field("Note"), "gum");
  await userEvent.click(screen.getByRole("button", { name: "Add expense" }));
  await waitForOutbox(1);

  await vi.waitFor(() => expect(amountField().value).toBe(""));
  expect(field("Merchant").value).toBe("");
  expect(field("Note").value).toBe("");
  expect(select("Account").value).toBe("acc-card");
  expect(select("Category").value).toBe("cat-restaurants");
  expect(document.activeElement).toBe(amountField());

  // After a restart the account is kept and the category starts empty.
  cleanup();
  await renderEntry();
  expect(select("Account").value).toBe("acc-card");
  expect(select("Category").value).toBe("");
});

test("merchant autocomplete suggests known names and pre-fills the usual category", async () => {
  await renderEntry();
  await userEvent.fill(field("Merchant"), "li");

  const list = screen.getByRole("list", { name: "Suggestions" });
  expect([...list.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
    "Lidl",
    "Deli Corner",
  ]);

  await userEvent.click(screen.getByRole("button", { name: "Lidl" }));
  expect(field("Merchant").value).toBe("Lidl");
  expect(select("Category").value).toBe("cat-groceries");
  expect(screen.queryByRole("list", { name: "Suggestions" })).toBeNull();

  await userEvent.fill(amountField(), "20");
  await userEvent.click(screen.getByRole("button", { name: "Add expense" }));

  const [entry] = await waitForOutbox(1);
  expect(entry).toMatchObject({
    payload: { name: "Lidl", merchantId: "mer-lidl", categoryId: "cat-groceries" },
  });
});

test("typing a known name in full pre-fills its category and closes the list", async () => {
  await renderEntry();
  await userEvent.fill(field("Merchant"), "lidl");

  expect(field("Merchant").value).toBe("Lidl");
  expect(select("Category").value).toBe("cat-groceries");
  expect(screen.queryByRole("list", { name: "Suggestions" })).toBeNull();
});

test("a known name can be typed on into a longer one", async () => {
  await db.merchants.put({ id: "mer-lidl-express", name: "Lidl Express" });
  await renderEntry();
  await userEvent.click(field("Merchant"));
  await userEvent.keyboard("Lidl ");

  expect(field("Merchant").value).toBe("Lidl ");
  expect(screen.getByRole("button", { name: "Lidl Express" })).toBeTruthy();
});

test.each([
  [
    "a typed merchant name is matched without the list",
    "starbucks",
    "",
    "Starbucks",
    "mer-starbucks",
  ],
  ["an unknown name is sent as the transaction name", "Kiosk", "", "Kiosk", null],
  ["an empty name falls back to the category", "", "cat-groceries", "Groceries", null],
  ["an empty name without a category falls back to the tab", "", "", "Expense", null],
])("%s", async (_, typed, categoryId, name, merchantId) => {
  await renderEntry();
  await userEvent.selectOptions(select("Category"), categoryId);
  await userEvent.fill(amountField(), "1");
  if (typed) await userEvent.fill(field("Merchant"), typed);
  await userEvent.click(screen.getByRole("button", { name: "Add expense" }));

  const [entry] = await waitForOutbox(1);
  expect(entry).toMatchObject({ payload: { name, merchantId } });
});

test("an entry made offline is queued", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await renderEntry();
  await userEvent.fill(amountField(), "3");
  await userEvent.click(screen.getByRole("button", { name: "Add expense" }));

  const [entry] = await waitForOutbox(1);
  expect(entry).toMatchObject({ op: "create", status: "pending", attempts: 0 });
});

test("before the first sync there is nothing to choose from", async () => {
  await db.accounts.clear();
  render(() => <Entry tab="expense" onTabChange={() => {}} />);

  expect(
    await screen.findByText("Your Sure accounts appear here after the first sync."),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Amount")).toBeNull();
});
