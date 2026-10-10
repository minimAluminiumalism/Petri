// Normalize Anthropic Messages / OpenAI Responses / Chat Completions bodies
// into a flat list of renderable blocks.

export interface Block {
  kind: "system" | "user" | "assistant" | "tool_call" | "tool_result" | "note";
  text?: string;
  name?: string;
  args?: unknown;
  id?: string;
}

type Obj = Record<string, unknown>;

const asArr = (x: unknown): Obj[] => (Array.isArray(x) ? (x as Obj[]) : []);
const str = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x, null, 2));

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  return asArr(content)
    .map((c) => (c.text as string) ?? (c.input_text as string) ?? (c.output_text as string) ?? "")
    .filter(Boolean)
    .join("\n");
}

function anthropic(body: Obj): Block[] {
  const out: Block[] = [];
  const sys = body.system;
  const sysText = typeof sys === "string" ? sys : asArr(sys).map((s) => str(s.text)).join("\n");
  if (sysText) out.push({ kind: "system", text: sysText });

  for (const m of asArr(body.messages)) {
    const role = m.role as string;
    for (const c of asArr(m.content)) {
      if (c.type === "tool_use") {
        out.push({ kind: "tool_call", name: str(c.name), args: c.input, id: str(c.id) });
      } else if (c.type === "tool_result") {
        out.push({ kind: "tool_result", text: str(c.content), id: str(c.tool_use_id) });
      } else {
        const t = contentText([c]);
        out.push({ kind: role === "user" ? "user" : "assistant", text: t || str(c) });
      }
    }
    if (typeof m.content === "string") {
      out.push({ kind: role === "user" ? "user" : "assistant", text: m.content });
    }
  }
  return out;
}

function responses(body: Obj): Block[] {
  const out: Block[] = [];
  const items = asArr(body.input).concat(asArr(body.output));
  for (const it of items) {
    const type = it.type as string;
    if (type === "message" || (!type && it.role)) {
      const role = it.role as string;
      out.push({ kind: role === "user" ? "user" : role === "system" ? "system" : "assistant", text: contentText(it.content) });
    } else if (type === "function_call") {
      out.push({ kind: "tool_call", name: str(it.name), args: it.arguments });
    } else if (type === "function_call_output") {
      out.push({ kind: "tool_result", text: str(it.output) });
    } else if (type?.startsWith("tool_search")) {
      out.push({ kind: "tool_call", name: type, args: it.arguments ?? it.tools });
    } else {
      out.push({ kind: "note", name: type ?? "item", text: str(it) });
    }
  }
  return out;
}

function chatCompletions(body: Obj): Block[] {
  const out: Block[] = [];
  for (const m of asArr(body.messages)) {
    const role = m.role as string;
    if (m.content) out.push({ kind: role === "system" ? "system" : role === "tool" ? "tool_result" : role === "user" ? "user" : "assistant", text: contentText(m.content) });
    for (const tc of asArr(m.tool_calls)) {
      const fn = tc.function as Obj;
      out.push({ kind: "tool_call", name: str(fn?.name ?? tc.name), args: fn?.arguments ?? tc.arguments });
    }
  }
  return out;
}

export function normalizeBody(body: unknown): Block[] {
  if (body === null || typeof body !== "object") return [];
  const b = body as Obj;
  if (Array.isArray(b.messages)) {
    const hasToolResult = asArr(b.messages).some((m) =>
      asArr(m.content).some((c) => c.type === "tool_result"));
    return hasToolResult || b.system ? anthropic(b) : chatCompletions(b);
  }
  if (b.input || b.output) return responses(b);
  return [];
}

export function summarizeRequest(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Obj;
  const parts: string[] = [];
  if (typeof b.model === "string") parts.push(b.model);

  if (Array.isArray(b.input)) {
    const items = b.input as Obj[];
    const msgs = items.filter((i) => i.type === "message" || (!i.type && i.role)).length;
    const outs = items.filter((i) => i.type === "function_call_output").length;
    const calls = items.filter((i) => i.type === "function_call").length;
    const detail = [
      msgs ? `${msgs} msg` : "",
      outs ? `${outs} tool result${outs > 1 ? "s" : ""}` : "",
      calls ? `${calls} call${calls > 1 ? "s" : ""}` : "",
    ].filter(Boolean).join(", ");
    parts.push(detail ? `${items.length} inputs (${detail})` : `${items.length} inputs`);
  } else if (Array.isArray(b.messages)) {
    const msgs = b.messages as Obj[];
    const toolMsgs = msgs.filter((m) => m.role === "tool" ||
      asArr(m.content).some((c) => c.type === "tool_result")).length;
    parts.push(toolMsgs ? `${msgs.length} msgs (${toolMsgs} tool)` : `${msgs.length} msgs`);
  }

  const tools = toolNamesOf(body);
  if (tools.length) parts.push(`${tools.length} tools`);
  return parts;
}

export function toolNamesOf(body: unknown): string[] {
  const tools = (body as Obj)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => {
    const o = t as Obj;
    return (o.name as string) ?? (o.type as string) ?? "?";
  });
}
