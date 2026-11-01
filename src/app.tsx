import { Loading, Show, createSignal } from "solid-js";
import { createLiveQuery } from "./db/live";
import { Balances } from "./features/balances/balances";
import { Entry } from "./features/entry/entry";
import { Recent } from "./features/recent/recent";
import { Settings } from "./features/settings/settings";
import { readSyncConfig } from "./sync/settings";

export function App() {
  const config = createLiveQuery(readSyncConfig);
  const [opened, setOpened] = createSignal(false);
  // The pause the user closed Settings on: entries can still be made offline, and a later 401
  // sets a new pausedAt, which opens Settings again.
  const [closedPause, setClosedPause] = createSignal<number>();
  const [balances, setBalances] = createSignal(false);
  const paused = () => config().pausedAt !== undefined;
  const showSettings = () =>
    !config().settings || opened() || (paused() && config().pausedAt !== closedPause());

  function close() {
    setOpened(false);
    setClosedPause(config().pausedAt);
  }

  return (
    <Loading>
      <Show
        when={showSettings()}
        fallback={
          <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col">
            <header class="sticky top-0 flex items-center gap-2 border-b border-line bg-surface pt-safe px-safe pb-3">
              <h1 class="mr-auto min-w-0 truncate text-lg font-semibold">Sure Quick Entry</h1>
              <Show when={paused()}>
                <button
                  type="button"
                  class="min-h-11 shrink-0 rounded-lg bg-warning-surface px-3 font-medium text-warning"
                  onClick={() => setOpened(true)}
                >
                  Sync paused
                </button>
              </Show>
              <button
                type="button"
                class="min-h-11 shrink-0 rounded-lg px-3 font-medium text-accent"
                onClick={() => setBalances(!balances())}
              >
                {balances() ? "Entry" : "Balances"}
              </button>
              <button
                type="button"
                class="min-h-11 shrink-0 rounded-lg px-3 font-medium text-accent"
                onClick={() => setOpened(true)}
              >
                Settings
              </button>
            </header>
            {/* Hidden, not unmounted, so an amount typed before a look at the balances is still there. */}
            <div hidden={balances()} class="contents">
              <Entry />
              <Recent />
            </div>
            <Show when={balances()}>
              <Balances />
            </Show>
          </main>
        }
      >
        <Settings
          settings={config().settings}
          paused={paused()}
          onClose={config().settings ? close : undefined}
          onSaved={close}
        />
      </Show>
    </Loading>
  );
}
