import type {
  AccountDetail,
  CategoryDetail,
  MerchantDetail,
  Transaction,
} from "../../src/api/generated/sure";

export interface FakeSureSeed {
  accounts: AccountDetail[];
  categories: CategoryDetail[];
  merchants: MerchantDetail[];
  transactions: Transaction[];
}

// Deliberately not EUR: the accounts below mostly are, so a create without `currency` shows up as
// a wrong currency instead of passing by accident.
export const FAMILY_CURRENCY = "USD";

const SEEDED_AT = "2026-10-01T09:00:00Z";

function account(
  id: string,
  name: string,
  currency: string,
  classification: "asset" | "liability",
  accountType: string,
  balanceCents: number,
): AccountDetail {
  const balance = formatMoney(balanceCents / 100, currency);
  return {
    id,
    name,
    balance,
    balance_cents: balanceCents,
    cash_balance: balance,
    cash_balance_cents: balanceCents,
    currency,
    classification,
    account_type: accountType,
    subtype: null,
    status: "active",
    institution_name: null,
    institution_domain: null,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  };
}

function category(id: string, name: string, color: string, icon: string): CategoryDetail {
  return {
    id,
    name,
    color,
    icon,
    parent: null,
    subcategories_count: 0,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  };
}

function merchant(id: string, name: string): MerchantDetail {
  return { id, name, type: "FamilyMerchant", created_at: SEEDED_AT, updated_at: SEEDED_AT };
}

/** A fresh copy every call, so one test's writes never reach another's seed. */
export function defaultSeed(): FakeSureSeed {
  return {
    accounts: [
      account("acc-cash", "Cash", "EUR", "asset", "depository", 100_000),
      account("acc-checking", "Checking", "USD", "asset", "depository", 250_000),
      account("acc-card", "Credit card", "EUR", "liability", "credit_card", 20_000),
    ],
    categories: [
      category("cat-groceries", "Groceries", "#22c55e", "shopping-cart"),
      category("cat-restaurants", "Restaurants", "#f97316", "utensils"),
      category("cat-salary", "Salary", "#3b82f6", "briefcase"),
    ],
    merchants: [merchant("mer-lidl", "Lidl"), merchant("mer-starbucks", "Starbucks")],
    transactions: [],
  };
}

/** Display string like Sure's `Money#format`. Nothing should parse it. */
export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}
