import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageBlock } from "../core/types.ts";
import { num, str, ToolError, type Tool, type ToolContext, type ToolOutput } from "./types.ts";

// Desktop control (D19): see the screen and drive mouse and keyboard like a person at
// the machine. Backends are discovered from what the OS provides, never assumed:
//  - macOS: screencapture + sips, CoreGraphics events through osascript (JXA), System
//    Events for keystrokes. Needs the Screen Recording and Accessibility permissions.
//  - Linux: xdotool (X11) for input; grim, gnome-screenshot, scrot or ImageMagick import
//    for screenshots.
// Every action leaves the workspace sandbox, so in "ask" mode each one needs approval
// (see ToolRegistry.needsApproval); "auto" is an explicit opt-in in config.

export type ComputerMode = "off" | "ask" | "auto";

interface Backend {
  name: string;
  screenSize(): Promise<{ width: number; height: number }>;
  capture(file: string, width: number): Promise<void>; // PNG at the given width
  mouse(action: "move" | "click" | "down" | "up", x: number, y: number, button: "left" | "right" | "middle", count: number): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
  type(text: string): Promise<void>;
  key(combo: string): Promise<void>;
  cursor(): Promise<{ x: number; y: number }>;
  open(target: string): Promise<void>;
}

async function run(cmd: string[], input?: string): Promise<string> {
  const p = Bun.spawn(cmd, { stdin: input !== undefined ? new Blob([input]) : "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new ToolError(`${cmd[0]} failed (exit ${code}): ${err.trim().slice(0, 400) || out.trim().slice(0, 400)}`);
  return out.trim();
}

// JXA with arguments passed through argv: nothing from the model is spliced into code.
const jxa = (body: string, ...args: (string | number)[]) =>
  run(["osascript", "-l", "JavaScript", "-e", `ObjC.import("CoreGraphics"); ObjC.import("AppKit"); function run(argv) { ${body} }`, ...args.map(String)]);

const MAC_KEYS: Record<string, number> = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53, forwarddelete: 117,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};
const MAC_MODS: Record<string, string> = { cmd: "command down", command: "command down", super: "command down", meta: "command down", ctrl: "control down", control: "control down", alt: "option down", option: "option down", opt: "option down", shift: "shift down" };

export function parseCombo(combo: string): { mods: string[]; key: string } {
  const parts = combo.toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new ToolError(`invalid key combo: ${combo}`);
  return { mods: parts, key };
}

const mac: Backend = {
  name: "macos",
  async screenSize() {
    const [w, h] = (await jxa("const f = $.NSScreen.mainScreen.frame; return f.size.width + ' ' + f.size.height;")).split(" ").map(Number);
    return { width: w!, height: h! };
  },
  async capture(file, width) {
    await run(["screencapture", "-x", "-t", "png", file]);
    await run(["sips", "--resampleWidth", String(width), file]);
  },
  async mouse(action, x, y, button, count) {
    // Event types: left down/up 1/2, right 3/4, other 25/26, moved 5; button ids 0/1/2.
    const [down, up, id] = button === "right" ? [3, 4, 1] : button === "middle" ? [25, 26, 2] : [1, 2, 0];
    await jxa(
      `const [action, x, y, down, up, id, count] = [argv[0], +argv[1], +argv[2], +argv[3], +argv[4], +argv[5], +argv[6]];
       const p = $.CGPointMake(x, y);
       const post = (t, n) => { const e = $.CGEventCreateMouseEvent(null, t, p, id); if (n) $.CGEventSetIntegerValueField(e, 1, n); $.CGEventPost(0, e); };
       post(5, 0);
       if (action === "down") post(down, 1);
       else if (action === "up") post(up, 1);
       else if (action === "click") for (let i = 1; i <= count; i++) { post(down, i); post(up, i); }
       delay(0.05);`,
      action, x, y, down, up, id, count,
    );
  },
  async scroll(x, y, dx, dy) {
    await this.mouse("move", x, y, "left", 0);
    // Line units (1); positive wheel1 scrolls up, so negate "down".
    await jxa("$.CGEventPost(0, $.CGEventCreateScrollWheelEvent2(null, 1, 2, -(+argv[0]), -(+argv[1]), 0));", dy, dx);
  },
  async type(text) {
    await run(["osascript", "-e", "on run argv", "-e", 'tell application "System Events" to keystroke (item 1 of argv)', "-e", "end run", text]);
  },
  async key(combo) {
    const { mods, key } = parseCombo(combo);
    const using = mods.map((m) => {
      const v = MAC_MODS[m];
      if (!v) throw new ToolError(`unknown modifier "${m}" (use cmd, ctrl, alt, shift)`);
      return v;
    });
    const code = MAC_KEYS[key];
    if (code === undefined && key.length !== 1) throw new ToolError(`unknown key "${key}"`);
    const action = code !== undefined ? `key code ${code}` : "keystroke (item 1 of argv)";
    const suffix = using.length ? ` using {${using.join(", ")}}` : "";
    await run(["osascript", "-e", "on run argv", "-e", `tell application "System Events" to ${action}${suffix}`, "-e", "end run", key]);
  },
  async cursor() {
    const [x, y] = (await jxa("const p = $.CGEventGetLocation($.CGEventCreate(null)); return Math.round(p.x) + ' ' + Math.round(p.y);")).split(" ").map(Number);
    return { x: x!, y: y! };
  },
  async open(target) {
    await run(/^[a-z]+:\/\//i.test(target) || target.startsWith("/") ? ["open", target] : ["open", "-a", target]);
  },
};

function linuxBackend(): Backend | null {
  if (!Bun.which("xdotool")) return null;
  const shooter = Bun.which("grim") ? "grim" : Bun.which("gnome-screenshot") ? "gnome-screenshot" : Bun.which("scrot") ? "scrot" : Bun.which("import") ? "import" : null;
  if (!shooter) return null;
  const btn = { left: 1, middle: 2, right: 3 } as const;
  return {
    name: `linux (xdotool, ${shooter})`,
    async screenSize() {
      const [w, h] = (await run(["xdotool", "getdisplaygeometry"])).split(/\s+/).map(Number);
      return { width: w!, height: h! };
    },
    async capture(file, width) {
      const cmd = { grim: ["grim", file], "gnome-screenshot": ["gnome-screenshot", "-f", file], scrot: ["scrot", "-o", file], import: ["import", "-window", "root", file] }[shooter];
      await run(cmd);
      if (Bun.which("convert")) await run(["convert", file, "-resize", `${width}x`, file]);
    },
    async mouse(action, x, y, button, count) {
      const b = String(btn[button]);
      const tail = action === "click" ? ["click", "--repeat", String(count), b] : action === "down" ? ["mousedown", b] : action === "up" ? ["mouseup", b] : [];
      await run(["xdotool", "mousemove", String(x), String(y), ...tail]);
    },
    async scroll(x, y, dx, dy) {
      const clicks: string[] = [];
      if (dy) clicks.push("click", "--repeat", String(Math.abs(dy)), dy > 0 ? "5" : "4");
      await run(["xdotool", "mousemove", String(x), String(y), ...clicks]);
      if (dx) await run(["xdotool", "click", "--repeat", String(Math.abs(dx)), dx > 0 ? "7" : "6"]);
    },
    async type(text) {
      await run(["xdotool", "type", "--delay", "8", "--", text]);
    },
    async key(combo) {
      const { mods, key } = parseCombo(combo);
      const map: Record<string, string> = { cmd: "super", command: "super", meta: "super", control: "ctrl", option: "alt", opt: "alt", enter: "Return", return: "Return", esc: "Escape", escape: "Escape", backspace: "BackSpace", delete: "BackSpace", tab: "Tab", space: "space", pageup: "Prior", pagedown: "Next", left: "Left", right: "Right", up: "Up", down: "Down", home: "Home", end: "End" };
      await run(["xdotool", "key", "--", [...mods, key].map((k) => map[k] ?? k).join("+")]);
    },
    async cursor() {
      const out = await run(["xdotool", "getmouselocation", "--shell"]);
      return { x: Number(/X=(\d+)/.exec(out)?.[1] ?? 0), y: Number(/Y=(\d+)/.exec(out)?.[1] ?? 0) };
    },
    async open(target) {
      await run(["xdg-open", target]);
    },
  };
}

let cachedBackend: Backend | null | undefined;
export function discoverBackend(): Backend | null {
  if (cachedBackend !== undefined) return cachedBackend;
  if (process.platform === "darwin" && Bun.which("screencapture") && Bun.which("osascript") && Bun.which("sips")) cachedBackend = mac;
  else if (process.platform === "linux" && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) cachedBackend = linuxBackend();
  else cachedBackend = null;
  return cachedBackend;
}

// Screenshots are scaled to at most this many pixels wide (token cost); the model works
// in screenshot coordinates and the tool maps them back to screen points.
const MAX_SHOT_WIDTH = Number(process.env.AH_SCREENSHOT_WIDTH ?? 1280);

async function screenshot(b: Backend): Promise<{ image: ImageBlock; width: number; height: number; scale: number }> {
  const screen = await b.screenSize();
  const width = Math.min(screen.width, MAX_SHOT_WIDTH);
  const dir = mkdtempSync(join(tmpdir(), "ah-shot-"));
  try {
    const file = join(dir, "s.png");
    await b.capture(file, width);
    const data = readFileSync(file).toString("base64");
    return { image: { type: "image", mediaType: "image/png", data }, width, height: Math.round((screen.height * width) / screen.width), scale: screen.width / width };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const needsApproval = (_i: Record<string, unknown>, ctx: ToolContext) => ctx.computer !== "auto";
const available = (ctx: ToolContext) => (ctx.computer ?? "off") !== "off" && discoverBackend() !== null;

export const screenshotTool: Tool = {
  readOnly: true,
  optional: true,
  spec: {
    name: "screenshot",
    description: "Capture the screen. Returns the image; coordinates you pass to the computer tool are in this image's pixel space.",
    inputSchema: { type: "object", properties: {} },
  },
  available,
  needsApproval,
  summarize: () => "screenshot",
  async run() {
    const b = discoverBackend()!;
    const s = await screenshot(b);
    return { content: `screenshot ${s.width}x${s.height} (${b.name})`, images: [s.image] };
  },
};

const ACTIONS = ["click", "double_click", "right_click", "middle_click", "move", "drag", "scroll", "type", "key", "cursor_position", "wait", "open"] as const;

export const computerTool: Tool = {
  readOnly: false,
  optional: true,
  spec: {
    name: "computer",
    description:
      "Operate the desktop like a person: click, move, drag, scroll, type text, press key combos (e.g. \"cmd+t\", \"ctrl+shift+esc\", \"return\"), open an app/URL/path, or wait. " +
      "x/y are in the pixel space of the latest screenshot. A screenshot is returned after each action unless observe is false. Take a screenshot first to see the screen.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...ACTIONS] },
        x: { type: "number" },
        y: { type: "number" },
        to_x: { type: "number", description: "drag end x" },
        to_y: { type: "number", description: "drag end y" },
        text: { type: "string", description: "text to type, key combo for key, app/URL/path for open" },
        amount: { type: "integer", description: "scroll lines; positive scrolls down/right", minimum: -50, maximum: 50 },
        direction: { type: "string", enum: ["vertical", "horizontal"] },
        seconds: { type: "number", minimum: 0, maximum: 30 },
        observe: { type: "boolean", description: "return a screenshot after the action (default true)" },
      },
      required: ["action"],
    },
  },
  available,
  needsApproval,
  summarize: (i) => {
    const at = i.x !== undefined ? ` at ${i.x},${i.y}` : "";
    const t = i.text !== undefined ? ` "${String(i.text).slice(0, 60)}"` : "";
    return `computer ${i.action}${at}${t}`;
  },
  async run(input, ctx): Promise<ToolOutput> {
    const b = discoverBackend()!;
    const action = str(input, "action") as (typeof ACTIONS)[number];
    const screen = await b.screenSize();
    const scale = screen.width / Math.min(screen.width, MAX_SHOT_WIDTH);
    const pt = (kx: string, ky: string) => {
      const x = num(input, kx, Number.NaN);
      const y = num(input, ky, Number.NaN);
      if (Number.isNaN(x) || Number.isNaN(y)) throw new ToolError(`${action} needs ${kx} and ${ky}`);
      const sx = Math.round(x * scale);
      const sy = Math.round(y * scale);
      if (sx < 0 || sy < 0 || sx > screen.width || sy > screen.height) throw new ToolError(`${kx},${ky} (${x},${y}) is outside the screen`);
      return { x: sx, y: sy };
    };
    let note = "";
    switch (action) {
      case "click":
      case "double_click":
      case "right_click":
      case "middle_click": {
        const p = pt("x", "y");
        await b.mouse("click", p.x, p.y, action === "right_click" ? "right" : action === "middle_click" ? "middle" : "left", action === "double_click" ? 2 : 1);
        break;
      }
      case "move": {
        const p = pt("x", "y");
        await b.mouse("move", p.x, p.y, "left", 0);
        break;
      }
      case "drag": {
        const a = pt("x", "y");
        const z = pt("to_x", "to_y");
        await b.mouse("down", a.x, a.y, "left", 1);
        await b.mouse("move", z.x, z.y, "left", 0);
        await b.mouse("up", z.x, z.y, "left", 1);
        break;
      }
      case "scroll": {
        const p = input.x !== undefined ? pt("x", "y") : await b.cursor();
        const n = num(input, "amount", 3);
        await b.scroll(p.x, p.y, input.direction === "horizontal" ? n : 0, input.direction === "horizontal" ? 0 : n);
        break;
      }
      case "type":
        await b.type(str(input, "text"));
        break;
      case "key":
        await b.key(str(input, "text"));
        break;
      case "open":
        await b.open(str(input, "text"));
        break;
      case "wait":
        await Bun.sleep(num(input, "seconds", 1) * 1000);
        break;
      case "cursor_position": {
        const c = await b.cursor();
        return { content: `cursor at ${Math.round(c.x / scale)},${Math.round(c.y / scale)} (screenshot pixels)` };
      }
      default:
        throw new ToolError(`unknown action ${action}`);
    }
    if (input.observe === false) return { content: `${action} done${note}` };
    // Let the UI settle before looking.
    await Bun.sleep(action === "open" ? 1500 : 400);
    if (ctx.signal?.aborted) throw new ToolError("aborted");
    const s = await screenshot(b);
    note = ` · screenshot ${s.width}x${s.height}`;
    return { content: `${action} done${note}`, images: [s.image] };
  },
};
