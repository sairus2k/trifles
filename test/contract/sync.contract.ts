import { beforeAll, expect, test } from "vitest";
import { getApiV1AccountsId, getApiV1TransactionsId } from "../../src/api/generated/sure";
import { as, createTransaction, eventually, seeded, uniqueAmount } from "./sure";

// Seeded in seed.rb, in whole dollars.
const OPENING_BALANCE_CENTS = 1000_00;
const LATENCY_SAMPLES = 5;

let ids: Awaited<ReturnType<typeof seeded>>;

beforeAll(async () => {
  ids = await seeded();
});

test("an expense and an income of the same amount on two USD accounts become one transfer", async () => {
  const amount = uniqueAmount();
  const out = await createTransaction({ account_id: ids.checking, amount, nature: "expense" });
  const into = await createTransaction({ account_id: ids.savings, amount, nature: "income" });

  const transferId = (id: string) =>
    eventually(async () => {
      const reply = await getApiV1TransactionsId(id, as());
      return reply.status === 200 ? (reply.data.transfer?.id ?? undefined) : undefined;
    });

  const [outTransfer, intoTransfer] = await Promise.all([transferId(out.id), transferId(into.id)]);
  expect(outTransfer).toBe(intoTransfer);
});

test("the account balance follows a write", async () => {
  let expectedCents = OPENING_BALANCE_CENTS;
  const latencies: number[] = [];

  for (let sample = 0; sample < LATENCY_SAMPLES; sample++) {
    const amount = uniqueAmount();
    const created = await createTransaction({ account_id: ids.latency, amount, nature: "expense" });
    const start = performance.now();
    expectedCents -= Math.round(amount * 100);

    // The same test the app's pending delta uses: the account's updated_at reaches the
    // transaction's created_at. The balance check makes sure it is this write's recalculation.
    await eventually(async () => {
      const reply = await getApiV1AccountsId(ids.latency, undefined, as());
      if (reply.status !== 200) return undefined;
      const { balance_cents, updated_at } = reply.data;
      const applied = Date.parse(updated_at) >= Date.parse(created.created_at);
      return applied && balance_cents === expectedCents ? true : undefined;
    });
    latencies.push(performance.now() - start);
  }

  const sorted = latencies.toSorted((a, b) => a - b);
  const ms = (value: number) => `${Math.round(value)} ms`;
  console.info(
    `Balance update latency over ${LATENCY_SAMPLES} writes (polled every 100 ms): ` +
      `min ${ms(sorted[0]!)}, median ${ms(sorted[Math.floor(sorted.length / 2)]!)}, ` +
      `max ${ms(sorted.at(-1)!)}`,
  );
});
