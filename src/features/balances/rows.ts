import type { AccountRecord } from "../../db/schema";
import { minorUnitConversion } from "../../domain/currency";
import { addDecimals, fromMinorUnits } from "../../domain/money";

export interface BalanceRow {
  id: string;
  name: string;
  currency: string;
  /** Sure's balance as an exact decimal string; a liability is positive while it is owed, as in Sure. */
  balance: string;
  /** What the outbox will still change, and the balance once Sure has counted it. */
  pending?: { delta: string; projected: string };
}

export interface TypeGroup {
  title: string;
  rows: BalanceRow[];
}

export interface BalanceGroups {
  assets: TypeGroup[];
  liabilities: TypeGroup[];
}

/**
 * Sure's `account_type` values in the order of its `Accountable::TYPES`, which orders the groups on
 * its accounts page, with the plural names it shows there (`accounts.types_plural`, English).
 */
export const ACCOUNT_TYPES = new Map([
  ["depository", "Cash"],
  ["investment", "Investments"],
  ["crypto", "Crypto"],
  ["property", "Properties"],
  ["vehicle", "Vehicles"],
  ["other_asset", "Other Assets"],
  ["credit_card", "Credit Cards"],
  ["loan", "Loans"],
  ["other_liability", "Other Liabilities"],
]);

/**
 * Active accounts split by Sure's classification, then grouped by account type, each group by name.
 * Draft accounts are left out, as in the entry form. A type the app does not know joins the
 * classification's Other group, so a newer Sure cannot hide an account. `deltas` is
 * `pendingDeltas()`: a decimal string per account in the direction of its balance.
 */
export function balanceGroups(
  accounts: AccountRecord[],
  deltas: Map<string, string>,
): BalanceGroups {
  const assets = new Map<string, BalanceRow[]>();
  const liabilities = new Map<string, BalanceRow[]>();
  const active = accounts
    .filter((account) => account.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const { id, name, currency, classification, accountType, balanceCents } of active) {
    const liability = classification === "liability";
    const type =
      accountType && ACCOUNT_TYPES.has(accountType)
        ? accountType
        : liability
          ? "other_liability"
          : "other_asset";
    const side = liability ? liabilities : assets;
    const balance = fromMinorUnits(balanceCents, minorUnitConversion(currency));
    const delta = deltas.get(id);
    side.set(type, [
      ...(side.get(type) ?? []),
      {
        id,
        name,
        currency,
        balance,
        ...(delta ? { pending: { delta, projected: addDecimals(balance, delta) } } : {}),
      },
    ]);
  }
  return { assets: inSureOrder(assets), liabilities: inSureOrder(liabilities) };
}

function inSureOrder(byType: Map<string, BalanceRow[]>): TypeGroup[] {
  return [...ACCOUNT_TYPES]
    .filter(([type]) => byType.has(type))
    .map(([type, title]) => ({ title, rows: byType.get(type)! }));
}
