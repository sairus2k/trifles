import { Show, createSignal } from "solid-js";
import type { SureSettings } from "../../api/http";
import { saveSettings } from "../../sync/settings";
import { type CheckResult, checkConnection } from "./check";

interface SettingsProps {
  settings: SureSettings | undefined;
  paused: boolean;
  /** Absent on first run: without settings there is nothing to go back to. */
  onClose?: () => void;
  onSaved: () => void;
}

export function Settings(props: SettingsProps) {
  const [checking, setChecking] = createSignal(false);
  const [failure, setFailure] = createSignal<string>();

  async function submit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = {
      baseUrl: String(form.get("baseUrl")).trim(),
      apiKey: String(form.get("apiKey")).trim(),
    };
    setFailure(undefined);
    setChecking(true);
    let result: CheckResult;
    try {
      result = await checkConnection(next);
    } finally {
      setChecking(false);
    }
    if (!result.ok) return setFailure(describe(result, next.baseUrl));

    await saveSettings(next);
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
      <form class="flex flex-col gap-4" onSubmit={submit}>
        <label class="flex flex-col gap-1 font-medium">
          Sure URL
          <input
            class="min-h-11 rounded-lg border border-line bg-surface-raised px-3 text-base font-normal"
            name="baseUrl"
            type="url"
            required
            autocomplete="url"
            placeholder="https://sure.example.com"
            defaultValue={props.settings?.baseUrl}
          />
        </label>
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
        <button
          type="submit"
          class="min-h-11 rounded-lg bg-accent px-4 font-semibold text-on-accent disabled:opacity-60"
          disabled={checking()}
        >
          {checking() ? "Checking…" : "Save"}
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
      </form>
    </main>
  );
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
