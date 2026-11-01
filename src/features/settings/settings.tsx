import { Show, createSignal } from "solid-js";
import type { SureSettings } from "../../api/http";
import { sameInstance, saveSettings, switchInstance } from "../../sync/settings";
import { type CheckResult, checkConnection } from "./check";

interface SettingsProps {
  settings: SureSettings | undefined;
  paused: boolean;
  /** Absent on first run: without settings there is nothing to go back to. */
  onClose?: () => void;
  onSaved: () => void;
}

interface Unsent {
  next: SureSettings;
  count: number;
}

export function Settings(props: SettingsProps) {
  const [busy, setBusy] = createSignal<"checking" | "saving">();
  const [failure, setFailure] = createSignal<string>();
  // Set while the user decides what happens to the entries the current instance has not received.
  const [unsent, setUnsent] = createSignal<Unsent>();

  async function submit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = {
      baseUrl: String(form.get("baseUrl")).trim(),
      apiKey: String(form.get("apiKey")).trim(),
    };
    setFailure(undefined);
    setBusy("checking");
    let result: CheckResult;
    try {
      result = await checkConnection(next);
    } finally {
      setBusy(undefined);
    }
    if (!result.ok) return setFailure(describe(result, next.baseUrl));

    // A new key for the same URL keeps everything; another URL may be another instance.
    if (!props.settings || sameInstance(props.settings.baseUrl, next.baseUrl)) {
      await saveSettings(next);
      return saved();
    }
    await switchTo(next, 0);
  }

  // Waits for a sync run that is still talking to the old instance.
  async function switchTo(next: SureSettings, allowedUnsent: number) {
    setUnsent(undefined);
    setBusy("saving");
    let refused: { unsent: number } | undefined;
    try {
      refused = await switchInstance(next, allowedUnsent);
    } finally {
      setBusy(undefined);
    }
    if (refused) return setUnsent({ next, count: refused.unsent });
    await saved();
  }

  async function keep(next: SureSettings) {
    setUnsent(undefined);
    await saveSettings(next);
    await saved();
  }

  async function saved() {
    // On iOS only persistent storage keeps an unsent outbox from eviction. The first save is the
    // first run, and it happens in a user gesture, which browsers that prompt for it require.
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
    props.onSaved();
  }

  return (
    <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 pt-safe px-safe pb-safe">
      <h1 class="text-2xl font-semibold">Settings</h1>
      <Show when={props.paused}>
        <p role="status" class="rounded-lg bg-warning-surface p-3 text-warning">
          Sure rejected the API key, so sync is paused. Your entries stay on this device and are
          sent once you save a key that works.
        </p>
      </Show>
      {/* The choice was made for the values checked; an edit has to be checked again. */}
      <form class="flex flex-col gap-4" onSubmit={submit} onInput={() => setUnsent(undefined)}>
        <div class="flex flex-col gap-1">
          <label class="flex flex-col gap-1 font-medium">
            Sure URL
            <input
              class="min-h-11 rounded-lg border border-line bg-surface-raised px-3 text-base font-normal"
              name="baseUrl"
              type="url"
              required
              autocomplete="url"
              placeholder="https://sure.example.com"
              aria-describedby={props.settings ? "base-url-hint" : undefined}
              defaultValue={props.settings?.baseUrl}
            />
          </label>
          <Show when={props.settings}>
            <p id="base-url-hint" class="text-sm text-ink-muted">
              Another address replaces the accounts and entries on this device with that Sure's.
            </p>
          </Show>
        </div>
        <label class="flex flex-col gap-1 font-medium">
          API key
          <input
            class="min-h-11 rounded-lg border border-line bg-surface-raised px-3 text-base font-normal"
            name="apiKey"
            type="password"
            required
            autocomplete="off"
            defaultValue={props.settings?.apiKey}
          />
        </label>
        <Show when={failure()}>
          {(message) => (
            <p role="alert" class="rounded-lg bg-danger-surface p-3 text-danger">
              {message()}
            </p>
          )}
        </Show>
        <Show
          when={unsent()}
          fallback={
            <>
              <button
                type="submit"
                class="min-h-11 rounded-lg bg-accent px-4 font-semibold text-on-accent disabled:opacity-60"
                disabled={busy() !== undefined}
              >
                {busy() === "checking" ? "Checking…" : busy() === "saving" ? "Saving…" : "Save"}
              </button>
              <Show when={props.onClose}>
                {(close) => (
                  <button
                    type="button"
                    class="min-h-11 rounded-lg border border-line px-4 font-medium"
                    onClick={() => close()()}
                  >
                    Cancel
                  </button>
                )}
              </Show>
            </>
          }
        >
          {(pending) => (
            <div role="alert" class="flex flex-col gap-3 rounded-lg bg-warning-surface p-3">
              <p class="text-warning">
                {entries(pending().count)} not been sent to {host(props.settings!.baseUrl)}. If{" "}
                {host(pending().next.baseUrl)} is the same Sure under another address, they are sent
                there. Otherwise they are deleted.
              </p>
              <button
                type="button"
                class="min-h-11 rounded-lg bg-danger px-4 font-semibold text-on-accent"
                onClick={() => void switchTo(pending().next, pending().count)}
              >
                Delete {pending().count === 1 ? "1 entry" : `${pending().count} entries`} and switch
              </button>
              <button
                type="button"
                class="min-h-11 rounded-lg border border-line px-4 font-medium"
                onClick={() => void keep(pending().next)}
              >
                It's the same Sure, keep them
              </button>
              <button
                type="button"
                class="min-h-11 rounded-lg border border-line px-4 font-medium"
                onClick={() => setUnsent(undefined)}
              >
                Cancel
              </button>
            </div>
          )}
        </Show>
      </form>
    </main>
  );
}

function host(baseUrl: string): string {
  return URL.parse(baseUrl)?.host ?? baseUrl;
}

function entries(count: number): string {
  return count === 1 ? "1 entry has" : `${count} entries have`;
}

function describe(result: CheckResult & { ok: false }, baseUrl: string): string {
  const host = URL.parse(baseUrl)?.host ?? baseUrl;
  switch (result.reason) {
    case "invalid-url":
      return "Enter the full address of your Sure instance, starting with https://.";
    case "insecure-url":
      return "This app runs over HTTPS, so the browser blocks an http:// address. Use the https:// address of your Sure instance.";
    case "offline":
      return "You are offline. Connect to the internet to check the connection.";
    case "unreachable":
      return `Cannot reach ${host}. Check the address.`;
    case "cors":
      return `${host} answered, but the browser blocked the request (CORS). If Sure is behind a reverse proxy or Cloudflare Access, let OPTIONS requests to /api/* through to Sure.`;
    case "timeout":
      return `${host} did not answer within 15 seconds. Try again.`;
    case "not-sure":
      return `${host} does not answer like Sure's API. Check the address, and that no login page is in front of /api/*.`;
    case "bad-key":
      return "Sure rejected the API key. Copy it again from Sure → Settings → API Key.";
    case "read-only":
      return "This API key is read-only. Create a key with the read_write scope in Sure → Settings → API Key.";
    case "server":
      return `Sure answered with an error (${result.status}). Try again later.`;
  }
}
