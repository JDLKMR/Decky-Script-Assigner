import {
  ButtonItem,
  DialogButton,
  Focusable,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  showModal,
  staticClasses,
} from "@decky/ui";
import { definePlugin, routerHook } from "@decky/api";
import { Fragment, useEffect, useState } from "react";
import { FaChevronDown, FaChevronRight, FaTerminal } from "react-icons/fa";

import {
  Assignment,
  Settings,
  addAssignments,
  getSettings,
  removeAssignments,
  addDirectory,
  removeDirectory,
  setDirectorySubdirs,
  setShowGameButton,
} from "./backend";
import { confirmRemoveScript, startAssign, toast } from "./assign";
import { GameButtonHost, setGameButtonEnabled } from "./gameButton";
import {
  Game,
  basename,
  findMissingScripts,
  getInstalledGames,
  isExcluded,
  liveName,
  scanForScripts,
} from "./steam";
import {
  DirectoryBrowserModal,
  ExclusionsModal,
  GamePickerModal,
} from "./modals";

const GLOBAL_NAME = "ScriptAssignerGameButton";

function Content() {
  const [s, setS] = useState<Settings | null>(null);
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  useEffect(() => {
    getSettings().then(setS);
  }, []);

  if (!s) return <PanelSection>Loading…</PanelSection>;

  const nameOf = (a: Assignment) => liveName(a.appid) ?? a.name;
  const sorted = [...s.assignments].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" })
  );

  /* ---- Add Script ---------------------------------------------------- */
  const pickScript = (game: Game) => startAssign(game, setS);

  const startAdd = () => {
    if (s.scriptDirs.length === 0) {
      toast("Add a scripts directory first (Script directories, below).");
      return;
    }
    const games = getInstalledGames();
    if (games.length === 0) {
      toast("No installed games found.");
      return;
    }
    const currentScripts: Record<number, string> = {};
    for (const a of s.assignments) currentScripts[a.appid] = basename(a.script);
    showModal(
      <GamePickerModal games={games} currentScripts={currentScripts} onPick={pickScript} />,
      window
    );
  };

  /* ---- Remove -------------------------------------------------------- */
  const confirmRemove = (a: Assignment) =>
    confirmRemoveScript({ appid: a.appid, name: nameOf(a), kind: a.kind }, setS);

  /* ---- Scan (never touches launch options) --------------------------- */
  const doScan = async () => {
    setScanning(true);
    setScanMsg("Scanning…");
    try {
      const known = new Set(s.assignments.map((a) => a.appid));

      // Drop entries from the list (list entry only: the game's launch options
      // are left exactly as they are) when:
      //  1. a scan-found entry now matches an exclusion. Games added manually
      //     via Add Script are kept (change `a.source === "scan"` to `true` if
      //     you want exclusions to remove those too), or
      //  2. the game no longer has a .sh path in its launch options/target,
      //     e.g. it was cleared in Steam's own game properties. This applies
      //     to every entry, however it was added.
      const excluded = s.assignments
        .filter((a) => a.source === "scan" && isExcluded(a.script, s.exclusions))
        .map((a) => a.appid);
      const excludedSet = new Set(excluded);
      const gone = await findMissingScripts(s.assignments.filter((a) => !excludedSet.has(a.appid)));
      const stale = [...excluded, ...gone];
      if (stale.length > 0) setS(await removeAssignments(stale));

      const items = await scanForScripts(s.exclusions, known);
      if (items.length > 0) setS(await addAssignments(items));

      const parts: string[] = [];
      if (items.length > 0) parts.push(`${items.length} added`);
      if (stale.length > 0) parts.push(`${stale.length} removed`);
      setScanMsg(parts.length ? `Done — ${parts.join(", ")}` : "Done — no changes");
    } catch (e) {
      console.error("[Script Assigner] scan failed", e);
      setScanMsg("Scan failed.");
    } finally {
      setScanning(false);
    }
    setTimeout(() => setScanMsg(""), 5000);
  };

  /* ---- Settings ------------------------------------------------------ */
  const addDir = () =>
    showModal(
      <DirectoryBrowserModal
        startPath={s.scriptDirs[s.scriptDirs.length - 1]?.path || "/home/deck"}
        onSelect={async (p) => setS(await addDirectory(p))}
      />
    );

  const editExclusions = () =>
    showModal(<ExclusionsModal initial={s.exclusions} onChange={setS} />);

  return (
    <>
      <PanelSection title="Games">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={startAdd}>
            Add Script
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setOpen(!open)}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {open ? <FaChevronDown /> : <FaChevronRight />}
              <span>Assigned ({s.assignments.length})</span>
            </div>
          </ButtonItem>
        </PanelSectionRow>

        {open && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={scanning} onClick={doScan}>
              {scanMsg || "Scan library for .sh launchers"}
            </ButtonItem>
          </PanelSectionRow>
        )}

        {open && s.assignments.length === 0 && (
          <PanelSectionRow>
            <div style={{ opacity: 0.7 }}>No games yet. Use Add Script or Scan.</div>
          </PanelSectionRow>
        )}

        {open &&
          sorted.map((a) => (
            <PanelSectionRow key={a.appid}>
              <Focusable
                // @ts-ignore
                style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}
                flow-children="row"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {nameOf(a)}
                  </div>
                  <div
                    style={{
                      fontSize: "0.75em",
                      opacity: 0.6,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {basename(a.script)}
                  </div>
                </div>
                <DialogButton
                  style={{ width: "auto", minWidth: 0, padding: "8px 12px", flexShrink: 0 }}
                  onClick={() => confirmRemove(a)}
                >
                  Remove
                </DialogButton>
              </Focusable>
            </PanelSectionRow>
          ))}

      </PanelSection>

      <PanelSection title="Script directories">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={addDir}
            description={s.scriptDirs.length === 0 ? "None set" : undefined}
          >
            Add Directory
          </ButtonItem>
        </PanelSectionRow>
        {s.scriptDirs.map((d) => (
          <Fragment key={d.path}>
            <PanelSectionRow>
              <ToggleField
                label={d.path}
                description="Include subdirectories"
                checked={d.subdirs}
                onChange={async (v: boolean) => setS(await setDirectorySubdirs(d.path, v))}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={async () => setS(await removeDirectory(d.path))}>
                Remove
              </ButtonItem>
            </PanelSectionRow>
          </Fragment>
        ))}
      </PanelSection>

      <PanelSection title="Settings">
        <PanelSectionRow>
          <ToggleField
            label="Button on game pages"
            description="Adds a button next to the Controller button to assign or remove a script"
            checked={s.showGameButton}
            onChange={async (v: boolean) => {
              setGameButtonEnabled(v);
              setS(await setShowGameButton(v));
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={editExclusions}
            description={
              s.exclusions.length > 0 ? s.exclusions.join(", ") : "Keywords/patterns for Scan to ignore"
            }
          >
            Exclusions
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  getSettings()
    .then((st) => setGameButtonEnabled(st.showGameButton !== false))
    .catch(() => {});
  routerHook.addGlobalComponent(GLOBAL_NAME, GameButtonHost);

  return {
    name: "Script Assigner",
    titleView: <div className={staticClasses.Title}>Script Assigner</div>,
    content: <Content />,
    icon: <FaTerminal />,
    onDismount() {
      routerHook.removeGlobalComponent(GLOBAL_NAME);
    },
  };
});
