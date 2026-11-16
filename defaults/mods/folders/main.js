// Folder search: fuzzy over an index of this computer's folders, or walk a
// path you type (starts with / or ~). Enter opens a space in the folder,
// Tab steps into it, Esc closes. The index is rebuilt each time it opens.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, home, appHome, readTextFile, checking, pickFolder, run, theme, props, closeOverlay, tr } from "herdr";

const SHOWN = 10;
const ROW_H = 32;
const INDEX = 'for r in "$@"; do find "$r" -maxdepth 4 \\( -name ".*" -o -name node_modules -o -name target -o -name vendor -o -name dist -o -name build -o -name __pycache__ \\) -prune -o -type d -print 2>/dev/null; done | head -n 20000';
const LIST = 'find "$1" -mindepth 1 -maxdepth 1 -type d ! -name ".*" 2>/dev/null | sort | head -n 500';

// Fuzzy score of `q` in `text`, with the matched positions; null: no match.
function fuzzy(q, text) {
  const t = text.toLowerCase();
  let score = 0;
  let at = 0;
  let run = 0;
  const hits = [];
  for (const ch of q) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    const start = i === 0 || /[\s:.\-_/]/.test(t[i - 1]);
    run = i === at && hits.length ? run + 1 : 0;
    score += 1 + (start ? 6 : 0) + run * 3 - Math.min(i - at, 6) * 0.3;
    hits.push(i);
    at = i + 1;
  }
  return { score: score - text.length * 0.02, hits };
}

export default class Folders extends View {
  init(_props, cx) {
    this.home = home();
    this.query = "";
    this.at = 0;
    this.first = 0;
    this.roots = ["~"];
    this.index = JSON.parse(localStorage.getItem("index") ?? "null");
    this.recent = JSON.parse(localStorage.getItem("recent") ?? "[]");
    this.listing = {};
    this.input = InputState.new({ placeholder: tr("folders.placeholder") });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; this.first = 0; this.load(this.query, cx); cx.notify(); });
    this.input.on("submit", () => this.open(this.rows()[this.at]?.path ?? this.typed()));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    if (checking()) return;
    cx.spawn(async (cx) => {
      try {
        const raw = await readTextFile(`${appHome()}/settings.json`);
        const roots = raw ? JSON.parse(raw)?.folders?.roots : null;
        if (Array.isArray(roots) && roots.length) this.roots = roots.filter((r) => typeof r === "string");
      } catch { /* a broken settings.json: the default root */ }
      try {
        const r = await exec("sh", ["-c", INDEX, "folders", ...this.roots.map((r) => this.expand(r))], { timeout: 60000 });
        this.index = r.stdout.split("\n").filter(Boolean);
        localStorage.setItem("index", JSON.stringify(this.index));
      } catch { /* keep the index from last time */ }
      this.indexed = true;
      cx.notify();
    });
  }

  expand(p) {
    return p === "~" ? this.home : p.startsWith("~/") ? this.home + p.slice(1) : p;
  }

  short(p) {
    return p === this.home ? "~" : p.startsWith(this.home + "/") ? "~" + p.slice(this.home.length) : p;
  }

  isPath() {
    return this.query.startsWith("/") || this.query.startsWith("~");
  }

  // The folder a path query lists, and what's typed after it.
  split(q) {
    const cut = q.lastIndexOf("/");
    if (cut < 0) return { dir: q, partial: "" };
    return { dir: q.slice(0, cut + 1), partial: q.slice(cut + 1) };
  }

  typed() {
    return this.isPath() ? this.expand(this.query.trim().replace(/(.)\/$/, "$1")) : null;
  }

  load(q, cx) {
    if (!q.startsWith("/") && !q.startsWith("~")) return;
    const dir = this.expand(this.split(q).dir || "/");
    if (this.listing[dir]) return;
    this.listing[dir] = [];
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", LIST, "folders", dir], { timeout: 10000 });
        this.listing[dir] = r.stdout.split("\n").filter(Boolean);
      } catch { /* no listing: no rows */ }
      cx.notify();
    });
  }

  open(path) {
    if (!path) return;
    this.recent = [path, ...this.recent.filter((r) => r !== path)].slice(0, 20);
    localStorage.setItem("recent", JSON.stringify(this.recent));
    closeOverlay(props().overlay);
    run("space.new", { folder: path, machine: "" });
  }

  // The system's folder picker; the chosen folder opens like any other.
  browse(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: tr("folders.pick_prompt") });
      if (folder) this.open(folder);
      cx.notify();
    });
  }

  // A space with no folder chosen.
  blank() {
    closeOverlay(props().overlay);
    run("space.new");
  }

  rows() {
    const q = this.query.trim();
    if (!q) return this.recent.map((path) => ({ path, label: this.short(path), hits: [], head: tr("folders.recent") }));
    if (this.isPath()) {
      const { dir, partial } = this.split(q);
      const base = this.expand(dir || "/");
      return (this.listing[base] ?? [])
        .map((path) => {
          const name = path.slice(path.lastIndexOf("/") + 1);
          if (!partial) return { path, label: name, hits: [] };
          const m = fuzzy(partial.toLowerCase(), name);
          return m && { path, label: name, hits: m.hits, score: m.score };
        })
        .filter(Boolean)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }
    const needle = q.toLowerCase().replace(/\s+/g, "");
    return (this.index ?? [])
      .map((path) => {
        const label = this.short(path);
        const m = fuzzy(needle, label);
        return m && { path, label, hits: m.hits, score: m.score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200);
  }

  text(t, label, hits, on) {
    if (!hits.length) return div().text_color(on ? t.foreground : t.muted).child(label);
    const parts = [];
    let cur = "";
    let lit = false;
    [...label].forEach((ch, i) => {
      const h = hits.includes(i);
      if (h !== lit && cur) { parts.push([cur, lit]); cur = ""; }
      lit = h;
      cur += ch;
    });
    if (cur) parts.push([cur, lit]);
    return h_flex().children(parts.map(([s, h]) => div().text_color(h ? t.accent : on ? t.foreground : t.muted).when(h, (d) => d.font_semibold()).child(s.replace(/ /g, " "))));
  }

  action(t, id, icon, label, onClick) {
    return h_flex().id(id).h(32).px(12).gap(8).items_center().rounded(7).border_1().border_color(t.border).bg(t.raised)
      .cursor_pointer().text_size(12.5).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(svg(icon).size(14).text_color(t.dim)).child(label);
  }

  render() {
    const t = theme();
    const rows = this.rows();
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    if (this.at < this.first) this.first = this.at;
    if (this.at >= this.first + SHOWN) this.first = this.at - SHOWN + 1;
    const shown = rows.slice(this.first, this.first + SHOWN);
    const empty = this.query.trim() ? tr("folders.empty") : this.index ? tr("folders.empty") : tr("folders.indexing");
    return v_flex().id("folders").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return closeOverlay(props().overlay);
        if (k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up") this.at = Math.max(this.at - 1, 0);
        else if (k === "pagedown") this.at = Math.min(this.at + SHOWN, rows.length - 1);
        else if (k === "pageup") this.at = Math.max(this.at - SHOWN, 0);
        else if (k === "tab" && rows[this.at]) {
          const next = this.short(rows[this.at].path) + "/";
          this.input.set_value(next);
          this.query = next;
          this.at = 0;
          this.first = 0;
          this.load(next, cx);
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(36).flex_none().px(10).gap(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(16).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(rows.length
        ? v_flex().mb(6).children(shown.map((r, n) => {
            const i = this.first + n;
            const on = i === this.at;
            return h_flex().id(`fo-${i}`).h(ROW_H).flex_none().mx(6).px(10).gap(10).items_center().rounded(7).cursor_pointer().text_size(12.8)
              .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
              .on_click(() => this.open(r.path))
              .child(svg("mods/workspace-chrome/folder.svg").size(14).text_color(t.dim))
              .child(div().flex_1().min_w(0).truncate().child(this.text(t, r.label, r.hits, on)));
          }))
        : div().px(16).py(14).text_size(13).text_color(t.dim).child(empty))
      .child(h_flex().gap(8).flex_none()
        .child(this.action(t, "fo-browse", "mods/workspace-chrome/folder-plus.svg", tr("folders.browse"), (_e, cx) => this.browse(cx)))
        .child(this.action(t, "fo-blank", "mods/workspace-chrome/plus.svg", tr("folders.blank"), () => this.blank())));
  }
}
