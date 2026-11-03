import { For, Loading, Show, createMemo, createSignal, flush, untrack } from "solid-js";
import {
  db,
  type AccountRecord,
  type CategoryRecord,
  type MerchantRecord,
  type SuggestionRecord,
} from "../../db/schema";
import { createLiveQuery } from "../../db/live";
import { evaluateAmount } from "../../domain/calc";
import { amountScale } from "../../domain/currency";
import { todayLocal } from "../../domain/dates";
import { enqueue, type PendingWrite } from "../../sync/outbox";

export type Tab = "expense" | "income" | "transfer";

const TABS: { id: Tab; label: string }[] = [
  { id: "expense", label: "Expense" },
  { id: "income", label: "Income" },
  { id: "transfer", label: "Transfer" },
];

const OPERATORS = [
  { symbol: "+", label: "plus" },
  { symbol: "−", label: "minus" },
  { symbol: "×", label: "times" },
  { symbol: "÷", label: "divided by" },
];

const MAX_SUGGESTIONS = 5;

// The account outlives a restart so the next entry is one tap shorter; the category does not (user
// decision, TASK-12).
const ACCOUNT_KEY = "entryAccountId";

const FIELD = "min-h-11 rounded-lg border border-line bg-surface-raised px-3 text-base font-normal";

export interface EntryData {
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  merchants: MerchantRecord[];
  suggestions: SuggestionRecord[];
  rememberedAccountId: string | undefined;
}

interface Suggestion {
  name: string;
  categoryId: string | undefined;
}

export async function readEntryData(): Promise<EntryData> {
  const [accounts, categories, merchants, suggestions, remembered] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.merchants.toArray(),
    db.suggestions.toArray(),
    db.meta.get(ACCOUNT_KEY),
  ]);
  return {
    accounts: accounts.filter((account) => account.status === "active").sort(byName),
    categories: categories.sort(byName),
    merchants,
    suggestions,
    rememberedAccountId: remembered ? String(remembered.value) : undefined,
  };
}

export function Entry(props: { tab: Tab; onTabChange: (tab: Tab) => void }) {
  const data = createLiveQuery(readEntryData);
  return (
    <Loading>
      <Show
        when={data().accounts.length > 0}
        fallback={
          <p class="py-6 px-safe text-ink-muted">
            Your Sure accounts appear here after the first sync.
          </p>
        }
      >
        <EntryForm
          data={data()}
          // The tab outlives the form, which Settings unmounts, so the form reopens on the tab the
          // Recent list is filtered by.
          initial={{ tab: untrack(() => props.tab), accountId: data().rememberedAccountId }}
          onTabChange={props.onTabChange}
          onAccountChange={(id) => void db.meta.put({ key: ACCOUNT_KEY, value: id })}
          onSubmit={enqueue}
          clearAfterSubmit
        />
      </Show>
    </Loading>
  );
}

/** Where the form starts; the editor (TASK-13) fills it from an existing entry. */
export interface FormInitial {
  tab?: Tab;
  /** Sent as is when left untouched, so an edit does not round digits Sure already stores. */
  amount?: string;
  accountId?: string;
  fromId?: string;
  toId?: string;
  categoryId?: string | null;
  name?: string;
  note?: string;
  /** Only with `withDate`; otherwise the entry is dated today at submit. */
  date?: string;
}

export interface EntryFormProps {
  data: EntryData;
  tabs?: Tab[];
  initial?: FormInitial;
  /** Shown instead of the account select: PATCH cannot move a synced transaction. */
  fixedAccount?: { id: string; name: string; currency: string };
  /** Sure cannot clear a synced transaction's category or merchant. */
  keepsCategory?: boolean;
  keptMerchantName?: string;
  withDate?: boolean;
  submitLabel?: string;
  onTabChange?: (tab: Tab) => void;
  onAccountChange?: (id: string) => void;
  onSubmit: (write: PendingWrite) => Promise<unknown>;
  clearAfterSubmit?: boolean;
}

export function EntryForm(props: EntryFormProps) {
  const initial = props.initial ?? {};
  const tabs = TABS.filter((item) => (props.tabs ?? TABS.map((t) => t.id)).includes(item.id));
  const [tab, setTab] = createSignal<Tab>(initial.tab ?? tabs[0]!.id);
  const [amount, setAmount] = createSignal(initial.amount ?? "");
  const [name, setName] = createSignal(initial.name ?? "");
  const [note, setNote] = createSignal(initial.note ?? "");
  const [date, setDate] = createSignal(initial.date ?? todayLocal());
  const [error, setError] = createSignal<string>();
  const [suggesting, setSuggesting] = createSignal(false);
  // Expense and income use different categories, so each tab keeps its own.
  const startCategory = (forTab: Tab) =>
    initial.tab === forTab || (!initial.tab && forTab === "expense")
      ? (initial.categoryId ?? "")
      : "";
  const [expenseCategoryId, setExpenseCategoryId] = createSignal(startCategory("expense"));
  const [incomeCategoryId, setIncomeCategoryId] = createSignal(startCategory("income"));
  const [accountId, setAccountId] = createSignal(initial.accountId);
  // Session-only, so a transfer does not change the account the next expense defaults to.
  const [fromId, setFromId] = createSignal(initial.fromId);
  const [toId, setToId] = createSignal(initial.toId);
  let amountInput: HTMLInputElement;
  // A plain flag, not a signal: signal reads lag behind writes until the next flush, so a second
  // Enter during the write would pass a signal check.
  let saving = false;

  const account = createMemo(
    () =>
      props.fixedAccount ??
      props.data.accounts.find((a) => a.id === accountId()) ??
      props.data.accounts[0]!,
  );
  const from = createMemo(() => props.data.accounts.find((a) => a.id === fromId()) ?? account());
  // Cross-currency transfers are out of v1: Sure does not match them between manual accounts.
  const targets = createMemo(() =>
    props.data.accounts.filter((a) => a.id !== from().id && a.currency === from().currency),
  );
  const to = createMemo(() => targets().find((a) => a.id === toId()) ?? targets()[0]);
  const categoryId = () => (tab() === "income" ? incomeCategoryId() : expenseCategoryId());
  const category = createMemo(() => props.data.categories.find((c) => c.id === categoryId()));
  const candidates = createMemo(() => rank(props.data.suggestions, props.data.merchants));
  const suggestions = createMemo(() => matching(name(), candidates()));
  // PATCH drops a blank merchant_id, so a name that is not a merchant only renames the transaction.
  const keptMerchant = () =>
    props.keptMerchantName &&
    !findMerchant(name().trim(), props.data.merchants, props.data.suggestions)
      ? props.keptMerchantName
      : undefined;

  function selectCategory(id: string) {
    if (tab() === "income") setIncomeCategoryId(id);
    else setExpenseCategoryId(id);
  }

  function pick(suggestion: Suggestion) {
    setName(suggestion.name);
    setSuggesting(false);
    if (props.data.categories.some((c) => c.id === suggestion.categoryId)) {
      selectCategory(suggestion.categoryId!);
    }
  }

  function insertOperator(symbol: string) {
    const input = amountInput;
    const end = input.value.length;
    input.setRangeText(symbol, input.selectionStart ?? end, input.selectionEnd ?? end, "end");
    setAmount(input.value);
    setError(undefined);
    input.focus();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    const transfer = tab() === "transfer";
    const source = transfer ? from() : account();
    const target = to();
    if (transfer && !target) return;
    // An untouched amount is sent as is, so an edit does not round digits Sure already stores.
    const kept = initial.amount && amount() === initial.amount ? initial.amount : undefined;
    const result = kept
      ? ({ ok: true, value: kept } as const)
      : evaluateAmount(amount(), amountScale(source.currency));
    if (!result.ok) {
      setError(result.message);
      amountInput.focus();
      return;
    }
    const notes = note().trim() || null;
    const write: PendingWrite = transfer
      ? {
          op: "transfer",
          payload: {
            fromAccountId: source.id,
            toAccountId: target!.id,
            date: props.withDate ? date() : todayLocal(),
            amount: result.value,
            currency: source.currency,
            name: `${source.name} → ${target!.name}`,
            notes,
          },
        }
      : {
          op: "create",
          payload: {
            accountId: source.id,
            date: props.withDate ? date() : todayLocal(),
            amount: result.value,
            nature: tab() === "income" ? "income" : "expense",
            currency: source.currency,
            notes,
            categoryId: category()?.id ?? null,
            ...transactionName(name(), category(), tab() === "income" ? "Income" : "Expense"),
          },
        };

    saving = true;
    try {
      await props.onSubmit(write);
    } finally {
      saving = false;
    }
    if (!props.clearAfterSubmit) return;
    setAmount("");
    setNote("");
    setName("");
    setSuggesting(false);
    setError(undefined);
    flush();
    amountInput.focus();
  }

  // Sure requires a name, and a merchant can only be referenced by id: a name that matches a known
  // merchant is sent as that merchant, any other name as the transaction name alone.
  function transactionName(
    typed: string,
    chosenCategory: CategoryRecord | undefined,
    fallback: string,
  ): { name: string; merchantId: string | null } {
    const trimmed = typed.trim();
    const merchant = findMerchant(trimmed, props.data.merchants, props.data.suggestions);
    if (merchant) return { name: merchant.name, merchantId: merchant.id };
    return { name: trimmed || chosenCategory?.name || fallback, merchantId: null };
  }

  return (
    <form class="flex flex-col gap-4 py-4 px-safe" onSubmit={submit}>
      <div
        role="tablist"
        hidden={tabs.length < 2}
        class={[
          "grid gap-1 rounded-lg bg-surface-raised p-1",
          tabs.length === 3 ? "grid-cols-3" : "grid-cols-2",
        ]}
      >
        <For each={tabs}>
          {(item) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab() === item.id ? "true" : "false"}
              class={[
                "min-h-11 rounded-md font-medium",
                tab() === item.id ? "bg-accent text-on-accent" : "text-ink-muted",
              ]}
              onClick={() => {
                setTab(item.id);
                setError(undefined);
                props.onTabChange?.(item.id);
              }}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>

      <div class="flex flex-col gap-2">
        <label class="flex flex-col gap-1 font-medium">
          Amount
          <input
            ref={(el) => (amountInput = el)}
            class="min-h-11 rounded-lg border border-line bg-surface-raised px-3 text-2xl font-normal tabular-nums"
            type="text"
            inputmode="decimal"
            enterkeyhint="done"
            autocomplete="off"
            aria-invalid={error() ? "true" : undefined}
            aria-describedby={error() ? "amount-error" : undefined}
            value={amount()}
            onInput={(e) => {
              setAmount(e.currentTarget.value);
              setError(undefined);
            }}
          />
        </label>
        <div class="grid grid-cols-4 gap-2">
          <For each={OPERATORS}>
            {(operator) => (
              <button
                type="button"
                aria-label={operator.label}
                class="min-h-11 rounded-lg bg-surface-raised text-xl font-medium"
                // Keeps the focus, and with it the phone keyboard, in the amount field.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertOperator(operator.symbol)}
              >
                {operator.symbol}
              </button>
            )}
          </For>
        </div>
        <Show when={error()}>
          {(message) => (
            <p id="amount-error" role="alert" class="rounded-lg bg-danger-surface p-3 text-danger">
              {message()}
            </p>
          )}
        </Show>
      </div>

      <Show
        when={tab() === "transfer"}
        fallback={
          <>
            <Show
              when={props.fixedAccount}
              fallback={
                <AccountSelect
                  label="Account"
                  accounts={props.data.accounts}
                  selected={account()}
                  onSelect={(id) => {
                    setAccountId(id);
                    props.onAccountChange?.(id);
                  }}
                />
              }
            >
              {(fixed) => (
                <p class="flex flex-col gap-1 font-medium">
                  Account
                  <span class="font-normal text-ink-muted">
                    {fixed().name} · {fixed().currency}
                  </span>
                </p>
              )}
            </Show>
            <label class="flex flex-col gap-1 font-medium">
              Category
              <select class={FIELD} onChange={(e) => selectCategory(e.currentTarget.value)}>
                <option
                  value=""
                  selected={!category()}
                  disabled={props.keepsCategory && Boolean(initial.categoryId)}
                >
                  No category
                </option>
                <For each={props.data.categories}>
                  {(item) => (
                    <option value={item.id} selected={item.id === category()?.id}>
                      {item.name}
                    </option>
                  )}
                </For>
              </select>
            </label>
            {/* The list stays open on blur: closing it there would move the button the pointer is
                already pressing. A pick, Escape, a submit or a full known name close it. */}
            <div class="flex flex-col gap-1">
              <label class="flex flex-col gap-1 font-medium">
                Merchant
                <input
                  class={FIELD}
                  type="text"
                  autocomplete="off"
                  placeholder="Or a description"
                  value={name()}
                  onInput={(e) => {
                    const typed = e.currentTarget.value;
                    const known = candidates().find(
                      (c) => c.name.toLowerCase() === typed.toLowerCase(),
                    );
                    if (known) return pick(known);
                    setName(typed);
                    setSuggesting(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSuggesting(false);
                  }}
                />
              </label>
              <Show when={suggesting() && suggestions().length > 0}>
                <ul aria-label="Suggestions" class="flex flex-col rounded-lg border border-line">
                  <For each={suggestions()}>
                    {(suggestion) => (
                      <li>
                        <button
                          type="button"
                          class="min-h-11 w-full px-3 text-left"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(suggestion)}
                        >
                          {suggestion.name}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={keptMerchant()}>
                {(merchant) => (
                  <p class="text-sm text-ink-muted">Sure keeps the merchant {merchant()}.</p>
                )}
              </Show>
            </div>
          </>
        }
      >
        <AccountSelect
          label="From"
          accounts={props.data.accounts}
          selected={from()}
          onSelect={setFromId}
        />
        <Show
          when={to()}
          fallback={
            <p role="status" class="rounded-lg bg-warning-surface p-3 text-warning">
              No other {from().currency} account to transfer to.
            </p>
          }
        >
          {(target) => (
            <AccountSelect label="To" accounts={targets()} selected={target()} onSelect={setToId} />
          )}
        </Show>
      </Show>

      <Show when={props.withDate}>
        <label class="flex flex-col gap-1 font-medium">
          Date
          <input
            class={FIELD}
            type="date"
            required
            value={date()}
            onInput={(e) => setDate(e.currentTarget.value)}
          />
        </label>
      </Show>

      <label class="flex flex-col gap-1 font-medium">
        Note
        <input
          class={FIELD}
          type="text"
          autocomplete="off"
          value={note()}
          onInput={(e) => setNote(e.currentTarget.value)}
        />
      </label>

      <button
        type="submit"
        class="min-h-11 rounded-lg bg-accent px-4 font-semibold text-on-accent disabled:opacity-60"
        disabled={tab() === "transfer" && !to()}
      >
        {props.submitLabel ??
          (tab() === "income"
            ? "Add income"
            : tab() === "transfer"
              ? "Add transfer"
              : "Add expense")}
      </button>
    </form>
  );
}

function AccountSelect(props: {
  label: string;
  accounts: AccountRecord[];
  selected: { id: string };
  onSelect: (id: string) => void;
}) {
  return (
    <label class="flex flex-col gap-1 font-medium">
      {props.label}
      <select class={FIELD} onChange={(e) => props.onSelect(e.currentTarget.value)}>
        <For each={props.accounts}>
          {(account) => (
            <option value={account.id} selected={account.id === props.selected.id}>
              {account.name} · {account.currency}
            </option>
          )}
        </For>
      </select>
    </label>
  );
}

/**
 * Merchants with history first, most used and then most recent, so the usual pick is on top; other
 * Sure merchants follow by name.
 */
function rank(suggestions: SuggestionRecord[], merchants: MerchantRecord[]): Suggestion[] {
  const used = [...suggestions]
    .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
    .map((s) => ({ name: s.merchantName, categoryId: s.categoryId }));
  const seen = new Set(used.map((s) => s.name.toLowerCase()));
  const others = merchants
    .filter((m) => !seen.has(m.name.toLowerCase()))
    .sort(byName)
    .map((m) => ({ name: m.name, categoryId: undefined }));
  return [...used, ...others];
}

/** Names that contain `query`, those that start with it first, in rank order otherwise. */
function matching(query: string, candidates: Suggestion[]): Suggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches = candidates.filter((c) => c.name.toLowerCase().includes(needle));
  const prefixed = matches.filter((c) => c.name.toLowerCase().startsWith(needle));
  const inside = matches.filter((c) => !c.name.toLowerCase().startsWith(needle));
  return [...prefixed, ...inside].slice(0, MAX_SUGGESTIONS);
}

function findMerchant(
  name: string,
  merchants: MerchantRecord[],
  suggestions: SuggestionRecord[],
): MerchantRecord | undefined {
  const needle = name.toLowerCase();
  if (!needle) return undefined;
  const merchant = merchants.find((m) => m.name.toLowerCase() === needle);
  if (merchant) return merchant;
  const used = suggestions.find((s) => s.merchantName.toLowerCase() === needle);
  return used && { id: used.merchantId, name: used.merchantName };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
