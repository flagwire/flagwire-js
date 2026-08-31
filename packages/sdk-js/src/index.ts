export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ContextAttribute = string | number | boolean | string[];

export interface EvaluationContext {
  key: string;
  attributes?: Record<string, ContextAttribute>;
}

export interface EvaluationDetail<T extends JsonValue = JsonValue> {
  flagVersion: number;
  reason: string;
  value: T;
  variant: string | null;
}

export interface EvalSnapshot {
  flags: Record<string, EvaluationDetail>;
  version: number;
}

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

export type ActivationMode = "immediate" | "visible" | "manual";
export type ExposureTracking = "automatic" | "disabled";

export interface ClientOptions {
  activation?: ActivationMode;
  baseUrl?: string;
  bootstrap?: EvalSnapshot;
  clientKey: string;
  context: EvaluationContext;
  exposureTracking?: ExposureTracking;
  pollIntervalMs?: number | false;
  refreshOnFocus?: boolean;
  staleAfterMs?: number;
  stream?: boolean;
}

export interface FlagClient {
  close(): void;
  detail<K extends FlagKey>(key: K): EvaluationDetail | undefined;
  flush(): Promise<void>;
  get<K extends FlagKey, D extends JsonValue>(key: K, defaultValue: D): FlagValue<K, D>;
  on(event: "update", listener: (changedKeys: string[]) => void): () => void;
  ready(): Promise<void>;
  refresh(options?: { force?: boolean }): Promise<void>;
  setContext(context: EvaluationContext): Promise<void>;
  start(): Promise<void>;
}

const defaultBaseUrl = "https://edge.flagwire.dev";
const cacheNamespace = "fw:v2";
const automaticFlushIntervalMs = 60_000;
const slowPollIntervalMs = 300_000;
const maxQueuedEventKeys = 1_000;
const sdkHeader = "js/0.2.3";

function validSnapshot(input: unknown): input is EvalSnapshot {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<EvalSnapshot>;
  if (!Number.isInteger(value.version) || (value.version ?? -1) < 0) return false;
  if (!value.flags || typeof value.flags !== "object" || Array.isArray(value.flags)) return false;
  return Object.values(value.flags).every(
    (detail) =>
      detail !== null &&
      typeof detail === "object" &&
      Number.isInteger(detail.flagVersion) &&
      detail.flagVersion > 0 &&
      typeof detail.reason === "string" &&
      (typeof detail.variant === "string" || detail.variant === null) &&
      "value" in detail,
  );
}

function canonicalContext(input: EvaluationContext): EvaluationContext {
  const entries = Object.entries(input.attributes ?? {}).sort(([left], [right]) =>
    left > right ? 1 : -1,
  );
  if (!input.key || input.key.length > 256 || entries.length > 64) {
    throw new Error("Invalid context");
  }
  const attributes: Record<string, ContextAttribute> = {};
  for (const [name, value] of entries) {
    const invalid =
      !name ||
      name.length > 128 ||
      (typeof value === "string" && value.length > 1_024) ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      (Array.isArray(value) && (value.length > 64 || value.some((item) => item.length > 256)));
    if (invalid) throw new Error("Invalid context");
    if (Array.isArray(value)) {
      attributes[name] = [...value].sort();
    } else {
      attributes[name] = value;
    }
  }
  return entries.length ? { key: input.key, attributes } : { key: input.key };
}

function hash64(input: string): string {
  let first = 2_166_136_261;
  let second = 2_166_136_261 ^ 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619);
    second = Math.imul(second ^ code, 2_246_822_519);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function contextFingerprint(context: EvaluationContext): string {
  return hash64(JSON.stringify(context));
}

function cachePrefix(clientKey: string): string {
  return `${cacheNamespace}:${hash64(clientKey)}:`;
}

function contextCacheKey(clientKey: string, context: EvaluationContext): string {
  return `${cachePrefix(clientKey)}${contextFingerprint(context)}`;
}

function readCache(key: string): EvalSnapshot | undefined {
  try {
    const input: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return validSnapshot(input) ? input : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, snapshot: EvalSnapshot): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Storage is optional (private browsing, quota, or disabled cookies).
  }
}

function clearClientCache(clientKey: string): void {
  try {
    const prefix = cachePrefix(clientKey);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // Storage is optional.
  }
}

function changedKeys(before: EvalSnapshot | undefined, after: EvalSnapshot | undefined): string[] {
  const keys = new Set([...Object.keys(before?.flags ?? {}), ...Object.keys(after?.flags ?? {})]);
  return [...keys].filter(
    (key) => JSON.stringify(before?.flags[key]) !== JSON.stringify(after?.flags[key]),
  );
}

export function createClient(options: ClientOptions): FlagClient {
  if (!/^pk_live_[A-Za-z0-9_-]{43}$/.test(options.clientKey)) {
    throw new Error("Invalid key");
  }

  const baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/$/, "");
  const activation = options.activation ?? "visible";
  const pollIntervalMs =
    options.pollIntervalMs === false || options.pollIntervalMs === undefined
      ? false
      : Math.max(30_000, options.pollIntervalMs);
  const staleAfterMs = Math.max(30_000, options.staleAfterMs ?? 300_000);
  const listeners = new Set<(keys: string[]) => void>();
  const events = new Map<string, object>();
  const exposed = new Set<string>();
  let context = canonicalContext(options.context);
  let contextJson = JSON.stringify(context);
  let fingerprint = contextFingerprint(context);
  let storageKey = contextCacheKey(options.clientKey, context);
  let snapshot = validSnapshot(options.bootstrap) ? options.bootstrap : readCache(storageKey);
  let closed = false;
  let rejected = false;
  let activated = false;
  let activationPromise: Promise<void> | undefined;
  let generation = 0;
  let inFlight: { generation: number; promise: Promise<void> } | undefined;
  let versionInFlight: Promise<void> | undefined;
  let socket: WebSocket | undefined;
  let streamHealthy = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let eventTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let retryEvaluationAt = 0;
  let lastVersionCheckAt = 0;
  let readySettled = Boolean(snapshot);
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const readyPromise = snapshot
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });

  const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
  const emit = (before: EvalSnapshot | undefined, after: EvalSnapshot | undefined) => {
    const keys = changedKeys(before, after);
    if (keys.length) listeners.forEach((listener) => listener(keys));
  };
  const settleReady = (error?: Error) => {
    if (readySettled) return;
    readySettled = true;
    if (error) rejectReady?.(error);
    else resolveReady?.();
  };
  const request = (path: string, reason: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.clientKey}`,
        "X-FlagWire-Reason": reason,
        "X-FlagWire-SDK": sdkHeader,
        ...init.headers,
      },
    });
  const handleRejected = () => {
    const before = snapshot;
    rejected = true;
    snapshot = undefined;
    events.clear();
    clearClientCache(options.clientKey);
    socket?.close(1008);
    emit(before, undefined);
  };
  const handleRetry = (response: Response) => {
    const retryAfter = Number(response.headers.get("Retry-After"));
    retryEvaluationAt = Number.isFinite(retryAfter)
      ? Date.now() + Math.max(1, retryAfter) * 1_000
      : Date.now() + automaticFlushIntervalMs;
  };
  const assertResponse = (response: Response) => {
    if (response.status === 401 || response.status === 403) handleRejected();
    if (response.status === 429) handleRetry(response);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  };

  const evaluate = (reason: "initial" | "context" | "config" | "force" | "api") => {
    if (closed || rejected) return Promise.resolve();
    if (Date.now() < retryEvaluationAt) {
      return Promise.reject(new Error("Retry pending"));
    }
    const requestGeneration = generation;
    if (inFlight?.generation === requestGeneration) return inFlight.promise;
    const requestContext = context;
    const requestStorageKey = storageKey;
    const promise = (async () => {
      const response = await request("/v1/eval", reason, {
        body: JSON.stringify({ context: requestContext }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (requestGeneration !== generation) return;
      assertResponse(response);
      retryEvaluationAt = 0;
      const input: unknown = await response.json();
      if (!validSnapshot(input)) throw new Error("Invalid response");
      if (input.version < (snapshot?.version ?? 0)) return;
      const before = snapshot;
      snapshot = input;
      writeCache(requestStorageKey, input);
      emit(before, input);
      settleReady();
    })()
      .catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error("SDK error");
        if (!snapshot) settleReady(normalized);
        throw normalized;
      })
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = undefined;
      });
    inFlight = { generation: requestGeneration, promise };
    return promise;
  };

  const checkVersion = (reason: "activation" | "context" | "focus" | "manual" | "poll") => {
    if (closed || rejected || Date.now() < retryEvaluationAt) return Promise.resolve();
    return (versionInFlight ||= (async () => {
      const requestGeneration = generation;
      const headers: Record<string, string> = {};
      if (snapshot) headers["If-None-Match"] = `"v${snapshot.version}"`;
      const response = await request("/v1/version", reason, { headers });
      if (requestGeneration !== generation) return;
      if (response.status === 304) {
        lastVersionCheckAt = Date.now();
        return;
      }
      assertResponse(response);
      const input = (await response.json()) as { version?: unknown } | null;
      const version = input?.version as number;
      if (!Number.isInteger(version) || version < 0) {
        throw new Error("Invalid response");
      }
      lastVersionCheckAt = Date.now();
      if (!snapshot || version > snapshot.version) {
        await evaluate(snapshot ? "config" : "initial");
      }
    })().finally(() => (versionInFlight = undefined)));
  };

  const flushBatch = async () => {
    if (!activated || !events.size || (activation === "visible" && !visible())) return;
    const batch = [...events].slice(0, 100);
    batch.forEach(([key]) => events.delete(key));
    const body = batch.map(([, event]) => event);
    try {
      const response = await request("/v1/events", "api", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST",
      });
      assertResponse(response);
    } catch (error) {
      batch.forEach(([key, event]) => events.set(key, event));
      throw error;
    }
  };
  const flush = async () => {
    while (events.size && activated && (activation !== "visible" || visible())) await flushBatch();
  };
  const scheduleEvents = () => {
    if (closed || eventTimer || !events.size || (activation === "visible" && !visible())) return;
    eventTimer = setTimeout(() => {
      eventTimer = undefined;
      void flushBatch()
        .catch(() => undefined)
        .finally(scheduleEvents);
    }, automaticFlushIntervalMs);
  };
  const queueExposure = (key: string, detail: EvaluationDetail | undefined) => {
    if (options.exposureTracking === "disabled" || !detail?.variant) return;
    const eventKey = `${fingerprint}\u0000${key}\u0000${detail.flagVersion}\u0000${detail.variant}`;
    if (exposed.has(eventKey) || events.size >= maxQueuedEventKeys) return;
    exposed.add(eventKey);
    events.set(eventKey, {
      count: 1,
      flagKey: key,
      flagVersion: detail.flagVersion,
      variant: detail.variant,
    });
    scheduleEvents();
  };
  const schedulePoll = () => {
    if (pollTimer) clearTimeout(pollTimer);
    if (
      closed ||
      !activated ||
      pollIntervalMs === false ||
      (activation === "visible" && !visible())
    )
      return;
    const baseDelay = streamHealthy ? Math.max(slowPollIntervalMs, pollIntervalMs) : pollIntervalMs;
    const delay = Math.round(baseDelay * (0.9 + Math.random() * 0.2));
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      void checkVersion("poll")
        .catch(() => undefined)
        .finally(schedulePoll);
    }, delay);
  };
  const connect = () => {
    if (
      closed ||
      rejected ||
      !activated ||
      !visible() ||
      !options.stream ||
      typeof WebSocket === "undefined" ||
      socket
    )
      return;
    const url = new URL(`${baseUrl}/v1/stream`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("key", options.clientKey);
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      streamHealthy = true;
      schedulePoll();
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { t?: unknown; version?: unknown };
        if (
          message.t === "v" &&
          typeof message.version === "number" &&
          message.version > (snapshot?.version ?? 0)
        ) {
          const version = message.version;
          const update = () => {
            if (version > (snapshot?.version ?? 0)) return evaluate("config");
          };
          void (inFlight?.promise.finally(update) ?? update())?.catch(() => undefined);
        }
      } catch {
        // Ignore unknown server frames; clients never send application frames.
      }
    });
    socket.addEventListener("close", (event) => {
      socket = undefined;
      streamHealthy = false;
      schedulePoll();
      if (!closed && !rejected && visible() && event.code !== 1008) {
        reconnectTimer = setTimeout(connect, 500 + Math.random() * 4_500);
      }
    });
  };

  const start = () => {
    if (closed) return Promise.reject(new Error("client closed"));
    if (rejected) return Promise.reject(new Error("Key rejected"));
    if (activated) return activationPromise ?? Promise.resolve();
    activated = true;
    schedulePoll();
    connect();
    activationPromise = snapshot ? checkVersion("activation") : evaluate("initial");
    return activationPromise;
  };
  const refresh = async ({ force = false }: { force?: boolean } = {}) => {
    if (closed) return;
    if (!activated) {
      if (activation === "manual") return;
      await start();
      return;
    }
    if (force) await evaluate("force");
    else await checkVersion("manual");
  };
  const onFocus = () => {
    if (
      options.refreshOnFocus !== false &&
      activated &&
      visible() &&
      Date.now() - lastVersionCheckAt >= staleAfterMs
    ) {
      void checkVersion("focus").catch(() => undefined);
    }
  };
  const onVisibility = () => {
    if (!visible()) {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = undefined;
      socket?.close(1000);
      return;
    }
    if (activation === "visible" && !activated) void start().catch(() => undefined);
    else if (activated) {
      connect();
      schedulePoll();
      scheduleEvents();
      onFocus();
    }
  };

  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  if (activation === "immediate" || (activation === "visible" && visible())) {
    void start().catch(() => undefined);
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (eventTimer) clearTimeout(eventTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000);
      if (!readySettled) settleReady(new Error("client closed"));
      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (activated) void flush().catch(() => undefined);
      listeners.clear();
    },
    detail: (key) => snapshot?.flags[key],
    flush,
    get(key, defaultValue) {
      const detail = snapshot?.flags[key];
      queueExposure(key, detail);
      return (detail?.value ?? defaultValue) as FlagValue<typeof key, typeof defaultValue>;
    },
    on(_event, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready: () => readyPromise,
    refresh,
    async setContext(nextContext) {
      const canonical = canonicalContext(nextContext);
      const nextJson = JSON.stringify(canonical);
      if (nextJson === contextJson) return;
      const before = snapshot;
      generation += 1;
      context = canonical;
      contextJson = nextJson;
      fingerprint = contextFingerprint(context);
      storageKey = contextCacheKey(options.clientKey, context);
      snapshot = readCache(storageKey);
      emit(before, snapshot);
      if (!activated) return;
      if (snapshot) await checkVersion("context");
      else await evaluate("context");
    },
    start,
  };
}
