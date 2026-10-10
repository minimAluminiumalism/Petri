import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PetriConfig } from "./types.ts";

export const PETRI_HOME = process.env.PETRI_HOME ?? join(homedir(), ".petri");
const CONFIG_PATH = join(PETRI_HOME, "config.json");

const EMPTY: PetriConfig = { models: [], agents: {}, tasks: [] };

export function loadConfig(): PetriConfig {
  if (!existsSync(CONFIG_PATH)) return structuredClone(EMPTY);
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<PetriConfig> & { agents?: unknown };
    // migrate legacy array form [{id, bin, features}] to the override map
    if (Array.isArray(raw.agents)) {
      const map: Record<string, { bin?: string; features?: never[] }> = {};
      for (const a of raw.agents as { id?: string; bin?: string; features?: never[] }[]) {
        if (a.id) map[a.id] = { bin: a.bin || undefined, features: a.features };
      }
      raw.agents = map;
    }
    return { ...structuredClone(EMPTY), ...raw } as PetriConfig;
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveConfig(cfg: PetriConfig): void {
  mkdirSync(PETRI_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
