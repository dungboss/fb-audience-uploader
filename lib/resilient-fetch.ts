// Resilient wrapper around `fetch` for flaky upstreams (NAS WebDAV, Meta Graph
// API). Node's built-in fetch (undici) surfaces transient socket drops as an
// opaque `TypeError: terminated` whose real reason hides in `error.cause`.
// This helper adds three things the bare calls lacked:
//   1. a per-attempt timeout (so a stalled socket fails fast instead of hanging),
//   2. automatic retry on transient connection errors with exponential backoff,
//   3. logging that ALWAYS includes `error.cause` so failures can be diagnosed.

export interface ResilientFetchOptions {
  /** Short label for logs, e.g. "meta-graph" or "webdav-range". */
  label: string;
  /** Abort a single attempt after this many ms. */
  timeoutMs?: number;
  /** Max attempts including the first. */
  maxAttempts?: number;
  /** Base backoff between attempts in ms (doubles each retry). */
  baseDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;

// undici / Node network error codes that are safe to retry (transient drops).
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

export async function resilientFetch(
  url: string | URL,
  init: RequestInit,
  options: ResilientFetchOptions
): Promise<Response> {
  const {
    label,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      const detail = describeFetchError(error);

      if (attempt >= maxAttempts || !isTransientFetchError(error)) {
        console.error(
          `[resilient-fetch] ${label} failed on attempt ${attempt}/${maxAttempts}: ${detail}`
        );
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[resilient-fetch] ${label} transient error on attempt ${attempt}/${maxAttempts} (${detail}); retrying in ${delayMs}ms`
      );
      await waitFor(delayMs);
    }
  }

  throw lastError;
}

// True for connection-level failures that are worth retrying (vs. a real HTTP
// error response, which `fetch` resolves normally and never throws for).
export function isTransientFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Our own per-attempt timeout (AbortSignal.timeout) throws TimeoutError.
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;
  const code = extractErrorCode(error) ?? extractErrorCode(cause);
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  const message = `${error.message} ${causeMessage(cause)}`.toLowerCase();
  return /terminated|socket hang up|other side closed|network|reset|timeout/.test(
    message
  );
}

// Human-readable one-liner that always includes `error.cause` — "terminated"
// alone is useless, the code/cause is what identifies the failing endpoint.
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = (error as { cause?: unknown }).cause;
  const code = extractErrorCode(error) ?? extractErrorCode(cause);
  const causeText =
    cause instanceof Error ? `${cause.name}: ${cause.message}` : causeMessage(cause);

  return [
    `${error.name}: ${error.message}`,
    code ? `code=${code}` : null,
    causeText ? `cause=${causeText}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function extractErrorCode(value: unknown): string | undefined {
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }
  return undefined;
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return "";
}

function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
