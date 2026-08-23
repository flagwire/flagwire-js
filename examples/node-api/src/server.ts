import { createServer, type RequestListener } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createServerClient, type ServerClient } from "@flagwire/sdk-node";

import "./flags.gen";

export function createRequestHandler(flags: Pick<ServerClient, "evaluate">): RequestListener {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/checkout") {
      response.writeHead(404).end("Not found");
      return;
    }
    const userId = url.searchParams.get("user") ?? "anonymous";
    const enabled = flags.evaluate("example.checkout", { key: userId }, false);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ enabled }));
  };
}

export async function start(): Promise<void> {
  const serverKey = process.env.FLAGWIRE_SERVER_KEY;
  if (!serverKey) throw new Error("Set FLAGWIRE_SERVER_KEY before starting the example");
  const flags = createServerClient({ serverKey, stream: true });
  await flags.waitForInitialization({ timeoutMs: 5_000 });
  const server = createServer(createRequestHandler(flags));
  server.listen(Number(process.env.PORT ?? 3002));
  const close = () => server.close(() => void flags.close());
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) void start();
