import { For, Loading, Show, createMemo, createSignal } from "solid-js";
import { db } from "../../db/schema";
import { createLiveQuery } from "../../db/live";
import { dayLabel, todayLocal } from "../../domain/dates";
import { formatAmount } from "../../domain/money";
import { Editor, attempt, deleteAction, deleteLabel } from "./editor";
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

// How far a row slides to uncover its delete button, and how far a drag must go to count as a swipe
// rather than a tap.
const REVEAL_PX = 96;
const DRAG_PX = 10;

export function Recent() {
  const data = createLiveQuery(readRecentData);
  const days = createMemo(() => recentDays(data()));
  const [editing, setEditing] = createSignal<RecentRow>();
  const [notice, setNotice] = createSignal<string>();

  async function remove(action: () => Promise<unknown>) {
    setNotice(await attempt(action));
  }

  return (
    <section aria-label="Recent transactions" class="flex flex-col gap-4 pb-safe">
      <Show when={notice()}>
        {(message) => (
          <p role="alert" class="mx-4 rounded-lg bg-danger-surface p-3 text-danger">
            {message()}
          </p>
        )}
      </Show>
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
                  <For each={day.rows}>
                    {(row) => (
                      <Row
                        row={row}
                        onOpen={() => {
                          setNotice(undefined);
                          setEditing(row);
                        }}
                        onDelete={remove}
                      />
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </Show>
        <Show when={editing()}>
          {(row) => (
            <Editor row={row()} accounts={data().accounts} onClose={() => setEditing(undefined)} />
          )}
        </Show>
      </Loading>
    </section>
  );
}

// Swiping left uncovers a delete button under the row; a tap opens the editor. `touch-action:
// pan-y` leaves vertical scrolling to the browser, which cancels the pointer when it scrolls.
function Row(props: {
  row: RecentRow;
  onOpen: () => void;
  onDelete: (action: () => Promise<unknown>) => void;
}) {
  const [offset, setOffset] = createSignal(0);
  // The handlers read `position`: signal reads lag behind writes until the next flush, and pointer
  // events can arrive before it.
  let position = 0;
  let start: { x: number; base: number } | undefined;
  let dragged = false;
  const action = () => deleteAction(props.row.target);
  const amount = () => {
    const { amount, currency, transfer } = props.row;
    const sign = !transfer && !amount.startsWith("-") ? "+" : "";
    return sign + formatAmount(amount, currency);
  };

  function slide(to: number) {
    position = to;
    setOffset(to);
  }

  function settle() {
    start = undefined;
    slide(position < -REVEAL_PX / 2 ? -REVEAL_PX : 0);
  }

  return (
    <li class="relative overflow-hidden border-b border-line last:border-b-0">
      <Show when={action()}>
        {(remove) => (
          <button
            type="button"
            class="absolute inset-y-0 right-0 bg-danger font-semibold text-on-accent"
            hidden={offset() === 0}
            style={{ width: `${REVEAL_PX}px` }}
            onClick={() => {
              slide(0);
              props.onDelete(remove());
            }}
          >
            {deleteLabel(props.row.target)}
          </button>
        )}
      </Show>
      <button
        type="button"
        class="relative flex min-h-11 w-full touch-pan-y items-start gap-3 bg-surface py-2 px-safe text-left"
        style={{ transform: `translateX(${offset()}px)` }}
        onPointerDown={(e) => {
          if (!action()) return;
          start = { x: e.clientX, base: position };
          dragged = false;
        }}
        onPointerMove={(e) => {
          if (!start) return;
          const dx = e.clientX - start.x;
          if (!dragged && Math.abs(dx) < DRAG_PX) return;
          dragged = true;
          slide(Math.min(0, Math.max(-REVEAL_PX, start.base + dx)));
        }}
        onPointerUp={() => start && settle()}
        onPointerCancel={() => start && settle()}
        onClick={() => {
          if (dragged) {
            dragged = false;
            return;
          }
          if (position < 0) return slide(0);
          props.onOpen();
        }}
      >
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex items-center gap-2">
            <span class="truncate">{props.row.name}</span>
            <Show when={props.row.status}>
              {(status) => (
                <span
                  class={["shrink-0 rounded px-1.5 text-xs font-medium", STATUS[status()].class]}
                >
                  {STATUS[status()].label}
                </span>
              )}
            </Show>
          </span>
          <span class="truncate text-sm text-ink-muted">{props.row.detail}</span>
          <Show when={props.row.error}>
            {(error) => <span class="text-sm text-danger">{error()}</span>}
          </Show>
        </span>
        <span class={["shrink-0 tabular-nums", props.row.transfer ? "text-ink-muted" : ""]}>
          {amount()}
        </span>
      </button>
    </li>
  );
}
