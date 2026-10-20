// Shared "pick a script and assign it to this game" flow, plus the shared
// "remove this game's script" flow. Used by both the Decky menu and the button
// on game pages.
import { showModal } from "@decky/ui";
import { toaster } from "@decky/api";

import { Settings, getSettings, listScripts, removeAssignment, setAssignment } from "./backend";
import { Game, applyScript, basename, clearGame, currentScriptFor } from "./steam";
import { ConfirmRemoveModal, ListPickerModal } from "./modals";

export const toast = (body: string) => toaster.toast({ title: "Script Assigner", body });

/**
 * Yes/No confirmation, then clear the game's launch fields and drop it from
 * the list. This is the one remove flow: the Remove button in the Decky menu
 * and the Remove option on game pages both go through here.
 */
export function confirmRemoveScript(
  target: Game,
  onSettings?: (s: Settings) => void,
  notify = false
) {
  showModal(
    <ConfirmRemoveModal
      name={target.name}
      kind={target.kind}
      onConfirm={async () => {
        try {
          clearGame(target);
          onSettings?.(await removeAssignment(target.appid));
          if (notify) toast(`Script removed from ${target.name}`);
        } catch (e) {
          console.error("[Script Assigner] remove failed", e);
          toast(`Could not clear ${target.name}`);
        }
      }}
    />
  );
}

/**
 * game.kind decides how the script is applied (see applyScript in steam.ts):
 *  - "steam":    Launch Options  ->  "<script>" %command%
 *  - "shortcut": Target + Start In set to the script, Launch Options blank
 *
 * With `allowRemove`, and if the game currently has a launch script, the
 * picker also offers to remove it.
 */
export async function startAssign(
  game: Game,
  onSettings?: (s: Settings) => void,
  opts: { allowRemove?: boolean } = {}
) {
  try {
    const s = await getSettings();
    const current = opts.allowRemove ? await currentScriptFor(game, s.assignments) : null;
    const hasDirs = s.scriptDirs.length > 0;

    // Nothing to pick from and nothing to remove: there is no point in a menu.
    if (!hasDirs && !current) {
      toast("Add a scripts directory first (Script directories, in the Script Assigner menu).");
      return;
    }

    const scripts = hasDirs ? await listScripts() : [];
    // With several directories, say which one each script comes from.
    const multi = s.scriptDirs.length > 1;
    const short = (p: string) => p.replace(/^\/home\/deck(?=\/|$)/, "~");
    const where = (sc: { dir: string; rel: string }) =>
      multi ? (sc.rel ? `${short(sc.dir)}/${sc.rel}` : short(sc.dir)) : sc.rel || undefined;
    showModal(
      <ListPickerModal
        title={`Script for ${game.name}`}
        emptyText={
          !hasDirs
            ? "No script directories set. Add one in the Script Assigner menu to assign a script."
            : multi
              ? "No .sh files found in your script directories"
              : `No .sh files found in ${s.scriptDirs[0].path}`
        }
        items={scripts.map((sc) => ({ key: sc.path, label: sc.name, sub: where(sc) }))}
        removeAction={
          current
            ? {
                label: "Remove current script",
                sub: basename(current),
                onPick: () => confirmRemoveScript(game, onSettings, true),
              }
            : undefined
        }
        onPick={async (path: string) => {
          try {
            await applyScript(game, path);
            const next = await setAssignment(game.appid, game.name, path, game.kind, "added");
            onSettings?.(next);
            toast(`${basename(path)} assigned to ${game.name}`);
          } catch (e) {
            console.error("[Script Assigner] assign failed", e);
            toast(`Could not assign a script to ${game.name}`);
          }
        }}
      />
    );
  } catch (e) {
    console.error("[Script Assigner] could not start assign", e);
    toast("Could not open the script list.");
  }
}
