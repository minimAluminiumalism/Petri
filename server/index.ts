import { createServer } from "node:http";
import { handleApi } from "./api.ts";
import { handleProxy } from "./proxy.ts";
import { subscribe } from "./events.ts";
import { PORT } from "./executor.ts";
import { requestsMissingSummary, readBody, setRequestSummary } from "./store.ts";
import { summarizeRequest } from "../src/lib/normalize.ts";

for (const r of requestsMissingSummary()) {
  try {
    const body = readBody(r.reqBodyPath);
    if (!body) continue;
    const s = summarizeRequest(JSON.parse(body.toString("utf8")) as unknown);
    if (s.length) setRequestSummary(r.id, s);
  } catch { /* not JSON */ }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/events") {
    subscribe(res);
    return;
  }

  const proxyMatch = url.pathname.match(/^\/run\/([^/]+)\/proxy\/(.*)$/);
  if (proxyMatch) {
    const rest = proxyMatch[2] + (url.search || "");
    void handleProxy(req, res, proxyMatch[1], rest).catch((err) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    });
    return;
  }

  void handleApi(req, res, url).then((handled) => {
    if (!handled) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
});

// Bind 0.0.0.0 so containers can reach the proxy via host.docker.internal.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`petri backend listening on http://127.0.0.1:${PORT} (+ containers via host.docker.internal)`);
});
