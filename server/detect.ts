import { execFile, execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PETRI_HOME } from "./config.ts";

export interface LocalInstall {
  bin: string;
  version?: string;
  source: "path" | "petri";
}

function probeVersion(bin: string): string | undefined {
  try {
    const out = execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    return out.match(/\d+\.\d+\.\d+[^\s]*/)?.[0];
  } catch {
    return undefined;
  }
}

function which(bin: string): string | undefined {
  try {
    return execFileSync("which", [bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function detectInstalls(adapterId: string): LocalInstall[] {
  const out: LocalInstall[] = [];
  const seen = new Set<string>();

  const pathBin = which(adapterId);
  if (pathBin) {
    out.push({ bin: pathBin, version: probeVersion(pathBin), source: "path" });
    seen.add(pathBin);
  }

  const petriDir = join(PETRI_HOME, "agents", adapterId);
  if (existsSync(petriDir)) {
    for (const ver of readdirSync(petriDir)) {
      const bin = join(petriDir, ver, "bin", adapterId);
      if (existsSync(bin) && !seen.has(bin)) out.push({ bin, version: ver, source: "petri" });
    }
  }
  return out;
}

// opens the OS-native file picker, resolves with the chosen path or null if cancelled
export function pickFile(): Promise<string | null> {
  const cmd =
    process.platform === "darwin"
      ? { bin: "osascript", args: ["-e", 'POSIX path of (choose file with prompt "Select the agent binary")'] }
      : process.platform === "win32"
        ? { bin: "powershell", args: ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; if ($d.ShowDialog() -eq 'OK') { $d.FileName }"] }
        : which("zenity")
          ? { bin: "zenity", args: ["--file-selection", "--title=Select the agent binary"] }
          : which("kdialog")
            ? { bin: "kdialog", args: ["--getopenfilename", "~"] }
            : null;
  if (!cmd) return Promise.reject(new Error("no file dialog available on this platform"));
  return new Promise((resolve, reject) => {
    execFile(cmd.bin, cmd.args, { timeout: 120_000 }, (err, stdout) => {
      if (err) {
        if ((err as { code?: number }).code === 1) resolve(null); // user cancelled
        else reject(err);
        return;
      }
      resolve(stdout.trim() || null);
    });
  });
}

export function checkBin(bin: string): { ok: boolean; resolved?: string; version?: string; error?: string } {
  const resolved = bin.includes("/") ? bin : which(bin);
  if (!resolved || !existsSync(resolved)) return { ok: false, error: "not found" };
  try {
    accessSync(resolved, constants.X_OK);
  } catch {
    return { ok: false, error: "not executable" };
  }
  return { ok: true, resolved, version: probeVersion(resolved) };
}
