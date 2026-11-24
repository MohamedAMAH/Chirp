import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const swayAppId = "local.chirp.dictation";

export function isSway() {
  return (
    process.platform === "linux" &&
    !!process.env.SWAYSOCK &&
    !!process.env.WAYLAND_DISPLAY
  );
}

interface SwayNode {
  id: number;
  focused: boolean;
  type: string;
  app_id?: string;
  window_properties?: { class?: string };
  rect: { x: number; y: number; width: number; height: number };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

function focused(node: SwayNode): SwayNode | undefined {
  if (node.focused) return node;
  for (const child of [...(node.nodes ?? []), ...(node.floating_nodes ?? [])]) {
    const target = focused(child);
    if (target) return target;
  }
}

export async function swayTarget() {
  const { stdout } = await run("swaymsg", ["-r", "-t", "get_tree"], {
    timeout: 1500,
    maxBuffer: 4 * 1024 * 1024,
  });
  const target = focused(JSON.parse(stdout));
  if (target && (target.app_id || target.window_properties?.class))
    return target;
}

export const swayIndicatorTitle = "Chirp indicator";

export async function moveSwayIndicator(x: number, y: number) {
  await run(
    "swaymsg",
    [
      "-q",
      `[app_id="^${swayAppId.replaceAll(".", "[.]")}$" title="^${swayIndicatorTitle}$"] move absolute position ${Math.round(x)} px ${Math.round(y)} px`,
    ],
    { timeout: 1500 },
  );
}

export function openSwayHelper() {
  return spawn(process.execPath, [require.resolve("./sway-helper")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "ignore"],
  });
}
