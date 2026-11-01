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

export interface BalanceGroups {
  assets: BalanceRow[];
  liabilities: BalanceRow[];
}

/**
 * Active accounts by name, split by Sure's classification. Draft accounts are left out, as in the
 * entry form. `deltas` is `pendingDeltas()`: a decimal string per account in the direction of its
 * balance.
 */
export function balanceGroups(
  accounts: AccountRecord[],
  deltas: Map<string, string>,
): BalanceGroups {
  const groups: BalanceGroups = { assets: [], liabilities: [] };
  const active = accounts
    .filter((account) => account.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const { id, name, currency, classification, balanceCents } of active) {
    const balance = fromMinorUnits(balanceCents, minorUnitConversion(currency));
    const delta = deltas.get(id);
    groups[classification === "liability" ? "liabilities" : "assets"].push({
      id,
      name,
      currency,
      balance,
      ...(delta ? { pending: { delta, projected: addDecimals(balance, delta) } } : {}),
    });
  }
  return groups;
}
