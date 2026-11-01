import { expect, test } from "vitest";
import { getApiV1Accounts } from "../../src/api/generated/sure";
import { as } from "./sure";

test("the pinned Sure answers with the seeded accounts", async () => {
  const reply = await getApiV1Accounts({ per_page: 100 }, as());

  expect(reply.status).toBe(200);
  if (reply.status !== 200) return;
  expect(reply.data.accounts.map((account) => account.name).toSorted()).toEqual([
    "Checking",
    "Savings",
  ]);
});
