import { expect, test } from "vitest";
import { getApiV1Accounts } from "../../src/api/generated/sure";
import { ACCOUNT_TYPES } from "../../src/features/balances/rows";
import { as } from "./sure";

test("the pinned Sure answers with the seeded accounts", async () => {
  const reply = await getApiV1Accounts({ per_page: 100 }, as());

  expect(reply.status).toBe(200);
  if (reply.status !== 200) return;
  expect(reply.data.accounts.map((account) => account.name).toSorted()).toEqual([
    "Checking",
    "CreditCard",
    "Crypto",
    "Investment",
    "Latency",
    "Loan",
    "OtherAsset",
    "OtherLiability",
    "Property",
    "Savings",
    "Shared full_control",
    "Shared read_only",
    "Shared read_write",
    "Vehicle",
  ]);
});

// The order and the names of the groups are not in the API: ACCOUNT_TYPES copies them from
// Sure's source at the pinned commit (Accountable::TYPES, accounts.types_plural).
test("every account type comes back as an account_type the Balances screen groups by", async () => {
  const reply = await getApiV1Accounts({ per_page: 100 }, as());

  expect(reply.status).toBe(200);
  if (reply.status !== 200) return;
  const types = new Set(reply.data.accounts.map((account) => account.account_type));
  expect([...types].toSorted()).toEqual([...ACCOUNT_TYPES.keys()].toSorted());
});
