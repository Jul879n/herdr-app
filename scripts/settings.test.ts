import { expect, test } from "bun:test";
import { tr } from "./tr-stub";
import { readFile } from "node:fs/promises";

// What a click in the Settings window writes to settings.json, without a window or a core.
const source = await readFile(new URL("../defaults/frame/settings/main.js", import.meta.url), "utf8");
// settings.json as the mod sees it through readTextFile / writeTextFile.
const disk: { raw: string | null; writes: number; fail?: string; readFail?: string; toasts: any[]; keys?: any[] } = { raw: null, writes: 0, toasts: [] };
const values: Record<string, any> = {
  tr, View: class {},
  keys: () => disk.keys,
  appHome: () => "/home",
  notify: (n: any) => { disk.toasts.push(n); },
  readTextFile: async () => {
    if (disk.readFail) throw new Error(disk.readFail);
    return disk.raw;
  },
  writeTextFile: async (_path: string, text: string, expected: string | null) => {
    disk.writes++;
    if (disk.fail) throw new Error(disk.fail);
    if (expected !== disk.raw) throw new Error("changed since read");
    disk.raw = text;
  },
};
const names = [...source.matchAll(/^import \{([^}]*)\}/gm)].flatMap(m => m[1].split(",").map(n => n.trim()));
const args = names.map(name => values[name] ?? (() => undefined));
const Settings = new Function(...names, source.replace(/^import .*;\n/gm, "").replace("export default class Settings", "return class Settings"))(...args);

/** Runs `edit` through the Settings window's change() on `raw`; the toasts it posts. */
async function change(raw: string | null, edit: (q: Record<string, any>) => void, fail?: string, readFail?: string) {
  Object.assign(disk, { raw, writes: 0, fail, readFail, toasts: [] });
  const view = new Settings();
  let done: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  view.change(edit, { spawn: (f: (cx: any) => Promise<void>) => f({ notify: () => done() }) });
  await finished;
  return { view, toasts: disk.toasts };
}

test("a change writes settings.json, keeping what else it holds", async () => {
  const { view, toasts } = await change('{"font_size": 15}', (q) => (q.dock_bounce = true));
  expect(JSON.parse(disk.raw!)).toEqual({ font_size: 15, dock_bounce: true });
  expect(view.person).toEqual({ font_size: 15, dock_bounce: true });
  expect(toasts).toEqual([]);
});

test("a broken settings.json is never written over, and says so", async () => {
  const broken = '{"font_size": 15, "theme": "x",}';
  const { toasts } = await change(broken, (q) => (q.dock_bounce = true));
  expect(disk.raw).toBe(broken);
  expect(disk.writes).toBe(0);
  expect(toasts).toEqual([{ title: "settings.json has errors: fix it first", level: "error" }]);
});

test("settings.json that isn't an object counts as broken", async () => {
  for (const raw of ["null", "[]", "3"]) {
    const { toasts } = await change(raw, (q) => (q.dock_bounce = true));
    expect(disk.raw).toBe(raw);
    expect(disk.writes).toBe(0);
    expect(toasts).toEqual([{ title: "settings.json has errors: fix it first", level: "error" }]);
  }
});

test("a write that keeps failing is reported, not dropped", async () => {
  const { toasts } = await change("{}", (q) => (q.dock_bounce = true), "read-only file system");
  expect(disk.writes).toBe(3);
  expect(disk.raw).toBe("{}");
  expect(toasts).toEqual([{ title: "Not saved to settings.json", body: "read-only file system", level: "error" }]);
});

test("a settings.json that can't be read, or an edit that throws, says why", async () => {
  const unread = await change("{}", (q) => (q.dock_bounce = true), undefined, "permission denied");
  expect(disk.writes).toBe(0);
  expect(unread.toasts).toEqual([{ title: "Cannot read settings.json", body: "permission denied", level: "error" }]);
  const thrown = await change("{}", () => { throw new Error("no such section"); });
  expect(disk.writes).toBe(0);
  expect(thrown.toasts).toEqual([{ title: "Cannot read settings.json", body: "no such section", level: "error" }]);
});

/** Presses `keystroke` while the shortcut `old` of `section` is being changed; the toasts. */
async function press(raw: string, keys: any[], capturing: any, e: { key: string; keystroke: string }) {
  Object.assign(disk, { raw, writes: 0, fail: undefined, readFail: undefined, toasts: [], keys });
  const view = new Settings();
  view.person = {};
  view.capturing = capturing;
  view.capture(e, { spawn: (f: (cx: any) => Promise<void>) => f({ notify() {} }) });
  await new Promise((r) => setTimeout(r, 30));
  return view;
}

test("a shortcut moves to the keys pressed, in the same section", async () => {
  const raw = '{"global":{"alt-1":"space.select:1","alt-2":"space.select:2"}}';
  const list = [{ section: "global", keys: "alt-1", action: "space.select:1" }, { section: "global", keys: "alt-2", action: "space.select:2" }];
  const view = await press(raw, list, { section: "global", action: "space.select:1", old: "alt-1" }, { key: "y", keystroke: "ctrl-shift-y" });
  expect(JSON.parse(disk.raw!)).toEqual({ global: { "alt-2": "space.select:2", "ctrl-shift-y": "space.select:1" } });
  expect(view.capturing).toBeNull();
});

test("keys already bound in the section are refused, a bare modifier or Escape change nothing", async () => {
  const raw = '{"global":{"alt-1":"space.select:1","alt-2":"space.select:2"}}';
  const list = [{ section: "global", keys: "alt-1", action: "space.select:1" }, { section: "global", keys: "alt-2", action: "space.select:2" }];
  const capturing = () => ({ section: "global", action: "space.select:1", old: "alt-1" });
  await press(raw, list, capturing(), { key: "x", keystroke: "alt-2" });
  expect(disk.toasts).toEqual([{ title: "Already used by space.select:2", level: "error" }]);
  expect(disk.writes).toBe(0);
  const bare = await press(raw, list, capturing(), { key: "shift", keystroke: "shift" });
  expect(bare.capturing).not.toBeNull();
  const esc = await press(raw, list, capturing(), { key: "escape", keystroke: "escape" });
  expect(esc.capturing).toBeNull();
  expect(disk.writes).toBe(0);
});
