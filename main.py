import copy
import json
import os

import decky

SETTINGS_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")

DEFAULTS = {
    # each: {path, subdirs}  (subdirs = also look in that directory's subfolders)
    "scriptDirs": [],
    "exclusions": [],
    "showGameButton": True,
    # each: {appid, name, script, kind: "steam"|"shortcut", source: "added"|"scan"}
    "assignments": [],
}

MAX_SCRIPTS = 5000


def _load() -> dict:
    data = {}
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError, OSError):
        pass
    merged = copy.deepcopy(DEFAULTS)
    if isinstance(data, dict):
        merged.update({k: v for k, v in data.items() if k in DEFAULTS})
        # Settings saved before multiple directories existed: one dir + one global toggle.
        if "scriptDirs" not in data and data.get("scriptDir"):
            merged["scriptDirs"] = [
                {"path": str(data["scriptDir"]), "subdirs": bool(data.get("includeSubdirs"))}
            ]
    merged["scriptDirs"] = [
        {"path": d["path"], "subdirs": bool(d.get("subdirs"))}
        for d in merged["scriptDirs"]
        if isinstance(d, dict) and isinstance(d.get("path"), str) and d["path"]
    ]
    return merged


def _save(data: dict) -> dict:
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, SETTINGS_FILE)
    return data


def _collect_scripts(directory: str, recurse: bool) -> list:
    results = []
    if not directory or not os.path.isdir(directory):
        return results

    def add(root: str, filename: str):
        if filename.startswith(".") or not filename.lower().endswith(".sh"):
            return
        full = os.path.join(root, filename)
        if not os.path.isfile(full):
            return
        rel = os.path.relpath(root, directory)
        results.append(
            {"name": filename, "path": full, "rel": "" if rel == "." else rel, "dir": directory}
        )

    try:
        if recurse:
            for root, dirs, files in os.walk(directory):
                dirs[:] = sorted(d for d in dirs if not d.startswith("."))
                for filename in files:
                    add(root, filename)
                if len(results) >= MAX_SCRIPTS:
                    break
        else:
            for filename in os.listdir(directory):
                add(directory, filename)
    except OSError as e:
        decky.logger.error(f"Failed to list scripts in {directory}: {e}")

    results.sort(key=lambda r: (r["name"].lower(), r["path"].lower()))
    return results[:MAX_SCRIPTS]


class Plugin:
    async def _main(self):
        # Deliberately does nothing but log: no scanning on install/load.
        decky.logger.info("Script Assigner loaded")

    async def _unload(self):
        decky.logger.info("Script Assigner unloaded")

    # ---- settings -------------------------------------------------------
    async def get_settings(self) -> dict:
        return _load()

    async def add_directory(self, path: str) -> dict:
        s = _load()
        p = os.path.normpath(os.path.expanduser(path))
        if not any(d["path"] == p for d in s["scriptDirs"]):
            s["scriptDirs"].append({"path": p, "subdirs": False})
        return _save(s)

    async def remove_directory(self, path: str) -> dict:
        s = _load()
        s["scriptDirs"] = [d for d in s["scriptDirs"] if d["path"] != path]
        return _save(s)

    async def set_directory_subdirs(self, path: str, value: bool) -> dict:
        s = _load()
        for d in s["scriptDirs"]:
            if d["path"] == path:
                d["subdirs"] = bool(value)
        return _save(s)

    async def set_exclusions(self, exclusions: list) -> dict:
        s = _load()
        cleaned, seen = [], set()
        for k in exclusions:
            k = str(k).strip()
            if k and k.lower() not in seen:
                seen.add(k.lower())
                cleaned.append(k)
        s["exclusions"] = cleaned
        return _save(s)

    async def set_show_game_button(self, value: bool) -> dict:
        s = _load()
        s["showGameButton"] = bool(value)
        return _save(s)

    # ---- filesystem -----------------------------------------------------
    async def list_dir(self, path: str) -> dict:
        p = os.path.abspath(os.path.expanduser(path or decky.DECKY_USER_HOME))
        while p != "/" and not os.path.isdir(p):
            p = os.path.dirname(p)
        try:
            dirs = sorted(
                (d for d in os.listdir(p)
                 if not d.startswith(".") and os.path.isdir(os.path.join(p, d))),
                key=str.lower,
            )
        except OSError:
            dirs = []
        return {"path": p, "parent": None if p == "/" else os.path.dirname(p), "dirs": dirs}

    async def list_scripts(self) -> list:
        s = _load()
        seen, results = set(), []
        for d in s["scriptDirs"]:
            for r in _collect_scripts(d["path"], d["subdirs"]):
                if r["path"] in seen:  # overlapping directories
                    continue
                seen.add(r["path"])
                results.append(r)
        results.sort(key=lambda r: (r["name"].lower(), r["path"].lower()))
        return results[:MAX_SCRIPTS]

    # ---- assignments ----------------------------------------------------
    async def set_assignment(self, appid: int, name: str, script: str, kind: str, source: str) -> dict:
        s = _load()
        s["assignments"] = [a for a in s["assignments"] if a.get("appid") != appid]
        s["assignments"].append(
            {"appid": appid, "name": name, "script": script, "kind": kind, "source": source}
        )
        return _save(s)

    async def add_assignments(self, items: list) -> dict:
        s = _load()
        known = {a.get("appid") for a in s["assignments"]}
        for it in items:
            if it["appid"] in known:
                continue
            known.add(it["appid"])
            s["assignments"].append(
                {
                    "appid": it["appid"],
                    "name": it["name"],
                    "script": it["script"],
                    "kind": it["kind"],
                    "source": "scan",
                }
            )
        return _save(s)

    async def remove_assignments(self, appids: list) -> dict:
        s = _load()
        drop = set(appids)
        s["assignments"] = [a for a in s["assignments"] if a.get("appid") not in drop]
        return _save(s)

    async def remove_assignment(self, appid: int) -> dict:
        s = _load()
        s["assignments"] = [a for a in s["assignments"] if a.get("appid") != appid]
        return _save(s)
