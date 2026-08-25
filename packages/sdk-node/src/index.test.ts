import { afterEach, describe, expect, it, vi } from "vitest";

import vector from "../../evaluate/vectors/eval/fail-safe-07.json";

import { createServerClient } from "./index";

const serverKey = `sk_live_${"s".repeat(43)}`;

function bundleResponse() {
  return new Response(JSON.stringify(vector.bundle), {
    headers: { "Content-Type": "application/json", ETag: '"v7"' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("server client", () => {
  it("initializes from a bundle and runs the shared evaluator locally", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      return url.endsWith("/v1/events") ? new Response(null, { status: 202 }) : bundleResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createServerClient({ serverKey, stream: false });

    await client.waitForInitialization({ timeoutMs: 1_000 });
    expect(client.evaluateDetail("test-flag", vector.context, false)).toEqual(vector.expected);
    expect(client.evaluate("test-flag", vector.context, false)).toBe(true);
    expect(client.browserSnapshot(vector.context)).toEqual({
      flags: {
        "test-flag": {
          flagVersion: vector.bundle.flags["test-flag"].version,
          reason: vector.expected.reason,
          value: vector.expected.value,
          variant: vector.expected.variantKey,
        },
      },
      version: vector.bundle.version,
    });
    expect(client.allFlags(vector.context)).toEqual({ "test-flag": true });
    await client.flush();

    const eventsCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/v1/events"));
    expect(eventsCall).toBeDefined();
    expect(JSON.parse(String(eventsCall?.[1]?.body))).toEqual([
      { count: 3, flagKey: "test-flag", flagVersion: 3, variant: "on" },
    ]);
    await client.close();
  });

  it("sends If-None-Match and keeps the last bundle on 304", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bundleResponse())
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createServerClient({ pollIntervalMs: 1_000, serverKey, stream: false });
    await client.waitForInitialization();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(headers.get("If-None-Match")).toBe('"v7"');
    expect(client.evaluate("test-flag", vector.context, false)).toBe(true);
    await client.close();
  });

  it("fails closed to code defaults after the server key is rejected", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bundleResponse())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createServerClient({ pollIntervalMs: 1_000, serverKey, stream: false });
    await client.waitForInitialization();
    expect(client.evaluate("test-flag", vector.context, false)).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.evaluateDetail("test-flag", vector.context, false)).toEqual({
      reason: "ERROR",
      value: false,
      variantKey: null,
    });
    await client.close();
  });

  it("times out deterministically while the initial network request is unavailable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const client = createServerClient({ serverKey, stream: false });
    const initialization = client.waitForInitialization({ timeoutMs: 500 });
    const expectation = expect(initialization).rejects.toThrow("timed out after 500ms");

    await vi.advanceTimersByTimeAsync(500);
    await expectation;
    expect(client.evaluate("missing", { key: "user" }, "safe")).toBe("safe");
    await client.close();
  });

  it("restores a failed exposure batch and retries it without losing counts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bundleResponse())
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createServerClient({ serverKey, stream: false });
    await client.waitForInitialization();
    client.evaluate("test-flag", vector.context, false);

    await expect(client.flush()).rejects.toThrow("HTTP 503");
    await client.flush();
    const eventCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/events"));
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0]?.[1]?.body).toEqual(eventCalls[1]?.[1]?.body);
    await client.close();
  });

  it("drains queued exposure events during an orderly close", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/v1/events") ? new Response(null, { status: 202 }) : bundleResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createServerClient({ serverKey, stream: false });
    await client.waitForInitialization();
    client.evaluate("test-flag", vector.context, false);

    await client.close();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/events"))).toHaveLength(
      1,
    );
  });
});
