// Thin wrappers around Steam's in-client JS globals. Accessed through `window`
// so this compiles regardless of which typings version is installed.
import type { Assignment, GameKind } from "./backend";

const w = window as any;

const APP_TYPE_SHORTCUT = 1073741824; // non-Steam shortcut

export interface Game {
  appid: number;
  name: string;
  kind: GameKind;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
export const dirname = (p: string) => p.substring(0, p.lastIndexOf("/"));

function toArray(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw instanceof Map) return Array.from(raw.values());
  if (typeof raw.values === "function") return Array.from(raw.values());
  try {
    return Array.from(raw);
  } catch {
    return [];
  }
}

export function liveName(appid: number): string | undefined {
  try {
    return w.appStore?.GetAppOverviewByAppID?.(appid)?.display_name || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Installed Steam games and non-Steam shortcuts, alphabetical. Same logic as
 * Profile Launcher's game dropdowns: installed games and Deck desktop apps
 * come from their own collections; non-Steam shortcuts are also pulled from
 * the full library by app type, in case this Steam build doesn't list them as
 * "local". If nothing turns up, fall back to the whole library rather than
 * showing an empty list.
 */
export function getInstalledGames(): Game[] {
  const seen = new Map<number, { name: string; shortcut: boolean }>();
  const add = (app: any) => {
    if (app?.appid && !seen.has(app.appid)) {
      seen.set(app.appid, {
        name: app.display_name ?? `App ${app.appid}`,
        shortcut: app.app_type === APP_TYPE_SHORTCUT,
      });
    }
  };

  for (const collection of [
    w.collectionStore?.localGamesCollection,
    w.collectionStore?.deckDesktopApps,
  ]) {
    for (const app of toArray(collection?.allApps)) add(app);
  }
  for (const app of toArray(w.collectionStore?.allAppsCollection?.allApps)) {
    if (app?.app_type === APP_TYPE_SHORTCUT) add(app);
  }
  if (!seen.size) {
    for (const app of toArray(w.collectionStore?.allAppsCollection?.allApps)) add(app);
  }

  return [...seen]
    .map(([appid, v]): Game => ({ appid, name: v.name, kind: v.shortcut ? "shortcut" : "steam" }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Build a Game from an appid (used by the game-page button). */
export function getGameByAppId(appid: number): Game | null {
  try {
    const o = w.appStore?.GetAppOverviewByAppID?.(appid);
    if (!o) return null;
    return {
      appid,
      name: o.display_name || `App ${appid}`,
      kind: o.app_type === APP_TYPE_SHORTCUT ? "shortcut" : "steam",
    };
  } catch {
    return null;
  }
}

/** Fetch an app's details (launch options, shortcut target, ...). */
export function getAppDetails(appid: number, timeoutMs = 2500): Promise<any | null> {
  return new Promise((resolve) => {
    try {
      const cached = w.appDetailsStore?.GetAppDetails?.(appid);
      if (cached) return resolve(cached);
    } catch {
      /* fall through to registration */
    }
    let done = false;
    let reg: any;
    const finish = (d: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        reg?.unregister?.();
      } catch {
        /* ignore */
      }
      resolve(d);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      reg = w.SteamClient.Apps.RegisterForAppDetails(appid, (d: any) => finish(d));
      if (done) reg?.unregister?.(); // callback fired synchronously
    } catch {
      finish(null);
    }
  });
}

/** Pull the first `.sh` path out of a launch-options / target string. */
export function findScriptPath(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.match(/"([^"]+?\.sh)"|'([^']+?\.sh)'|(\S+?\.sh)(?=\s|$)/i);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

const escapeRe = (t: string) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/**
 * Exclusion match against a script's file name (case-insensitive).
 * - No `*` in the keyword: plain substring match (original behaviour).
 * - With `*`: glob match against the WHOLE file name, `*` = any run of
 *   characters. So `test*` = starts with "test", `*_old.sh` = ends with
 *   "_old.sh", `ap_*_launch*` = contains ap_<anything>_launch.
 */
export function matchesExclusion(fileName: string, keyword: string): boolean {
  const f = fileName.toLowerCase();
  const k = keyword.toLowerCase();
  if (!k.includes("*")) return f.includes(k);
  const re = new RegExp("^" + k.split("*").map(escapeRe).join(".*") + "$");
  return re.test(f);
}

export function isExcluded(scriptPath: string, exclusions: string[]): boolean {
  const file = basename(scriptPath);
  return exclusions.some((k) => matchesExclusion(file, k));
}

export interface ScannedItem {
  appid: number;
  name: string;
  script: string;
  kind: GameKind;
}

/**
 * The .sh path a game's launch fields currently point at, or null if none.
 * Steam games: Launch Options. Shortcuts: Target, then Launch Options.
 */
function scriptFromDetails(kind: GameKind, d: any): string | null {
  return kind === "steam"
    ? findScriptPath(d?.strLaunchOptions)
    : findScriptPath(d?.strShortcutExe) ??
        findScriptPath(d?.strShortcutLaunchOptions) ??
        findScriptPath(d?.strLaunchOptions);
}

/**
 * True if `d` looks like fully loaded app details. A missing/partial object
 * must not be read as "this game has no script", or a slow Steam response
 * could make us treat a game as having lost its script.
 */
function detailsUsable(kind: GameKind, d: any): boolean {
  if (!d || typeof d !== "object") return false;
  return kind === "steam"
    ? typeof d.strLaunchOptions === "string"
    : [d.strShortcutExe, d.strShortcutLaunchOptions, d.strLaunchOptions].some(
        (v) => typeof v === "string"
      );
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function forEachLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      await fn(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

/**
 * Read-only: looks at installed games' launch options / targets and reports
 * the ones that already point at a .sh script. Never modifies anything.
 */
export async function scanForScripts(
  exclusions: string[],
  skipAppIds: Set<number>
): Promise<ScannedItem[]> {
  const games = getInstalledGames().filter((g) => !skipAppIds.has(g.appid));
  const found: ScannedItem[] = [];

  await forEachLimited(games, 6, async (g) => {
    const d = await getAppDetails(g.appid);
    if (!d) return;
    const script = scriptFromDetails(g.kind, d);
    if (!script) return;
    if (isExcluded(script, exclusions)) return;
    found.push({ appid: g.appid, name: g.name, script, kind: g.kind });
  });

  return found;
}

/**
 * Read-only: of the given assignments, returns the appids whose game no longer
 * has a .sh path in its launch fields (removed outside this plugin). Games
 * whose details Steam couldn't provide are left out, so a slow or failed
 * lookup never causes an entry to be dropped.
 */
export async function findMissingScripts(assignments: Assignment[]): Promise<number[]> {
  const missing: number[] = [];

  await forEachLimited(assignments, 6, async (a) => {
    const d = await getAppDetails(a.appid);
    if (!detailsUsable(a.kind, d)) return;
    if (!scriptFromDetails(a.kind, d)) missing.push(a.appid);
  });

  return missing;
}

/**
 * The script a game is currently set up to launch, if any. Uses the game's
 * real launch fields, so it also finds scripts this plugin hasn't listed.
 * If Steam can't provide the details, falls back to the plugin's own record.
 */
export async function currentScriptFor(
  game: Game,
  assignments: Assignment[]
): Promise<string | null> {
  const d = await getAppDetails(game.appid);
  if (detailsUsable(game.kind, d)) return scriptFromDetails(game.kind, d);
  return assignments.find((a) => a.appid === game.appid)?.script ?? null;
}

/** Clear, then set, the launch fields for a game. */
export async function applyScript(game: Game, scriptPath: string): Promise<void> {
  const A = w.SteamClient.Apps;
  if (game.kind === "steam") {
    A.SetAppLaunchOptions(game.appid, "");
    await sleep(100);
    A.SetAppLaunchOptions(game.appid, `"${scriptPath}" %command%`);
  } else {
    A.SetShortcutExe(game.appid, "");
    A.SetShortcutStartDir(game.appid, "");
    A.SetShortcutLaunchOptions(game.appid, "");
    await sleep(100);
    A.SetShortcutExe(game.appid, `"${scriptPath}"`);
    A.SetShortcutStartDir(game.appid, `${dirname(scriptPath)}/`);
    // Launch Options stays blank
  }
}

/** Clear the launch fields for an assignment. */
export function clearGame(a: Pick<Assignment, "appid" | "kind">): void {
  const A = w.SteamClient.Apps;
  if (a.kind === "steam") {
    A.SetAppLaunchOptions(a.appid, "");
  } else {
    A.SetShortcutExe(a.appid, "");
    A.SetShortcutStartDir(a.appid, "");
    A.SetShortcutLaunchOptions(a.appid, "");
  }
}
