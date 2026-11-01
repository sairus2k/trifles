import { For, Loading, Show, createMemo } from "solid-js";
import { db } from "../../db/schema";
import { createLiveQuery } from "../../db/live";
import { dayLabel, todayLocal } from "../../domain/dates";
import { formatAmount } from "../../domain/money";
import { recentDays, type RecentData, type RecentRow, type RowStatus } from "./rows";

const STATUS: Record<RowStatus, { label: string; class: string }> = {
  pending: { label: "Pending", class: "bg-warning-surface text-warning" },
  sending: { label: "Sending", class: "bg-warning-surface text-warning" },
  retrying: { label: "Retrying", class: "bg-warning-surface text-warning" },
  failed: { label: "Failed", class: "bg-danger-surface text-danger" },
};

async function readRecentData(): Promise<RecentData> {
  const [transactions, outbox, accounts, categories] = await Promise.all([
    db.transactions.toArray(),
    db.outbox.toArray(),
    db.accounts.toArray(),
    db.categories.toArray(),
  ]);
  return { transactions, outbox, accounts, categories };
}

export function Recent() {
  const data = createLiveQuery(readRecentData);
  const days = createMemo(() => recentDays(data()));
  return (
    <section aria-label="Recent transactions" class="flex flex-col gap-4 pb-safe">
      <Loading>
        <Show
          when={days().length > 0}
          fallback={<p class="px-safe text-ink-muted">No transactions yet.</p>}
        >
          <For each={days()}>
            {(day) => (
              <div class="flex flex-col">
                <h2 class="px-safe pb-1 text-sm font-semibold text-ink-muted">
                  {dayLabel(day.date, todayLocal())}
                </h2>
                <ul class="flex flex-col border-y border-line">
                  <For each={day.rows}>{(row) => <Row row={row} />}</For>
                </ul>
              </div>
            )}
          </For>
        </Show>
      </Loading>
    </section>
  );
}

function Row(props: { row: RecentRow }) {
  const amount = () => {
    const { amount, currency, transfer } = props.row;
    const sign = !transfer && !amount.startsWith("-") ? "+" : "";
    return sign + formatAmount(amount, currency);
  };
  return (
    <li class="flex min-h-11 items-start gap-3 border-b border-line py-2 px-safe last:border-b-0">
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex items-center gap-2">
          <span class="truncate">{props.row.name}</span>
          <Show when={props.row.status}>
            {(status) => (
              <span class={["shrink-0 rounded px-1.5 text-xs font-medium", STATUS[status()].class]}>
                {STATUS[status()].label}
              </span>
            )}
          </Show>
        </div>
        <span class="truncate text-sm text-ink-muted">{props.row.detail}</span>
        <Show when={props.row.error}>
          {(error) => <span class="text-sm text-danger">{error()}</span>}
        </Show>
      </div>
      <span class={["shrink-0 tabular-nums", props.row.transfer ? "text-ink-muted" : ""]}>
        {amount()}
      </span>
    </li>
  );
}
