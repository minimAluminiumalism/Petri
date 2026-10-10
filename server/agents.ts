import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentFeature, ModelConfig, Run, TaskConfig } from "./types.ts";

export interface PlanCtx {
  run: Run;
  task: TaskConfig;
  model: ModelConfig;
  bin: string; // executable name/path as seen by the executing process
  proxyBase: string; // base_url the agent should use
  workDir: string; // cwd as seen by the process
  homeDir: string; // host-writable dir where config files are placed
  homePath: string; // HOME as seen by the process (same as homeDir locally, mount path in container)
}

export interface SpawnPlan {
  bin: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface AgentAdapter {
  id: string;
  name: string; // official display name
  npmPackage?: string; // for container image builds / auto-install
  features?: AgentFeature[]; // toggles shown per-run; consumed via ctx.run.flags
  plan(ctx: PlanCtx): SpawnPlan;
}

const claude: AgentAdapter = {
  id: "claude",
  name: "Claude Code",
  npmPackage: "@anthropic-ai/claude-code",
  features: [
    { key: "tool-search", label: "tool search", enabled: false },
  ],
  plan({ run, task, model, bin, proxyBase, workDir }) {
    return {
      bin,
      args: ["-p", task.prompt, "--model", model.modelId, "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"],
      cwd: workDir,
      env: {
        ANTHROPIC_BASE_URL: proxyBase,
        ANTHROPIC_API_KEY: "petri-proxy",
        IS_SANDBOX: "1", // required for --dangerously-skip-permissions when running as root in containers
        ...(run.flags["tool-search"] ? { ENABLE_TOOL_SEARCH: "true" } : {}),
      },
    };
  },
};

const codex: AgentAdapter = {
  id: "codex",
  name: "Codex",
  npmPackage: "@openai/codex",
  features: [
    { key: "code-mode", label: "code mode", enabled: false },
    { key: "tool-search", label: "tool search", enabled: false },
    { key: "web-search", label: "web search", enabled: false },
    { key: "response-storage", label: "response storage", enabled: true },
  ],
  plan({ run, task, model, bin, proxyBase, workDir, homeDir, homePath }) {
    const codexHome = join(homeDir, ".codex");
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, "config.toml"),
      [
        `model = "${model.modelId}"`,
        `model_provider = "petri"`,
        ...(run.flags["response-storage"] === false ? [`disable_response_storage = true`] : []),
        ...(run.flags["web-search"] ? [`web_search = "live"`] : []),
        ``,
        `[model_providers.petri]`,
        `name = "petri"`,
        `base_url = "${proxyBase}"`,
        `wire_api = "responses"`,
        `env_key = "PETRI_API_KEY"`,
        ...(run.flags["code-mode"] || run.flags["tool-search"]
          ? [``, `[features]`,
            ...(run.flags["code-mode"] ? [`code_mode = true`, `code_mode_host = true`] : []),
            ...(run.flags["tool-search"] ? [`tool_search = true`] : []),
          ]
          : [``]),
      ].join("\n"),
    );
    return {
      bin,
      args: ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", task.prompt],
      cwd: workDir,
      env: { CODEX_HOME: join(homePath, ".codex"), PETRI_API_KEY: "petri-proxy" },
    };
  },
};

// TODO(pi): verify headless flag (-p vs --print) and models.json schema for this version.
const pi: AgentAdapter = {
  id: "pi",
  name: "Pi",
  npmPackage: "@earendil-works/pi-coding-agent",
  features: [
    { key: "code-mode", label: "code mode", enabled: false },
    { key: "tool-search", label: "tool search", enabled: false },
  ],
  plan({ run, task, model, bin, proxyBase, workDir, homeDir }) {
    const piHome = join(homeDir, ".pi", "agent");
    mkdirSync(piHome, { recursive: true });
    writeFileSync(
      join(piHome, "models.json"),
      JSON.stringify(
        {
          providers: {
            petri: {
              baseUrl: proxyBase,
              apiKey: "petri-proxy",
              api: model.protocol,
              models: [{ id: model.modelId }],
            },
          },
        },
        null,
        2,
      ),
    );
    // --tools is a plain allowlist in pi <1.1 (+name/-name modifiers only work in defaultTools
    // settings there), so we pass the default set plus the selected extras explicitly.
    const tools = [
      "read",
      "bash",
      "edit",
      "write",
      ...(run.flags["code-mode"] ? ["codemode"] : []),
      ...(run.flags["tool-search"] ? ["tool_search"] : []),
    ];
    return {
      bin,
      args: ["--tools", tools.join(","), "--model", `petri/${model.modelId}`, "-p", task.prompt],
      cwd: workDir,
      env: {},
    };
  },
};

// TODO(opencode): verify headless subcommand (opencode run) and config path for this version.
const opencode: AgentAdapter = {
  id: "opencode",
  name: "OpenCode",
  npmPackage: "opencode-ai",
  // No global code-mode toggle: in 1.18.35 `codemode` is a per-MCP-server option and
  // `permission.execute` is not a valid permission key (verified in the binary).
  features: [],
  plan({ task, model, bin, proxyBase, workDir, homeDir, homePath }) {
    const cfgDir = join(homeDir, ".config", "opencode");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "opencode.json"),
      JSON.stringify(
        {
          provider: {
            petri: {
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: proxyBase, apiKey: "petri-proxy" },
              models: { [model.modelId]: {} },
            },
          },
        },
        null,
        2,
      ),
    );
    return {
      bin,
      args: ["run", task.prompt],
      cwd: workDir,
      env: {
        XDG_CONFIG_HOME: join(homePath, ".config"),
        XDG_DATA_HOME: join(homePath, ".local", "share"),
      },
    };
  },
};

// TODO(omp): verify headless flag and models.yml schema for this version.
const omp: AgentAdapter = {
  id: "omp",
  name: "omp",
  npmPackage: "@oh-my-pi/pi-coding-agent",
  plan({ task, model, bin, proxyBase, workDir, homeDir }) {
    const ompHome = join(homeDir, ".omp", "agent");
    mkdirSync(ompHome, { recursive: true });
    writeFileSync(
      join(ompHome, "models.yml"),
      [
        `providers:`,
        `  petri:`,
        `    baseUrl: ${proxyBase}`,
        `    apiKey: petri-proxy`,
        `    models:`,
        `      - ${model.modelId}`,
        ``,
      ].join("\n"),
    );
    return { bin, args: ["-p", task.prompt], cwd: workDir, env: {} };
  },
};

export const adapters: Record<string, AgentAdapter> = { claude, codex, pi, opencode, omp };
