import { Loading, Show, createSignal } from "solid-js";
import { createLiveQuery } from "./db/live";
import { Settings } from "./features/settings/settings";
import { readSyncConfig } from "./sync/settings";

export function App() {
  const config = createLiveQuery(readSyncConfig);
  const [opened, setOpened] = createSignal(false);
  // The pause the user closed Settings on: entries can still be made offline, and a later 401
  // sets a new pausedAt, which opens Settings again.
  const [closedPause, setClosedPause] = createSignal<number>();
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
          <main>
            <header>
              <h1>Sure Quick Entry</h1>
              <Show when={paused()}>
                <button type="button" onClick={() => setOpened(true)}>
                  Sync paused
                </button>
              </Show>
              <button type="button" onClick={() => setOpened(true)}>
                Settings
              </button>
            </header>
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
