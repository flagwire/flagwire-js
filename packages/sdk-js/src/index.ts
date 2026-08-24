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

export interface ClientOptions {
  baseUrl?: string;
  bootstrap?: EvalSnapshot;
  clientKey: string;
  context: EvaluationContext;
  pollIntervalMs?: number;
  stream?: boolean;
}

export interface FlagClient {
  close(): void;
  detail<K extends FlagKey>(key: K): EvaluationDetail | undefined;
  flush(): Promise<void>;
  get<K extends FlagKey, D extends JsonValue>(key: K, defaultValue: D): FlagValue<K, D>;
  on(event: "update", listener: (changedKeys: string[]) => void): () => void;
  ready(): Promise<void>;
  setContext(context: EvaluationContext): Promise<void>;
}

const defaultBaseUrl = "https://edge.flagwire.dev";
const cacheNamespace = "flagwire:v1";
const automaticFlushIntervalMs = 60_000;
const slowPollIntervalMs = 300_000;
const maxQueuedEventKeys = 1_000;

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

function contextCacheKey(clientKey: string, context: EvaluationContext): string {
  const input = JSON.stringify(context);
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16_777_619);
  }
  return `${cacheNamespace}:${clientKey.slice(-12)}:${(hash >>> 0).toString(36)}`;
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

function removeCache(key: string): void {
  try {
    localStorage.removeItem(key);
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
    throw new Error("FlagWire browser clients require a valid pk_live_ client key");
  }
  if (!options.context.key) throw new Error("FlagWire context.key cannot be empty");

  const baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/$/, "");
  const listeners = new Set<(keys: string[]) => void>();
  const events = new Map<string, number>();
  let context = options.context;
  let storageKey = contextCacheKey(options.clientKey, context);
  let snapshot = validSnapshot(options.bootstrap) ? options.bootstrap : readCache(storageKey);
  let closed = false;
  let generation = 0;
  let inFlight: { generation: number; promise: Promise<void> } | undefined;
  let socket: WebSocket | undefined;
  let streamHealthy = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let eventTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let retryEvaluationAt = 0;
  let lastAutomaticFlushAt = 0;

  const emit = (before: EvalSnapshot | undefined, after: EvalSnapshot | undefined) => {
    const keys = changedKeys(before, after);
    if (keys.length > 0) listeners.forEach((listener) => listener(keys));
  };

  const request = (path: string, init: RequestInit) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${options.clientKey}`, ...init.headers },
    });

  const refresh = () => {
    if (closed) return Promise.resolve();
    if (Date.now() < retryEvaluationAt) return Promise.resolve();
    const requestGeneration = generation;
    if (inFlight?.generation === requestGeneration) return inFlight.promise;
    const requestContext = context;
    const requestStorageKey = storageKey;
    const promise = (async () => {
      const response = await request("/v1/eval", {
        body: JSON.stringify({ context: requestContext }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (requestGeneration !== generation) return;
      if (response.status === 401 || response.status === 403) {
        const before = snapshot;
        snapshot = undefined;
        removeCache(requestStorageKey);
        socket?.close(1008, "SDK key rejected");
        emit(before, undefined);
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        retryEvaluationAt = Number.isFinite(retryAfter)
          ? Date.now() + Math.max(1, retryAfter) * 1_000
          : Date.now() + automaticFlushIntervalMs;
      }
      if (!response.ok) throw new Error(`FlagWire evaluation failed with HTTP ${response.status}`);
      retryEvaluationAt = 0;
      const input: unknown = await response.json();
      if (!validSnapshot(input))
        throw new Error("FlagWire returned an invalid evaluation snapshot");
      if (input.version < (snapshot?.version ?? 0)) return;
      const before = snapshot;
      snapshot = input;
      writeCache(requestStorageKey, input);
      emit(before, input);
    })().finally(() => {
      if (inFlight?.promise === promise) inFlight = undefined;
    });
    inFlight = { generation: requestGeneration, promise };
    return promise;
  };

  const queueExposure = (key: string, detail: EvaluationDetail | undefined) => {
    if (!detail?.variant) return;
    const eventKey = `${key}\u0000${detail.flagVersion}\u0000${detail.variant}`;
    if (!events.has(eventKey) && events.size >= maxQueuedEventKeys) return;
    events.set(eventKey, (events.get(eventKey) ?? 0) + 1);
    if (events.size >= 100) void automaticFlush().catch(() => undefined);
  };

  const flushBatch = async () => {
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
        keepalive: true,
        method: "POST",
      });
      if (!response.ok) throw new Error(`FlagWire event flush failed with HTTP ${response.status}`);
    } catch (error) {
      batch.forEach(([key, count]) => events.set(key, (events.get(key) ?? 0) + count));
      throw error;
    }
  };

  const flush = async () => {
    while (events.size > 0) await flushBatch();
  };

  const automaticFlush = async () => {
    if (Date.now() - lastAutomaticFlushAt < automaticFlushIntervalMs) return;
    lastAutomaticFlushAt = Date.now();
    await flushBatch();
  };

  const pollIntervalMs = Math.max(1_000, options.pollIntervalMs ?? 60_000);
  const schedulePoll = () => {
    if (closed) return;
    if (pollTimer) clearTimeout(pollTimer);
    const delay = streamHealthy ? Math.max(slowPollIntervalMs, pollIntervalMs) : pollIntervalMs;
    pollTimer = setTimeout(() => {
      void refresh()
        .catch(() => undefined)
        .finally(schedulePoll);
    }, delay);
  };

  const scheduleEvents = () => {
    if (closed) return;
    eventTimer = setTimeout(() => {
      void automaticFlush()
        .catch(() => undefined)
        .finally(scheduleEvents);
    }, automaticFlushIntervalMs);
  };

  const connect = () => {
    if (closed || !options.stream || typeof WebSocket === "undefined") return;
    const url = new URL(`${baseUrl}/v1/stream`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("key", options.clientKey);
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      streamHealthy = true;
      reconnectAttempt = 0;
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
          void refresh().catch(() => undefined);
        }
      } catch {
        // Ignore unknown server frames; clients never send application frames.
      }
    });
    socket.addEventListener("close", (event) => {
      socket = undefined;
      streamHealthy = false;
      schedulePoll();
      if (!closed && event.code !== 1008) {
        const delay = Math.min(30_000, 500 * 2 ** reconnectAttempt++);
        reconnectTimer = setTimeout(connect, delay);
      }
    });
  };

  const initial = snapshot ? Promise.resolve() : refresh();
  if (snapshot) void refresh().catch(() => undefined);
  schedulePoll();
  scheduleEvents();
  const onFocus = () => {
    if (!streamHealthy) void refresh().catch(() => undefined);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") void automaticFlush().catch(() => undefined);
  };
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  connect();

  return {
    close() {
      if (closed) return;
      closed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (eventTimer) clearTimeout(eventTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "Client closed");
      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      void flush().catch(() => undefined);
      listeners.clear();
    },
    detail(key) {
      return snapshot?.flags[key];
    },
    flush,
    get(key, defaultValue) {
      const detail = snapshot?.flags[key];
      queueExposure(key, detail);
      return (detail?.value ?? defaultValue) as FlagValue<typeof key, typeof defaultValue>;
    },
    on(event, listener) {
      if (event !== "update") return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready: () => initial,
    async setContext(nextContext) {
      if (!nextContext.key) throw new Error("FlagWire context.key cannot be empty");
      const nextStorageKey = contextCacheKey(options.clientKey, nextContext);
      if (nextStorageKey === storageKey) {
        context = nextContext;
        await refresh();
        return;
      }
      const before = snapshot;
      generation += 1;
      context = nextContext;
      storageKey = nextStorageKey;
      snapshot = readCache(storageKey);
      emit(before, snapshot);
      await refresh();
    },
  };
}
