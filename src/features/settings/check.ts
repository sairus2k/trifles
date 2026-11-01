import { deleteApiV1TransactionsId, getApiV1Accounts } from "../../api/generated/sure";
import { SureError, type SureSettings } from "../../api/http";

const TIMEOUT_MS = 15_000;

export type CheckFailure =
  | "invalid-url"
  | "insecure-url"
  | "offline"
  | "unreachable"
  | "cors"
  | "timeout"
  | "not-sure"
  | "bad-key"
  | "read-only"
  | "server";

export type CheckResult = { ok: true } | { ok: false; reason: CheckFailure; status?: number };

/** Checks a URL and key against Sure without saving them or touching the engine's settings. */
export async function checkConnection(settings: SureSettings): Promise<CheckResult> {
  const url = URL.parse(settings.baseUrl);
  if (url?.protocol !== "https:" && url?.protocol !== "http:") return fail("invalid-url");
  // The browser blocks mixed content without telling the page why.
  if (url.protocol === "http:" && location.protocol === "https:") return fail("insecure-url");
  if (navigator.onLine === false) return fail("offline");

  try {
    const accounts = await getApiV1Accounts({ per_page: 1 }, init(settings));
    const status = accounts.status as number;
    if (status !== 200 || !Array.isArray(accounts.data?.accounts)) {
      return fail("not-sure", status);
    }
    // A read-only key reads like a read_write one. Sure checks the write scope before it looks the
    // transaction up, so deleting a random id answers 403 for a read-only key and 404 otherwise.
    const probe = await deleteApiV1TransactionsId(crypto.randomUUID(), init(settings));
    const probeStatus = probe.status as number;
    if (probeStatus === 403) return fail("read-only");
    if (probeStatus !== 404) return fail("server", probeStatus);
    return { ok: true };
  } catch (error) {
    if (!(error instanceof SureError)) throw error;
    return classify(error, settings.baseUrl);
  }
}

async function classify(error: SureError, baseUrl: string): Promise<CheckResult> {
  switch (error.kind) {
    case "http":
      return error.status === 401 ? fail("bad-key") : fail("server", error.status);
    case "not-json":
      return fail("not-sure", error.status);
    case "network":
      if (error.cause instanceof DOMException && error.cause.name === "TimeoutError") {
        return fail("timeout");
      }
      return (await answers(baseUrl)) ? fail("cors") : fail("unreachable");
    case "not-configured":
      throw error;
  }
}

// A CORS block and an unreachable host both reject with a bare TypeError. A no-cors request sends
// no X-Api-Key, so it needs no preflight, and it resolves (opaquely) whenever the host answers.
async function answers(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl.replace(/\/+$/, "") + "/api/v1/accounts", {
      mode: "no-cors",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

function init(settings: SureSettings) {
  return { settings, signal: AbortSignal.timeout(TIMEOUT_MS) };
}

function fail(reason: CheckFailure, status?: number): CheckResult {
  return status === undefined ? { ok: false, reason } : { ok: false, reason, status };
}
