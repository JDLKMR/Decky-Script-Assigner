// Script button on a game's library page (assign a script, or remove the
// current one), placed just left of the Controller button. Injected by DOM (the page's React tree is closed-source
// and shifts between Steam builds) and rendered through a portal so it is a
// real Decky Focusable. If anything about the page isn't found it quietly
// does nothing.
import { Focusable, Router, playSectionClasses } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaTerminal } from "react-icons/fa";

import { startAssign, toast } from "./assign";
import { getGameByAppId } from "./steam";

let enabled = true;
export const setGameButtonEnabled = (v: boolean) => {
  enabled = v;
};

const TAG = "[Script Assigner]";
const MARK = "data-script-assigner";

interface NavCtx {
  Provider: any;
  value: any;
}

interface Slot {
  host: HTMLElement;
  appid: number;
  side: number;
  cls: string;
  nav: NavCtx | null;
}

function mainWindow(): { win: Window; routerPath: string } {
  const inst: any = (Router as any)?.WindowStore?.GamepadUIMainWindowInstance;
  const win: Window = inst?.BrowserWindow ?? window;
  return { win, routerPath: String(inst?.LocationPathName ?? "") };
}

const appIdFromPath = (p: string): number | null => {
  const m = p.match(/\/library\/app\/(\d+)/);
  return m ? Number(m[1]) : null;
};

/**
 * The Controller button may be wrapped (or the class may sit on an inner
 * element), so inserting next to it directly can stack our button above it.
 * Climb to the element that is actually an item of the button row: a child of
 * a horizontal flex container holding several items.
 */
function findRowItem(start: HTMLElement, win: Window): HTMLElement | null {
  let node = start;
  for (let i = 0; i < 6; i++) {
    const p = node.parentElement;
    if (!p) return null;
    const cs = win.getComputedStyle(p);
    const siblings = Array.from(p.children).filter((c) => !c.hasAttribute(MARK));
    const nodeW = node.getBoundingClientRect().width;
    if (
      cs.display.includes("flex") &&
      cs.flexDirection.startsWith("row") &&
      siblings.length > 1 &&
      p.getBoundingClientRect().width > nodeW * 1.5
    ) {
      return node;
    }
    node = p;
  }
  return null;
}

function describeChain(start: HTMLElement, win: Window): string[] {
  const out: string[] = [];
  let n: HTMLElement | null = start;
  for (let i = 0; n && i < 7; i++, n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    out.push(
      `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 80)} display=${cs.display} dir=${cs.flexDirection} kids=${n.children.length}`
    );
  }
  return out;
}

/**
 * Controller (D-pad) focus: a Focusable registers itself under the nearest
 * focus-navigation context above it in the React tree. Our portal lives under
 * Decky's global component, so by default it registers in the wrong place and
 * the D-pad never reaches it. Read the context the page's own buttons are
 * registered under (from the React fiber of the row item) and re-provide it.
 */
const fiberOf = (el: Element): any => {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  return key ? (el as any)[key] : null;
};

const looksLikeNavNode = (v: any): boolean =>
  !!v &&
  typeof v === "object" &&
  (typeof v.BTakeFocus === "function" ||
    typeof v.BFocusWithin === "function" ||
    Array.isArray(v.m_rgChildren));

function findNavContext(el: Element): NavCtx | null {
  let f = fiberOf(el);
  for (let i = 0; f && i < 40; i++, f = f.return) {
    let dep = f.dependencies?.firstContext;
    while (dep) {
      if (dep.context?.Provider && looksLikeNavNode(dep.memoizedValue)) {
        return { Provider: dep.context.Provider, value: dep.memoizedValue };
      }
      dep = dep.next;
    }
  }
  return null;
}

function ScriptButton({ slot }: { slot: Slot }) {
  const lastRun = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const [lit, setLit] = useState(false); // hovered or focused

  const refresh = () => setLit(hovered.current || focused.current);

  // Steam marks the focused element with a "gpfocus" class (hover focuses it too).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      focused.current = el.classList.contains("gpfocus");
      refresh();
    };
    const mo = new MutationObserver(check);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    check();
    return () => mo.disconnect();
  }, []);

  const run = () => {
    // Touch/click and controller A can both fire; only act once.
    const now = Date.now();
    if (now - lastRun.current < 700) return;
    lastRun.current = now;
    const game = getGameByAppId(slot.appid);
    if (!game) {
      toast("Could not read this game's details.");
      return;
    }
    startAssign(game, undefined, { allowRemove: true });
  };
  return (
    <Focusable
      ref={ref}
      className={slot.cls}
      noFocusRing
      style={{
        width: slot.side,
        height: slot.side,
        minWidth: 0,
        padding: 0,
        flexShrink: 0,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        outline: "none",
      }}
      onActivate={run}
      onClick={run}
      onMouseEnter={() => {
        hovered.current = true;
        refresh();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        refresh();
      }}
    >
      {/* While highlighted the button background turns light; "difference"
          blending inverts the icon against whatever is behind it, like the
          neighbouring buttons' icons do. */}
      <FaTerminal
        size={Math.round(slot.side * 0.45)}
        style={lit ? { color: "#fff", mixBlendMode: "difference" } : undefined}
      />
    </Focusable>
  );
}

let warnedNoRow = false;

/** Mounted once as a Decky global component. */
export function GameButtonHost() {
  const [slot, setSlot] = useState<Slot | null>(null);

  useEffect(() => {
    let host: HTMLElement | null = null;
    let nav: NavCtx | null = null;
    let current: Slot | null = null;

    const clear = () => {
      host?.remove();
      host = null;
      if (current) {
        current = null;
        setSlot(null);
      }
    };

    const tick = () => {
      try {
        const { win, routerPath } = mainWindow();
        const appid = enabled
          ? appIdFromPath(routerPath) ?? appIdFromPath(win.location?.pathname ?? "")
          : null;
        const ctrlClass = (playSectionClasses as any)?.ControllerConfigButton as string | undefined;
        if (!appid || !ctrlClass) return clear();

        // Our own button carries the Controller button's classes, so it must be
        // excluded or it would find itself and fight over its own placement.
        const ctrl = Array.from(win.document.getElementsByClassName(ctrlClass)).find(
          (el) => !el.closest(`[${MARK}]`) && (el as HTMLElement).getBoundingClientRect().width > 0
        ) as HTMLElement | undefined;
        if (!ctrl) return clear();

        const item = findRowItem(ctrl, win);
        if (!item || !item.parentElement) {
          if (!warnedNoRow) {
            warnedNoRow = true;
            console.warn(TAG, "could not find the button row; structure:", describeChain(ctrl, win));
            toast("Couldn't place the game-page button on this Steam build.");
          }
          return clear();
        }

        if (!host || host.nextSibling !== item) {
          host?.remove();
          host = win.document.createElement("div");
          host.setAttribute(MARK, "");
          host.style.display = "contents";
          item.parentElement.insertBefore(host, item);
          nav = findNavContext(item) ?? findNavContext(ctrl);
          console.log(
            TAG,
            "button placed; row:",
            item.parentElement.className,
            "| focus context found:",
            !!nav
          );
        }

        const r = ctrl.getBoundingClientRect();
        const side = Math.round(Math.min(r.width, r.height));
        // Same look as the Controller button, minus any focus/state classes.
        const cls = Array.from(ctrl.classList)
          .filter((c) => !/gpfocus|focus|active|disabled/i.test(c))
          .join(" ");

        if (
          !current ||
          current.host !== host ||
          current.appid !== appid ||
          current.side !== side ||
          current.cls !== cls
        ) {
          current = { host, appid, side, cls, nav };
          setSlot(current);
        }
      } catch (e) {
        console.error(TAG, "game button update failed", e);
      }
    };

    const timer = setInterval(tick, 400);
    tick();
    return () => {
      clearInterval(timer);
      host?.remove();
    };
  }, []);

  if (!slot) return null;
  const NavProvider = slot.nav?.Provider;
  const button = <ScriptButton slot={slot} />;
  return createPortal(
    NavProvider ? <NavProvider value={slot.nav!.value}>{button}</NavProvider> : button,
    slot.host
  );
}
