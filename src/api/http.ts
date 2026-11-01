export type SureSettings = { baseUrl: string; apiKey: string };

export type SureErrorKind = "not-configured" | "network" | "http" | "not-json";

export class SureError extends Error {
  override name = "SureError";

  constructor(
    readonly kind: SureErrorKind,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

let settings: SureSettings | undefined;

export function configureSure(next: SureSettings | undefined) {
  settings = next;
}

// The generated response unions only list statuses the spec declares (POST /transactions: 200, 201, 422).
// These are rarely declared, a proxy may answer them with HTML, and sync handles each as a class
// (pause on 401, back off on 429 and 5xx), so they are thrown instead of returned under a false type.
function isThrownStatus(status: number) {
  return status === 401 || status === 429 || status >= 500;
}

function isJson(contentType: string | null) {
  return contentType !== null && /^application\/([\w.+-]+\+)?json\b/i.test(contentType);
}

export interface SureRequestInit extends RequestInit {
  /** Overrides the configured settings for this request, so Settings can check a key before saving it. */
  settings?: SureSettings;
}

/** orval mutator: the generated client calls it with a path such as `/api/v1/transactions`. */
export async function sureFetch<T>(
  path: string,
  { settings: own, ...init }: SureRequestInit = {},
): Promise<T> {
  const target = own ?? settings;
  if (!target) {
    throw new SureError("not-configured", "The Sure instance URL and API key are not set");
  }
  const { baseUrl, apiKey } = target;
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  headers.set("X-Api-Key", apiKey);

  let res: Response;
  let body: string;
  try {
    // Concatenate rather than `new URL(path, base)` so an instance served under a subpath keeps it.
    res = await fetch(baseUrl.replace(/\/+$/, "") + path, { ...init, headers });
    body = await res.text();
  } catch (cause) {
    throw new SureError("network", `${method} ${path} failed to complete`, undefined, { cause });
  }

  if (isThrownStatus(res.status)) {
    throw new SureError("http", `${method} ${path} failed with status ${res.status}`, res.status);
  }
  if (!isJson(res.headers.get("content-type"))) {
    throw new SureError("not-json", `${method} ${path} returned a non-JSON response`, res.status);
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (cause) {
    throw new SureError("not-json", `${method} ${path} returned malformed JSON`, res.status, {
      cause,
    });
  }
  return { status: res.status, data, headers: res.headers } as T;
}
