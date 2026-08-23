import { createServer } from "node:http";
import { once } from "node:events";

import type { ServerClient } from "@flagwire/sdk-node";
import { describe, expect, it, vi } from "vitest";

import { createRequestHandler } from "./server";

describe("Node API example", () => {
  it("evaluates the typed flag for the request identity", async () => {
    const evaluate = vi.fn(() => true) as unknown as ServerClient["evaluate"];
    const server = createServer(createRequestHandler({ evaluate }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");

    const response = await fetch(`http://127.0.0.1:${address.port}/checkout?user=user-42`);
    expect(await response.json()).toEqual({ enabled: true });
    expect(evaluate).toHaveBeenCalledWith("example.checkout", { key: "user-42" }, false);
    server.close();
    await once(server, "close");
  });
});
