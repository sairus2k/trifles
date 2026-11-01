import { Loading, Show, createSignal, onSettled } from "solid-js";
import type { AccountRecord, EntryPayload, TransferPayload } from "../../db/schema";
import { createLiveQuery } from "../../db/live";
import { EntryForm, readEntryData, type EntryData, type FormInitial } from "../entry/entry";
import {
  OutboxLockedError,
  discardFailed,
  editPending,
  enqueueDelete,
  enqueueUpdate,
  removePending,
  type PendingWrite,
} from "../../sync/outbox";
import type { RecentRow, RowTarget } from "./rows";

export const LOCKED_MESSAGE = "It is being sent to Sure right now. Try again once it has synced.";

const BUTTON = "min-h-11 rounded-lg px-4 font-semibold";

/** What deleting a row does; nothing for a row that may be on its way to Sure. */
export function deleteAction(target: RowTarget): (() => Promise<unknown>) | undefined {
  switch (target.kind) {
    case "pending":
      return () => removePending(target.clientId);
    case "transaction":
      return () => enqueueDelete(target.transactionId);
    case "transfer":
      return () => Promise.all(target.transactionIds.map((id) => enqueueDelete(id)));
    case "failedTransfer":
      return () => discardFailed(target.clientId);
    case "locked":
      return undefined;
  }
}

export function deleteLabel(target: RowTarget): string {
  return target.kind === "failedTransfer" ? "Dismiss" : "Delete";
}

/**
 * Runs an outbox action; a record the sync engine claimed since the row was drawn is locked, which
 * is reported instead of thrown.
 */
export async function attempt(action: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await action();
    return undefined;
  } catch (error) {
    if (error instanceof OutboxLockedError) return LOCKED_MESSAGE;
    throw error;
  }
}

export function Editor(props: { row: RecentRow; accounts: AccountRecord[]; onClose: () => void }) {
  const data = createLiveQuery(readEntryData);
  const [error, setError] = createSignal<string>();
  let dialog!: HTMLDialogElement;
  onSettled(() => dialog.showModal());

  async function run(action: () => Promise<unknown>) {
    const message = await attempt(action);
    if (message) setError(message);
    else props.onClose();
  }

  const target = props.row.target;
  const remove = deleteAction(target);
  const discard = props.row.discard;

  return (
    <dialog
      ref={(el) => (dialog = el)}
      aria-label={props.row.name}
      class="m-auto w-full max-w-md rounded-xl bg-surface p-0 text-ink"
      onClose={() => props.onClose()}
    >
      <div class="flex items-center gap-2 border-b border-line pt-3 px-safe pb-3">
        <h2 class="mr-auto min-w-0 truncate text-lg font-semibold">{props.row.name}</h2>
        <button
          type="button"
          class="min-h-11 shrink-0 rounded-lg px-3 font-medium text-accent"
          onClick={() => props.onClose()}
        >
          Close
        </button>
      </div>

      <Show when={props.row.error}>
        {(message) => (
          <p class="mx-4 mt-4 rounded-lg bg-danger-surface p-3 text-danger">{message()}</p>
        )}
      </Show>

      <Loading>
        <Form target={target} data={data()} accounts={props.accounts} onSave={run} />
      </Loading>

      <div class="flex flex-col gap-2 px-safe pb-safe">
        <Show when={error()}>
          {(message) => (
            <p role="alert" class="rounded-lg bg-danger-surface p-3 text-danger">
              {message()}
            </p>
          )}
        </Show>
        <Show when={discard.length > 0}>
          <button
            type="button"
            class={`${BUTTON} bg-surface-raised`}
            onClick={() => run(() => Promise.all(discard.map((id) => discardFailed(id))))}
          >
            Discard change
          </button>
        </Show>
        <Show when={remove}>
          {(action) => (
            <button
              type="button"
              class={`${BUTTON} bg-danger-surface text-danger`}
              onClick={() => run(action())}
            >
              {deleteLabel(target)}
            </button>
          )}
        </Show>
      </div>
    </dialog>
  );
}

function Form(props: {
  target: RowTarget;
  data: EntryData;
  accounts: AccountRecord[];
  onSave: (action: () => Promise<unknown>) => Promise<void>;
}) {
  // props.data is read only inside JSX: it may still be loading when Form is created.
  const target = props.target;
  switch (target.kind) {
    case "pending": {
      const save = (write: PendingWrite) => props.onSave(() => editPending(target.clientId, write));
      if (target.write.op === "transfer") {
        return (
          <EntryForm
            data={props.data}
            withDate
            submitLabel="Save"
            tabs={["transfer"]}
            initial={transferInitial(target.write.payload)}
            onSubmit={save}
          />
        );
      }
      const payload = target.write.payload;
      return (
        <EntryForm
          data={props.data}
          withDate
          submitLabel="Save"
          tabs={["expense", "income"]}
          initial={entryInitial(payload)}
          // The select lists active accounts only; an entry for another one keeps its account.
          fixedAccount={
            props.data.accounts.some((a) => a.id === payload.accountId)
              ? undefined
              : accountOf(payload, props.accounts)
          }
          onSubmit={save}
        />
      );
    }
    case "transaction": {
      const { values, transactionId } = target;
      return (
        <EntryForm
          data={props.data}
          withDate
          submitLabel="Save"
          tabs={["expense", "income"]}
          initial={entryInitial(values)}
          fixedAccount={accountOf(values, props.accounts)}
          keepsCategory
          keptMerchantName={props.data.merchants.find((m) => m.id === values.merchantId)?.name}
          onSubmit={(write) =>
            props.onSave(() => {
              if (write.op !== "create") throw new Error("A synced entry stays an entry");
              const { accountId: _, ...changes } = write.payload;
              return enqueueUpdate(transactionId, changes);
            })
          }
        />
      );
    }
    case "transfer":
      return (
        <p class="py-4 px-safe text-ink-muted">
          Transfers are changed in Sure: a changed leg would no longer match its pair.
        </p>
      );
    case "failedTransfer":
      return null;
    case "locked":
      return <p class="py-4 px-safe text-ink-muted">{target.reason}</p>;
  }
}

function entryInitial(values: EntryPayload): FormInitial {
  return {
    tab: values.nature,
    amount: values.amount,
    accountId: values.accountId,
    categoryId: values.categoryId,
    name: values.name,
    note: values.notes ?? "",
    date: values.date,
  };
}

function transferInitial(transfer: TransferPayload): FormInitial {
  return {
    tab: "transfer",
    amount: transfer.amount,
    fromId: transfer.fromAccountId,
    toId: transfer.toAccountId,
    note: transfer.notes ?? "",
    date: transfer.date,
  };
}

// A synced transaction keeps its own currency: PATCH ignores currency anyway.
function accountOf(values: EntryPayload, accounts: AccountRecord[]) {
  const name = accounts.find((a) => a.id === values.accountId)?.name ?? "Unknown account";
  return { id: values.accountId, name, currency: values.currency };
}
