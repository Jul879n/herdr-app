// The Office Assistant, floating over the desktop. When an agent needs you
// (blocked) or finished while you looked away (done), it pops a balloon that
// takes you there. Click it for a tip. Display Properties (or its balloon)
// hides it; Start > Programs > Accessories brings it back.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { tr, agents, run, shared, setShared, placement } from "herdr";
import { C, ASSETS, unit, root, button, label, sfx, own } from "./kit.js";

const TIPS = [
  "win98.it_looks_like_you_re_herding",
  "win98.click_a_tab_s_taskbar_button",
  "win98.ctrl_shift_esc_opens_close_program_every",
  "win98.right_click_a_folder_on_the",
  "win98.waiting_on_an_agent_mines",
  "win98.double_click_a_window_s_title_bar",
  "win98.start_run_opens_any",
  "win98.shut_down_restart_in",
  "win98.log_off_takes_you_back",
];

export default class Clippy {
  init() {
    this.dismissed = new Set();
    this.tip = null;
  }

  news() {
    const list = agents()
      .filter((a) => (a.status === "blocked" || a.status === "done") && !a.focused)
      .filter((a) => !this.dismissed.has(`${a.address}:${a.status}`))
      .sort((a, b) => (a.status === "blocked") - (b.status === "blocked") || a.seq - b.seq);
    return list.pop() ?? null;
  }

  render(_cx) {
    if (shared("win98.clippy") === "off") return div();
    const u = unit();
    const a = this.news();
    const right = placement()?.edge !== "left";
    let balloon = null;
    if (a) {
      const name = a.program?.name ?? a.app ?? tr("win98.your_agent");
      const where = `'${a.space_name} \\ ${a.tab_name}'`;
      const text =
        a.status === "blocked"
          ? tr("win98.it_looks_like_name_in", { name, where })
          : tr("win98.it_looks_like_name_finished", { name, where });
      balloon = this.balloon(u, text, [
        [tr("win98.take_me_there"), () => {
          run("agent.focus", { terminal: a.address });
          this.dismissed.add(`${a.address}:${a.status}`);
        }],
        [tr("win98.not_now"), () => this.dismissed.add(`${a.address}:${a.status}`)],
      ]);
    } else if (this.tip !== null) {
      balloon = this.balloon(u, tr(TIPS[this.tip % TIPS.length]), [
        [tr("win98.next_tip"), () => (this.tip = (this.tip + 1) % TIPS.length)],
        [tr("win98.close"), () => (this.tip = null)],
        [tr("win98.hide_me"), () => setShared("win98.clippy", "off")],
      ]);
    }
    // Clean the dismissed list once their agents moved on.
    for (const k of [...this.dismissed]) {
      const [addr, st] = k.split(":");
      if (!agents().some((x) => x.address === addr && x.status === st)) this.dismissed.delete(k);
    }
    const clip = own(
      div()
        .id("clippy")
        .relative()
        .flex_none()
        .cursor_pointer()
        .when(Boolean(a), (el) => el.loop("top", { from: 0, to: u(-5), period: 800 }))
        .on_click((_e, cx) => {
          this.tip = this.tip === null ? Math.floor(Math.random() * TIPS.length) : null;
          sfx("clippy");
          cx.notify();
        })
        .child(image(`${ASSETS}/img/clippy.svg`).w(u(64)).h(u(80))),
    );
    return root(
      u,
      v_flex()
        .p(u(4))
        .gap(u(2))
        .map((el) => (right ? el.items_end() : el.items_start())),
    )
      .when(Boolean(balloon), (el) => el.child(balloon))
      .child(clip);
  }

  balloon(u, text, actions) {
    return v_flex()
      .w(u(200))
      .p(u(8))
      .gap(u(8))
      .bg(C.tip)
      .border(u(1))
      .border_color(C.text)
      .rounded(u(8))
      .child(
        v_flex().children(
          String(text)
            .split("\n")
            .map((l) => div().child(l || " ")),
        ),
      )
      .child(
        v_flex()
          .gap(u(3))
          .children(
            actions.map(([t, fn], i) =>
              own(
                h_flex()
                  .id(`clip-${i}`)
                  .gap(u(5))
                  .items_center()
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    fn();
                    cx.notify();
                  })
                  .child(div().w(u(7)).h(u(7)).rounded(u(4)).bg(C.navy))
                  .child(div().text_color(C.navy).underline().child(t)),
              ),
            ),
          ),
      );
  }
}
