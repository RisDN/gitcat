import type { KeybindSettings } from "./types";

export type KeybindAction = keyof KeybindSettings;

export interface KeybindDefinition {
  action: KeybindAction;
  label: string;
  description: string;
  scope: "Global" | "Working tree";
}

export const DEFAULT_KEYBINDS: KeybindSettings = {
  next_repository: "Ctrl+Tab",
  previous_repository: "Ctrl+Shift+Tab",
  repository_1: "Ctrl+1",
  repository_2: "Ctrl+2",
  repository_3: "Ctrl+3",
  repository_4: "Ctrl+4",
  repository_5: "Ctrl+5",
  repository_6: "Ctrl+6",
  repository_7: "Ctrl+7",
  repository_8: "Ctrl+8",
  repository_9: "Ctrl+9",
  new_repository_tab: "Ctrl+T",
  close_repository: "Ctrl+W",
  reopen_closed_repository: "Ctrl+Shift+T",
  open_repository: "Ctrl+Shift+O",
  open_repository_folder: "Alt+O",
  search_commits: "Ctrl+F",
  open_settings: "Ctrl+,",
  refresh_repository: "F5",
  toggle_left_panel: "Ctrl+J",
  toggle_right_panel: "Ctrl+K",
  fetch: "Ctrl+L",
  pull: "Ctrl+Alt+P",
  push: "Ctrl+Shift+P",
  create_branch: "Ctrl+B",
  stash: "Ctrl+Alt+S",
  show_worktree: "Ctrl+Shift+W",
  show_graph: "Alt+Left",
  diff_inline: "Alt+1",
  diff_split: "Alt+2",
  copy_selected_sha: "Ctrl+Shift+C",
  continue_operation: "Ctrl+Alt+Enter",
  abort_operation: "Ctrl+Shift+Backspace",
  stage_all: "Ctrl+Shift+S",
  unstage_all: "Ctrl+Shift+U",
  focus_commit_message: "Ctrl+Shift+M",
  auto_resolve_conflicts: "Ctrl+Alt+R",
  commit: "Ctrl+Enter",
};

export const KEYBIND_DEFINITIONS: readonly KeybindDefinition[] = [
  { action: "next_repository", label: "Next repository", description: "Select the next open repository tab.", scope: "Global" },
  { action: "previous_repository", label: "Previous repository", description: "Select the previous open repository tab.", scope: "Global" },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((number) => ({
    action: `repository_${number}` as KeybindAction,
    label: `Repository ${number}`,
    description: `Select open repository ${number}.`,
    scope: "Global" as const,
  })),
  { action: "new_repository_tab", label: "New repository tab", description: "Choose a repository and open it in a new tab.", scope: "Global" },
  { action: "close_repository", label: "Close repository", description: "Close the active repository tab.", scope: "Global" },
  { action: "reopen_closed_repository", label: "Reopen closed repository", description: "Reopen the most recently closed repository tab.", scope: "Global" },
  { action: "open_repository", label: "Open repository", description: "Choose and open a local repository.", scope: "Global" },
  { action: "open_repository_folder", label: "Open repository folder", description: "Open the active repository's folder in the file explorer.", scope: "Global" },
  { action: "search_commits", label: "Search commits", description: "Focus commit search in the graph.", scope: "Global" },
  { action: "open_settings", label: "Open preferences", description: "Open GitCat preferences.", scope: "Global" },
  { action: "refresh_repository", label: "Refresh repository", description: "Reload status, refs, and commit history.", scope: "Global" },
  { action: "toggle_left_panel", label: "Toggle left panel", description: "Show or hide branches and tags.", scope: "Global" },
  { action: "toggle_right_panel", label: "Toggle commit panel", description: "Show or hide commit details and working changes.", scope: "Global" },
  { action: "fetch", label: "Fetch", description: "Fetch the default remote.", scope: "Global" },
  { action: "pull", label: "Pull", description: "Pull with the configured default mode.", scope: "Global" },
  { action: "push", label: "Push", description: "Push the current branch.", scope: "Global" },
  { action: "create_branch", label: "Create branch", description: "Create a branch at HEAD.", scope: "Global" },
  { action: "stash", label: "Stash changes", description: "Stash tracked and untracked changes.", scope: "Working tree" },
  { action: "show_worktree", label: "Show working tree", description: "Select the WIP row and commit panel.", scope: "Working tree" },
  { action: "show_graph", label: "Back to graph", description: "Leave the current diff and show the commit graph.", scope: "Global" },
  { action: "diff_inline", label: "Inline diff", description: "Switch the open diff to inline layout.", scope: "Global" },
  { action: "diff_split", label: "Split diff", description: "Switch the open diff to split layout.", scope: "Global" },
  { action: "copy_selected_sha", label: "Copy selected SHA", description: "Copy the selected commit's full object ID.", scope: "Global" },
  { action: "continue_operation", label: "Continue operation", description: "Continue the active merge, rebase, cherry-pick, or revert.", scope: "Working tree" },
  { action: "abort_operation", label: "Abort operation", description: "Confirm and abort the active Git operation.", scope: "Working tree" },
  { action: "stage_all", label: "Stage all files", description: "Stage every unstaged file while WIP is selected.", scope: "Working tree" },
  { action: "unstage_all", label: "Unstage all files", description: "Move every staged file back to unstaged.", scope: "Working tree" },
  { action: "focus_commit_message", label: "Focus commit message", description: "Show WIP and focus the commit editor.", scope: "Working tree" },
  { action: "auto_resolve_conflicts", label: "Reuse recorded resolutions", description: "Apply exact resolutions recorded by Git rerere.", scope: "Working tree" },
  { action: "commit", label: "Commit staged files", description: "Commit with the current commit message.", scope: "Working tree" },
] as const;

const RESERVED_OS_KEYBINDS = new Set([
  "alt+f4",
  "ctrl+alt+delete",
  "ctrl+shift+escape",
  "meta+q",
  "meta+alt+escape",
]);

const BARE_INTERACTION_KEYS = new Set([
  "tab",
  "enter",
  "space",
  "escape",
  "backspace",
  "delete",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "home",
  "end",
  "pageup",
  "pagedown",
]);

export function isReservedKeybind(binding: string): boolean {
  return keybindValidationError(binding) !== null;
}

export function keybindValidationError(binding: string): string | null {
  const normalized = binding.toLowerCase();
  if (RESERVED_OS_KEYBINDS.has(normalized)) return "Reserved by the operating system";
  const parts = normalized.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  if (BARE_INTERACTION_KEYS.has(key) && modifiers.every((modifier) => modifier === "shift")) {
    return "Add Ctrl, Alt, or Meta so normal keyboard navigation still works";
  }
  return null;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function canonicalKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
  return key;
}

export function keybindFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(canonicalKey(event.key));
  return parts.join("+");
}

export function matchesKeybind(event: KeyboardEvent, binding: string | undefined): boolean {
  if (!binding) return false;
  return keybindFromEvent(event)?.toLowerCase() === binding.toLowerCase();
}

export function isPlainTypingKeybind(binding: string | undefined): boolean {
  if (!binding) return false;
  const parts = binding.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  if (modifiers.some((modifier) => modifier.toLowerCase() !== "shift")) return false;
  return key === "Space" || key === "Dead" || key.length === 1;
}

export function duplicateKeybinds(keybinds: KeybindSettings): ReadonlySet<KeybindAction> {
  const byBinding = new Map<string, KeybindAction[]>();
  for (const definition of KEYBIND_DEFINITIONS) {
    const binding = keybinds[definition.action].toLowerCase();
    if (!binding) continue;
    const actions = byBinding.get(binding) ?? [];
    actions.push(definition.action);
    byBinding.set(binding, actions);
  }
  return new Set(
    [...byBinding.values()]
      .filter((actions) => actions.length > 1)
      .flat(),
  );
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
