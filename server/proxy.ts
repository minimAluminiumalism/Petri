import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.ts";
import * as store from "./store.ts";
import { publish } from "./events.ts";
import { assembleSse } from "./sse.ts";
import { summarizeRequest } from "../src/lib/normalize.ts";
import type { ModelConfig } from "./types.ts";

function authHeaders(model: ModelConfig): Record<string, string> {
  if (!model.apiKey) return {};
  return model.protocol === "anthropic-messages"
    ? { "x-api-key": model.apiKey }
    : { authorization: `Bearer ${model.apiKey}` };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

// Route: /run/<runId>/proxy/<rest> -> <model.upstream>/<rest>
export async function handleProxy(req: IncomingMessage, res: ServerResponse, runId: string, rest: string): Promise<void> {
  const run = store.getRun(runId);
  if (!run) {
    res.writeHead(404).end(JSON.stringify({ error: `unknown run ${runId}` }));
    return;
  }
  const model = loadConfig().models.find((m) => m.id === run.modelId);
  if (!model) {
    res.writeHead(502).end(JSON.stringify({ error: `run ${runId} has no model` }));
    return;
  }

  const seq = store.nextSeq(runId);
  const startedAt = new Date();
  const reqBody = await readBody(req);
  const reqBodyPath = store.bodyPath(runId, seq, "req");
  store.writeBody(reqBodyPath, reqBody);

  let summary: string[] | undefined;
  try {
    const s = summarizeRequest(JSON.parse(reqBody.toString("utf8")) as unknown);
    if (s.length) summary = s;
  } catch { /* not JSON */ }

  const reqHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) reqHeaders[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");

  const target = `${model.upstream.replace(/\/$/, "")}/${rest}`;
  const fwdHeaders: Record<string, string> = {
    ...reqHeaders,
    ...model.headers,
    ...authHeaders(model),
    host: new URL(model.upstream).host,
    "accept-encoding": "identity",
    "content-length": String(reqBody.length),
  };
  delete fwdHeaders["connection"];
  delete fwdHeaders["transfer-encoding"];

  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(target, { method: req.method, headers: fwdHeaders, body: reqBody.length ? reqBody : undefined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.insertRequest({
      runId, seq, method: req.method ?? "?", path: `/${rest}`, reqBodyPath,
      status: 502, durationMs: Date.now() - t0, streaming: false,
      startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), reqHeaders, summary,
    });
    publish("request", { runId, seq, method: req.method, path: `/${rest}`, status: 502 });
    res.writeHead(502).end(JSON.stringify({ error: msg }));
    return;
  }

  const respHeaders: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    if (k !== "content-encoding" && k !== "transfer-encoding" && k !== "content-length" && k !== "connection") respHeaders[k] = v;
  });
  const streaming = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");

  res.writeHead(upstream.status, respHeaders);

  const chunks: Buffer[] = [];
  if (upstream.body) {
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      chunks.push(buf);
      res.write(buf);
    }
  }
  res.end();

  const respBodyPath = store.bodyPath(runId, seq, "resp");
  const rawResp = Buffer.concat(chunks);
  store.writeBody(respBodyPath, rawResp);
  if (streaming) {
    const assembled = assembleSse(rawResp.toString("utf8"));
    if (assembled) store.writeBody(respBodyPath.replace(/\.bin$/, ".json"), Buffer.from(JSON.stringify(assembled, null, 2)));
  }

  const rec: Omit<import("./types.ts").CapturedRequestMeta, "id"> & { reqBodyPath: string } = {
    runId, seq, method: req.method ?? "?", path: `/${rest}`,
    status: upstream.status, durationMs: Date.now() - t0, streaming,
    startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    reqHeaders, respHeaders, reqBodyPath, summary,
  };
  const id = store.insertRequest(rec);
  store.attachRespBody(id, respBodyPath);
  publish("request", {
    runId, seq, method: rec.method, path: rec.path,
    status: rec.status, durationMs: rec.durationMs, streaming,
  });
}
