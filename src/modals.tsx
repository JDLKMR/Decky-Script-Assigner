import {
  DialogBody,
  DialogButton,
  DialogHeader,
  DropdownItem,
  Focusable,
  ModalRoot,
  TextField,
} from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaArrowUp, FaCheck, FaFolder, FaTrash } from "react-icons/fa";
import { DirListing, GameKind, Settings, listDir, setExclusions } from "./backend";
import type { Game } from "./steam";

type ModalProps = { closeModal?: () => void };

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  marginBottom: "8px",
};
const labelStyle: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis" };
const subStyle: React.CSSProperties = { fontSize: "0.75em", opacity: 0.6, wordBreak: "break-all" };

/* ------------------------------------------------------------------ */
/* Generic list picker (games, scripts)                                */
/* ------------------------------------------------------------------ */
export interface PickerItem {
  key: string;
  label: string;
  sub?: string;
}

export function ListPickerModal({
  title,
  items,
  emptyText,
  onPick,
  removeAction,
  closeModal,
}: ModalProps & {
  title: string;
  items: PickerItem[];
  emptyText: string;
  onPick: (key: string) => void;
  /** Optional "remove" entry shown above the list (e.g. the game already has a script). */
  removeAction?: { label: string; sub?: string; onPick: () => void };
}) {
  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{title}</DialogHeader>
      <DialogBody>
        {removeAction && (
          <DialogButton
            style={{ ...itemStyle, marginBottom: "16px" }}
            onClick={() => {
              closeModal?.();
              removeAction.onPick();
            }}
          >
            <div style={labelStyle}>
              <FaTrash style={{ marginRight: "8px" }} />
              {removeAction.label}
            </div>
            {removeAction.sub && <div style={subStyle}>{removeAction.sub}</div>}
          </DialogButton>
        )}
        {items.length === 0 && <div style={{ opacity: 0.7 }}>{emptyText}</div>}
        {items.map((it) => (
          <DialogButton
            key={it.key}
            style={itemStyle}
            onClick={() => {
              closeModal?.();
              onPick(it.key);
            }}
          >
            <div style={labelStyle}>{it.label}</div>
            {it.sub && <div style={subStyle}>{it.sub}</div>}
          </DialogButton>
        ))}
      </DialogBody>
    </ModalRoot>
  );
}

/* ------------------------------------------------------------------ */
/* Game picker: "Choose a game…" dropdown + Continue / Cancel          */
/* ------------------------------------------------------------------ */
export function GamePickerModal({
  games,
  currentScripts,
  onPick,
  closeModal,
}: ModalProps & {
  games: Game[];
  /** appid -> file name of the script already assigned, if any */
  currentScripts: Record<number, string>;
  onPick: (game: Game) => void;
}) {
  const options = useMemo(() => games.map((g) => ({ data: g.appid, label: g.name })), [games]);
  const [selected, setSelected] = useState<number | null>(null);
  const settled = useRef(false);

  const settle = (game: Game | null) => {
    if (settled.current) return;
    settled.current = true;
    closeModal?.();
    if (game) onPick(game);
  };

  const chosen = games.find((g) => g.appid === selected);
  const existing = chosen ? currentScripts[chosen.appid] : undefined;

  return (
    <ModalRoot onCancel={() => settle(null)} onEscKeypress={() => settle(null)}>
      <div style={{ fontSize: "1.4em", fontWeight: "bold" }}>Add Script</div>
      <div style={{ marginTop: "8px", opacity: 0.8 }}>
        Choose the game to assign a launch script to.
      </div>

      {games.length === 0 ? (
        <div style={{ marginTop: "16px", opacity: 0.8 }}>
          No installed games were found in your library.
        </div>
      ) : (
        <div style={{ marginTop: "12px" }}>
          <DropdownItem
            label="Game"
            strDefaultLabel="Choose a game…"
            rgOptions={options}
            selectedOption={selected}
            onChange={(option: any) => setSelected(option.data)}
          />
        </div>
      )}

      {existing && (
        <div style={{ marginTop: "8px", opacity: 0.7, fontSize: "0.85em" }}>
          Currently uses {existing}. Picking a new script replaces it.
        </div>
      )}

      <Focusable style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <DialogButton disabled={!chosen} onClick={() => settle(chosen ?? null)}>
          Continue
        </DialogButton>
        <DialogButton onClick={() => settle(null)}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
}

/* ------------------------------------------------------------------ */
/* Folder browser for the scripts directory                            */
/* ------------------------------------------------------------------ */
export function DirectoryBrowserModal({
  startPath,
  onSelect,
  closeModal,
}: ModalProps & { startPath: string; onSelect: (path: string) => void }) {
  const [listing, setListing] = useState<DirListing | null>(null);

  const load = async (p: string) => setListing(await listDir(p));
  useEffect(() => {
    load(startPath);
  }, []);

  const join = (base: string, d: string) => `${base.replace(/\/$/, "")}/${d}`;

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>Scripts directory</DialogHeader>
      <DialogBody>
        <div style={{ ...subStyle, marginBottom: "10px", fontSize: "0.9em" }}>
          {listing?.path ?? "Loading…"}
        </div>
        <DialogButton
          style={itemStyle}
          disabled={!listing}
          onClick={() => {
            if (!listing) return;
            closeModal?.();
            onSelect(listing.path);
          }}
        >
          <FaCheck style={{ marginRight: "8px" }} />
          Use this folder
        </DialogButton>
        {listing?.parent && (
          <DialogButton style={itemStyle} onClick={() => load(listing.parent!)}>
            <FaArrowUp style={{ marginRight: "8px" }} />
            Up one level
          </DialogButton>
        )}
        {listing?.dirs.map((d) => (
          <DialogButton key={d} style={itemStyle} onClick={() => load(join(listing.path, d))}>
            <FaFolder style={{ marginRight: "8px" }} />
            {d}
          </DialogButton>
        ))}
        {listing && listing.dirs.length === 0 && (
          <div style={{ opacity: 0.7 }}>No subfolders here.</div>
        )}
      </DialogBody>
    </ModalRoot>
  );
}

/* ------------------------------------------------------------------ */
/* Exclusions (keywords / * patterns matched against .sh file names)   */
/* ------------------------------------------------------------------ */
export function ExclusionsModal({
  initial,
  onChange,
  closeModal,
}: ModalProps & { initial: string[]; onChange: (s: Settings) => void }) {
  const [list, setList] = useState<string[]>(initial);
  const [text, setText] = useState("");

  const save = async (next: string[]) => {
    const s = await setExclusions(next);
    setList(s.exclusions);
    onChange(s);
  };

  const add = async () => {
    const k = text.trim();
    setText("");
    if (!k) return;
    await save([...list, k]);
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>Scan exclusions</DialogHeader>
      <DialogBody>
        <div style={{ ...subStyle, marginBottom: "10px", fontSize: "0.9em" }}>
          Scan ignores any game whose .sh file name matches one of these, and removes
          matching games it found earlier. A plain keyword matches anywhere in the name.
          With * it must match the whole name, e.g. test*, *_old.sh, ap_*_launch*.
        </div>
        <TextField
          label="Keyword or pattern"
          value={text}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
        />
        <DialogButton style={{ ...itemStyle, marginTop: "8px" }} disabled={!text.trim()} onClick={add}>
          Add exclusion
        </DialogButton>
        {list.length === 0 && <div style={{ opacity: 0.7, marginTop: "8px" }}>No exclusions yet.</div>}
        {list.map((k) => (
          <Focusable
            key={k}
            // @ts-ignore
            style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}
            flow-children="row"
          >
            <div style={{ flex: 1, minWidth: 0, wordBreak: "break-all" }}>{k}</div>
            <DialogButton
              style={{ width: "auto", minWidth: 0, padding: "8px 14px" }}
              onClick={() => save(list.filter((x) => x !== k))}
            >
              Remove
            </DialogButton>
          </Focusable>
        ))}
      </DialogBody>
    </ModalRoot>
  );
}

/* ------------------------------------------------------------------ */
/* Yes/No confirmation, cursor starts on "Yes"                         */
/* ------------------------------------------------------------------ */
export function ConfirmRemoveModal({
  name,
  kind,
  onConfirm,
  closeModal,
}: ModalProps & { name: string; kind: GameKind; onConfirm: () => void }) {
  const what =
    kind === "steam"
      ? "its launch options"
      : "its Target, Start In, and Launch Options fields";
  const wrap = useRef<HTMLDivElement>(null);

  // Belt and braces: make sure the cursor starts on "Yes" (the first button).
  useEffect(() => {
    const t = setTimeout(() => {
      wrap.current?.querySelector<HTMLElement>('[class*="DialogButton"], button')?.focus();
    }, 150);
    return () => clearTimeout(t);
  }, []);

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>Remove script?</DialogHeader>
      <DialogBody>
        <div style={{ marginBottom: "16px" }}>
          Remove the script from <b>{name}</b>? This clears {what}.
        </div>
        <div ref={wrap}>
        <Focusable
          // @ts-ignore
          style={{ display: "flex", gap: "12px" }}
          flow-children="row"
        >
          <DialogButton
            {...({ autoFocus: true } as any)}
            style={{ flex: 1 }}
            onClick={() => {
              closeModal?.();
              onConfirm();
            }}
          >
            Yes
          </DialogButton>
          <DialogButton style={{ flex: 1 }} onClick={() => closeModal?.()}>
            No
          </DialogButton>
        </Focusable>
        </div>
      </DialogBody>
    </ModalRoot>
  );
}
