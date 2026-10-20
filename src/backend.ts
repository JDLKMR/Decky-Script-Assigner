import { callable } from "@decky/api";

export type GameKind = "steam" | "shortcut";

export interface Assignment {
  appid: number;
  name: string;
  script: string;
  kind: GameKind;
  source: "added" | "scan";
}

export interface ScriptDir {
  path: string;
  subdirs: boolean;
}

export interface Settings {
  scriptDirs: ScriptDir[];
  exclusions: string[];
  showGameButton: boolean;
  assignments: Assignment[];
}

export interface ScriptFile {
  name: string;
  path: string;
  rel: string;
  dir: string;
}

export interface DirListing {
  path: string;
  parent: string | null;
  dirs: string[];
}

export const getSettings = callable<[], Settings>("get_settings");
export const addDirectory = callable<[path: string], Settings>("add_directory");
export const removeDirectory = callable<[path: string], Settings>("remove_directory");
export const setDirectorySubdirs = callable<[path: string, value: boolean], Settings>(
  "set_directory_subdirs"
);
export const setShowGameButton = callable<[value: boolean], Settings>("set_show_game_button");
export const setExclusions = callable<[exclusions: string[]], Settings>("set_exclusions");
export const listDir = callable<[path: string], DirListing>("list_dir");
export const listScripts = callable<[], ScriptFile[]>("list_scripts");
export const setAssignment = callable<
  [appid: number, name: string, script: string, kind: GameKind, source: string],
  Settings
>("set_assignment");
export const addAssignments = callable<
  [items: { appid: number; name: string; script: string; kind: GameKind }[]],
  Settings
>("add_assignments");
export const removeAssignment = callable<[appid: number], Settings>("remove_assignment");
export const removeAssignments = callable<[appids: number[]], Settings>("remove_assignments");
