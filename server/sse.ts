// Reassemble streamed response bodies (SSE) into their complete JSON form.
// Supports: OpenAI Responses API, OpenAI Chat Completions, Anthropic Messages, Gemini SSE.

type Obj = Record<string, unknown>;

interface SseEvent {
  event?: string;
  data: string;
}

function parseSse(raw: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length > 0) out.push({ event, data: dataLines.join("\n") });
  }
  return out;
}

function dataJson(e: SseEvent): Obj | null {
  try {
    return JSON.parse(e.data) as Obj;
  } catch {
    return null;
  }
}

// --- OpenAI Responses API: response.completed carries the whole response object ---

function assembleResponses(events: SseEvent[]): Obj | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event === "response.completed") {
      const d = dataJson(events[i]);
      const resp = d?.response as Obj | undefined;
      if (resp) return resp;
    }
  }
  return null;
}

// --- OpenAI Chat Completions: accumulate choices[].delta ---

interface ToolCallAcc {
  id?: string;
  type?: string;
  function: { name?: string; arguments: string };
}

function assembleCompletions(events: SseEvent[]): Obj | null {
  let base: Obj | null = null;
  interface ChoiceAcc {
    deltaRole?: string;
    content: string;
    toolCalls: Map<number, ToolCallAcc>;
    finishReason?: string;
  }
  const choices = new Map<number, ChoiceAcc>();
  let usage: Obj | null = null;
  for (const e of events) {
    const d = dataJson(e);
    if (!d) continue;
    if (d.object !== "chat.completion.chunk") continue;
    base ??= { ...d, object: "chat.completion", choices: [] };
    if (d.usage) usage = d.usage as Obj;
    for (const ch of (d.choices as Obj[]) ?? []) {
      const idx = (ch.index as number) ?? 0;
      const acc = choices.get(idx) ?? ({ content: "", toolCalls: new Map<number, ToolCallAcc>() } as ChoiceAcc);
      const delta = (ch.delta ?? {}) as Obj;
      if (typeof delta.role === "string") acc.deltaRole = delta.role;
      if (typeof delta.content === "string") acc.content += delta.content;
      for (const tc of (delta.tool_calls as Obj[]) ?? []) {
        const ti = (tc.index as number) ?? 0;
        const tacc = acc.toolCalls.get(ti) ?? { function: { arguments: "" } };
        if (typeof tc.id === "string") tacc.id = tc.id;
        if (typeof tc.type === "string") tacc.type = tc.type;
        const fn = (tc.function ?? {}) as Obj;
        if (typeof fn.name === "string") tacc.function.name = fn.name;
        if (typeof fn.arguments === "string") tacc.function.arguments += fn.arguments;
        acc.toolCalls.set(ti, tacc);
      }
      if (ch.finish_reason) acc.finishReason = ch.finish_reason as string;
      choices.set(idx, acc);
    }
  }
  if (!base) return null;
  base.choices = [...choices.entries()].sort((a, b) => a[0] - b[0]).map(([idx, acc]) => ({
    index: idx,
    finish_reason: acc.finishReason ?? null,
    message: {
      role: acc.deltaRole ?? "assistant",
      content: acc.content || null,
      tool_calls: acc.toolCalls.size
        ? [...acc.toolCalls.values()].map((t) => {
            try {
              return { ...t, function: { ...t.function, arguments: JSON.parse(t.function.arguments) as unknown } };
            } catch {
              return t;
            }
          })
        : undefined,
    },
  }));
  if (usage) base.usage = usage;
  return base;
}

// --- Anthropic Messages: message_start + content_block_* + message_delta ---

function assembleAnthropic(events: SseEvent[]): Obj | null {
  let message: Obj | null = null;
  const blocks = new Map<number, { block: Obj; textParts: string[]; jsonParts: string[] }>();
  for (const e of events) {
    const d = dataJson(e);
    if (!d) continue;
    switch (e.event) {
      case "message_start":
        message = d.message as Obj;
        if (message && !Array.isArray(message.content)) message.content = [];
        break;
      case "content_block_start": {
        const idx = d.index as number;
        blocks.set(idx, { block: { ...(d.content_block as Obj) }, textParts: [], jsonParts: [] });
        break;
      }
      case "content_block_delta": {
        const acc = blocks.get(d.index as number);
        const delta = (d.delta ?? {}) as Obj;
        if (acc && typeof delta.text === "string") acc.textParts.push(delta.text);
        if (acc && typeof delta.thinking === "string") acc.textParts.push(delta.thinking);
        if (acc && typeof delta.partial_json === "string") acc.jsonParts.push(delta.partial_json);
        break;
      }
      case "message_delta": {
        if (message && d.delta) Object.assign(message, d.delta);
        if (message && d.usage) message.usage = d.usage;
        break;
      }
      default:
        break;
    }
  }
  if (!message) return null;
  const content: Obj[] = [];
  for (const [idx, acc] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    const b = acc.block;
    if (b.type === "text" || b.type === "thinking") {
      const field = b.type === "thinking" ? "thinking" : "text";
      b[field] = acc.textParts.join("");
    }
    if (acc.jsonParts.length) {
      try {
        b.input = JSON.parse(acc.jsonParts.join("")) as unknown;
      } catch {
        b.input_partial_json = acc.jsonParts.join("");
      }
    }
    content[idx] = b;
  }
  message.content = content.filter(Boolean);
  return message;
}

// --- Gemini SSE: each event is a full GenerateContentResponse; merge candidates ---

function assembleGemini(events: SseEvent[]): Obj | null {
  let last: Obj | null = null;
  for (const e of events) {
    const d = dataJson(e);
    if (d && (d.candidates || d.usageMetadata)) last = d;
  }
  if (!last) return null;
  // Accumulate text parts across events for a complete message.
  let fullText = "";
  for (const e of events) {
    const d = dataJson(e);
    for (const c of (d?.candidates as Obj[]) ?? []) {
      for (const p of (((c.content as Obj)?.parts as Obj[]) ?? [])) {
        if (typeof p.text === "string") fullText += p.text;
      }
    }
  }
  if (fullText) {
    const c0 = ((last.candidates as Obj[]) ?? [])[0] as Obj | undefined;
    if (c0) (c0.content as Obj) = { role: "model", parts: [{ text: fullText }] };
  }
  return last;
}

export function assembleSse(raw: string): Obj | null {
  const events = parseSse(raw);
  if (events.length === 0) return null;
  const names = new Set(events.map((e) => e.event).filter(Boolean));
  if (names.has("response.completed")) return assembleResponses(events);
  if (names.has("message_start")) return assembleAnthropic(events);
  if (events.some((e) => dataJson(e)?.object === "chat.completion.chunk")) return assembleCompletions(events);
  return assembleGemini(events);
}
