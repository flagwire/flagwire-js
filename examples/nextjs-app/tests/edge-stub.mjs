/* global URL */

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const clientKey = `pk_live_${"e".repeat(43)}`;
const sockets = new Set();
let enabled = false;
let version = 1;
const cors = {
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, If-None-Match, X-FlagWire-Reason, X-FlagWire-SDK",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors).end();
    return;
  }
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ connections: sockets.size }));
    return;
  }
  if (request.url === "/__publish" && request.method === "POST") {
    enabled = true;
    version += 1;
    sockets.forEach((socket) => socket.send(JSON.stringify({ t: "v", version })));
    response.writeHead(202, cors).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${clientKey}`) {
    response.writeHead(401, cors).end();
    return;
  }
  if (request.url === "/v1/eval" && request.method === "POST") {
    response.writeHead(200, { ...cors, "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        version,
        flags: {
          "example.checkout": {
            flagVersion: version,
            reason: "FALLTHROUGH",
            value: enabled,
            variant: enabled ? "on" : "off",
          },
        },
      }),
    );
    return;
  }
  if (request.url === "/v1/version" && request.method === "GET") {
    const etag = `"v${version}"`;
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, { ...cors, ETag: etag }).end();
    } else {
      response.writeHead(200, { ...cors, "Content-Type": "application/json", ETag: etag });
      response.end(JSON.stringify({ version }));
    }
    return;
  }
  if (request.url === "/v1/events" && request.method === "POST") {
    response.writeHead(202, cors).end();
    return;
  }
  response.writeHead(404, cors).end();
});

const websocket = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4311");
  if (url.pathname !== "/v1/stream" || url.searchParams.get("key") !== clientKey) {
    socket.destroy();
    return;
  }
  websocket.handleUpgrade(request, socket, head, (client) => websocket.emit("connection", client));
});
websocket.on("connection", (socket) => {
  sockets.add(socket);
  socket.send(JSON.stringify({ t: "v", version }));
  socket.on("close", () => sockets.delete(socket));
  socket.on("message", () => socket.close(1008, "Clients must not send frames"));
});
server.listen(4311, "127.0.0.1");
