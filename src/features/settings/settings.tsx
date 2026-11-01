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
    <main>
      <h1>Settings</h1>
      <Show when={props.paused}>
        <p role="status">
          Sure rejected the API key, so sync is paused. Your entries stay on this device and are
          sent once you save a key that works.
        </p>
      </Show>
      <form onSubmit={submit}>
        <label>
          Sure URL
          <input
            name="baseUrl"
            type="url"
            required
            autocomplete="url"
            placeholder="https://sure.example.com"
            defaultValue={props.settings?.baseUrl}
          />
        </label>
        <label>
          API key
          <input
            name="apiKey"
            type="password"
            required
            autocomplete="off"
            defaultValue={props.settings?.apiKey}
          />
        </label>
        <Show when={failure()}>{(message) => <p role="alert">{message()}</p>}</Show>
        <button type="submit" disabled={checking()}>
          {checking() ? "Checking…" : "Save"}
        </button>
        <Show when={props.onClose}>
          {(close) => (
            <button type="button" onClick={() => close()()}>
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
