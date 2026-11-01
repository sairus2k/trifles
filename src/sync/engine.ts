import { liveQuery } from "dexie";
import { SureError, configureSure } from "../api/http";
import { headRetryAt, onOutboxWrite, requeueStuck, retryNow } from "./outbox";
import { pullRecent, pullReference } from "./pull";
import { push } from "./push";
import { pauseSync, readSyncConfig, type SyncConfig } from "./settings";

// Runs push and pull at the right moments without the Background Sync API, which iOS lacks: on start,
// when the connection or the app comes back, after every write and on a timer while the app is open.

const TICK_MS = 60_000;
const LOCK = "outbox";

interface Run {
  /** Also pull recent transactions when nothing was sent, to pick up balances and other clients. */
  full: boolean;
  /** End every backoff first. */
  retry: boolean;
}

export interface SyncEngine {
  stop(): void;
}

export function startSync(): SyncEngine {
  let config: SyncConfig | undefined;
  let referencePulled = false;
  let queued: Run | undefined;
  let running = false;
  let stopped = false;
  let wakeUp: ReturnType<typeof setTimeout> | undefined;

  // Several triggers often fire together (start and visible, enqueue and online): they merge into
  // the one run still waiting, so a tab never has more than one run in flight and one queued.
  function request(run: Partial<Run>) {
    if (stopped) return;
    queued = {
      full: Boolean(queued?.full || run.full),
      retry: Boolean(queued?.retry || run.retry),
    };
    if (!running) void drain();
  }

  async function drain() {
    running = true;
    while (queued && !stopped) {
      const run = queued;
      queued = undefined;
      try {
        await sync(run);
      } catch (error) {
        console.error("Sync failed", error);
      }
    }
    running = false;
  }

  async function sync({ full, retry }: Run) {
    if (!config?.settings || config.pausedAt !== undefined || navigator.onLine === false) return;
    // Other tabs wait here, so only one of them processes the queue at a time.
    await navigator.locks.request(LOCK, async () => {
      await requeueStuck();
      if (retry) await retryNow();
      const { sent, paused } = await push();
      if (paused) return pauseSync();
      try {
        if (!referencePulled) {
          await pullReference();
          referencePulled = true;
        }
        if (sent > 0 || full) await pullRecent();
      } catch (error) {
        if (!(error instanceof SureError)) throw error;
        if (isRejected(error)) await pauseSync();
        // Otherwise offline or a server error: the next trigger pulls again.
      }
    });
    // A timer tick could be a minute away; the backoff decides when the head is due.
    clearTimeout(wakeUp);
    const retryAt = await headRetryAt();
    if (retryAt !== undefined && !stopped) {
      wakeUp = setTimeout(() => request({}), retryAt - Date.now());
    }
  }

  // Settings live in meta, so a save in any tab reaches this one. The first answer is the start
  // trigger, and saving settings lifts a pause.
  const settings = liveQuery(readSyncConfig).subscribe({
    next(next) {
      config = next;
      configureSure(next.settings);
      request({ full: true });
    },
    error: (error) => console.error("Reading the sync settings failed", error),
  });
  const onOnline = () => request({ full: true, retry: true });
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") request({ full: true });
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const unsubscribeWrites = onOutboxWrite(() => request({}));
  const tick = setInterval(() => {
    if (document.visibilityState === "visible") request({ full: true });
  }, TICK_MS);

  return {
    stop() {
      stopped = true;
      settings.unsubscribe();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribeWrites();
      clearInterval(tick);
      clearTimeout(wakeUp);
    },
  };
}

// 401: a wrong or revoked key; 403: a read-only key. Neither changes until the settings do.
function isRejected(error: SureError): boolean {
  return error.kind === "not-configured" || error.status === 401 || error.status === 403;
}
