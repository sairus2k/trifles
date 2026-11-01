import { For, Loading, Show } from "solid-js";
import { db } from "../../db/schema";
import { createLiveQuery } from "../../db/live";
import { formatAmount } from "../../domain/money";
import { pendingDeltas } from "../../sync/outbox";
import { balanceGroups, type BalanceGroups, type BalanceRow } from "./rows";

// pendingDeltas() reads the outbox and the accounts, so the query re-runs when either changes.
async function readBalances(): Promise<BalanceGroups> {
  const [accounts, deltas] = await Promise.all([db.accounts.toArray(), pendingDeltas()]);
  return balanceGroups(accounts, deltas);
}

export function Balances() {
  const groups = createLiveQuery(readBalances);
  return (
    <section aria-label="Balances" class="flex flex-col gap-4 py-4 pb-safe">
      <Loading>
        <Show
          when={groups().assets.length + groups().liabilities.length > 0}
          fallback={
            <p class="px-safe text-ink-muted">
              Your Sure accounts appear here after the first sync.
            </p>
          }
        >
          <Group title="Assets" rows={groups().assets} />
          <Group title="Liabilities" rows={groups().liabilities} />
        </Show>
      </Loading>
    </section>
  );
}

function Group(props: { title: string; rows: BalanceRow[] }) {
  return (
    <Show when={props.rows.length > 0}>
      <section aria-label={props.title} class="flex flex-col">
        <h2 class="px-safe pb-1 text-sm font-semibold text-ink-muted">{props.title}</h2>
        <ul class="flex flex-col border-y border-line">
          <For each={props.rows}>{(row) => <Row row={row} />}</For>
        </ul>
      </section>
    </Show>
  );
}

// With entries Sure has not counted yet, the balance they will lead to comes first, marked `≈`. The
// delta gets a sign either way, since formatAmount signs only negatives.
function Row(props: { row: BalanceRow }) {
  const money = (decimal: string) => formatAmount(decimal, props.row.currency);
  return (
    <li class="flex items-baseline justify-between gap-3 border-b border-line py-3 px-safe last:border-b-0">
      <span class="min-w-0 truncate">{props.row.name}</span>
      <Show
        when={props.row.pending}
        fallback={<span class="shrink-0 tabular-nums">{money(props.row.balance)}</span>}
      >
        {(pending) => (
          <span class="flex shrink-0 flex-col items-end">
            <span class="tabular-nums">≈ {money(pending().projected)}</span>
            <span class="text-sm text-ink-muted tabular-nums">
              Sure {money(props.row.balance)} · {pending().delta.startsWith("-") ? "" : "+"}
              {money(pending().delta)}
            </span>
          </span>
        )}
      </Show>
    </li>
  );
}
