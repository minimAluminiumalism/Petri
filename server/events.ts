import type { ServerResponse } from "node:http";

const clients = new Set<ServerResponse>();

export function publish(event: string, data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}

export function subscribe(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  res.write(":ok\n\n");
  clients.add(res);
  res.on("close", () => clients.delete(res));
}
