import {
  evaluateBundle,
  evaluateFlag,
  type EvaluationDetail,
  type EvaluationReason,
} from "@flagwire/evaluate";
import {
  bundleSchema,
  type Bundle,
  type EvaluationContext,
  type JsonValue,
} from "@flagwire/schema";

export type { EvaluationContext, EvaluationDetail, EvaluationReason, JsonValue };

/** Augmented by flags.gen.ts. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging registry
export interface FlagwireFlags {}

export type FlagKey = keyof FlagwireFlags extends never
  ? string
  : Extract<keyof FlagwireFlags, string>;

export type FlagValue<K extends string, D extends JsonValue> = K extends keyof FlagwireFlags
  ? FlagwireFlags[K] extends JsonValue
    ? FlagwireFlags[K]
    : D
  : D;

export interface ServerClientOptions {
  baseUrl?: string;
  pollIntervalMs?: number;
  serverKey: string;
  stream?: boolean;
}

export interface ServerClient {
  allFlags(context: EvaluationContext): Record<string, JsonValue>;
  close(): Promise<void>;
  evaluate<K extends FlagKey, D extends JsonValue>(
    key: K,
    context: EvaluationContext,
    defaultValue: D,
  ): FlagValue<K, D>;
  evaluateDetail<K extends FlagKey, D extends JsonValue>(
    key: K,
    context: EvaluationContext,
    defaultValue: D,
  ): EvaluationDetail;
  flush(): Promise<void>;
  waitForInitialization(options?: { timeoutMs?: number }): Promise<void>;
}

const defaultBaseUrl = "https://edge.flagwire.dev";
const slowPollIntervalMs = 300_000;

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const candidate: unknown = timer;
  if (typeof candidate !== "object" || candidate === null || !("unref" in candidate)) return;
  const unref = (candidate as { unref?: unknown }).unref;
  if (typeof unref === "function") unref.call(candidate);
}

function errorDetail(defaultValue: JsonValue): EvaluationDetail {
  return { reason: "ERROR", value: defaultValue, variantKey: null };
}

export function createServerClient(options: ServerClientOptions): ServerClient {
  if (!/^sk_live_[A-Za-z0-9_-]{43}$/.test(options.serverKey)) {
    throw new Error("FlagWire server clients require a valid sk_live_ server key");
  }
  const baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/$/, "");
  const pollIntervalMs = Math.max(1_000, options.pollIntervalMs ?? 30_000);
  const events = new Map<string, number>();
  let bundle: Bundle | undefined;
  let etag: string | undefined;
  let closed = false;
  let revokedKey = false;
  let streamHealthy = false;
  let socket: WebSocket | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let eventTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let inFlight: Promise<void> | undefined;
  let initialized = false;
  let resolveInitialized: (() => void) | undefined;
  const initializedPromise = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });

  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${options.serverKey}`, ...init.headers },
    });

  const schedulePoll = () => {
    if (closed) return;
    if (pollTimer) clearTimeout(pollTimer);
    const delay =
      bundle?.revoked || revokedKey || streamHealthy ? slowPollIntervalMs : pollIntervalMs;
    pollTimer = setTimeout(() => void refresh().catch(() => undefined), delay);
    unrefTimer(pollTimer);
  };

  const refresh = () => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const headers: Record<string, string> = {};
      if (etag) headers["If-None-Match"] = etag;
      const response = await request("/v1/bundle", { headers });
      if (response.status === 304) {
        revokedKey = false;
        return;
      }
      if (response.status === 401 || response.status === 403) {
        bundle = undefined;
        etag = undefined;
        revokedKey = true;
        socket?.close(1008, "SDK key rejected");
        return;
      }
      if (!response.ok)
        throw new Error(`FlagWire bundle fetch failed with HTTP ${response.status}`);
      const input: unknown = await response.json();
      const parsed = bundleSchema.safeParse(input);
      if (!parsed.success) throw new Error("FlagWire returned an invalid environment bundle");
      if (parsed.data.version < (bundle?.version ?? 0)) return;
      bundle = parsed.data;
      etag = response.headers.get("ETag") ?? `"v${parsed.data.version}"`;
      revokedKey = false;
      if (!initialized) {
        initialized = true;
        resolveInitialized?.();
      }
    })().finally(() => {
      inFlight = undefined;
      schedulePoll();
    });
    return inFlight;
  };

  const queueExposure = (flagKey: string, detail: EvaluationDetail) => {
    const flagVersion = bundle?.flags[flagKey]?.version;
    if (!flagVersion || !detail.variantKey) return;
    const key = `${flagKey}\u0000${flagVersion}\u0000${detail.variantKey}`;
    events.set(key, (events.get(key) ?? 0) + 1);
    if (events.size >= 100) void flush().catch(() => undefined);
  };

  const flush = async () => {
    if (events.size === 0) return;
    const batch = [...events].slice(0, 100);
    batch.forEach(([key]) => events.delete(key));
    const body = batch.map(([key, count]) => {
      const [flagKey, flagVersion, variant] = key.split("\u0000");
      return { count, flagKey, flagVersion: Number(flagVersion), variant };
    });
    try {
      const response = await request("/v1/events", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(`FlagWire event flush failed with HTTP ${response.status}`);
    } catch (error) {
      batch.forEach(([key, count]) => events.set(key, (events.get(key) ?? 0) + count));
      throw error;
    }
    if (events.size > 0) await flush();
  };

  const scheduleEvents = () => {
    if (closed) return;
    eventTimer = setTimeout(() => {
      void flush()
        .catch(() => undefined)
        .finally(scheduleEvents);
    }, 10_000);
    unrefTimer(eventTimer);
  };

  const connect = () => {
    if (closed || options.stream === false || typeof WebSocket === "undefined" || revokedKey)
      return;
    const url = new URL(`${baseUrl}/v1/stream`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("key", options.serverKey);
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      streamHealthy = true;
      reconnectAttempt = 0;
      void refresh().catch(() => undefined);
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { t?: unknown; version?: unknown };
        if (
          message.t === "v" &&
          typeof message.version === "number" &&
          message.version > (bundle?.version ?? 0)
        ) {
          void refresh().catch(() => undefined);
        }
      } catch {
        // Ignore unknown server frames; SDK clients never send application frames.
      }
    });
    socket.addEventListener("close", () => {
      socket = undefined;
      streamHealthy = false;
      schedulePoll();
      if (!closed && !revokedKey) {
        const delay = Math.min(30_000, 500 * 2 ** reconnectAttempt++);
        reconnectTimer = setTimeout(connect, delay);
        unrefTimer(reconnectTimer);
      }
    });
  };

  void refresh().catch(() => undefined);
  scheduleEvents();
  connect();

  const evaluateDetail = <K extends FlagKey, D extends JsonValue>(
    key: K,
    context: EvaluationContext,
    defaultValue: D,
  ) => {
    const detail = bundle
      ? evaluateFlag(bundle, key, context, defaultValue)
      : errorDetail(defaultValue);
    queueExposure(key, detail);
    return detail;
  };

  return {
    allFlags(context) {
      if (!bundle) return {};
      const snapshot = evaluateBundle(bundle, context);
      return Object.fromEntries(
        Object.entries(snapshot.flags).map(([key, detail]) => {
          queueExposure(key, detail);
          return [key, detail.value];
        }),
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (eventTimer) clearTimeout(eventTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "Client closed");
      await flush();
    },
    evaluate(key, context, defaultValue) {
      return evaluateDetail(key, context, defaultValue).value as FlagValue<
        typeof key,
        typeof defaultValue
      >;
    },
    evaluateDetail,
    flush,
    waitForInitialization({ timeoutMs } = {}) {
      if (initialized) return Promise.resolve();
      if (timeoutMs === undefined) return initializedPromise;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return Promise.reject(new Error("timeoutMs must be a positive finite number"));
      }
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`FlagWire initialization timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        initializedPromise.then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
