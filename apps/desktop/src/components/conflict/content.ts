import type { ConflictFileContent } from "../../lib/types";

// Why a side or the working copy cannot be shown as text.
export function contentMessage(content: ConflictFileContent): string {
  switch (content.kind) {
    case "missing": return "File does not exist on this side.";
    case "binary": return `Binary content${content.size === undefined ? "" : ` · ${content.size} bytes`}.`;
    case "too_large": return `Content is too large for the built-in editor${content.size === undefined ? "" : ` · ${content.size} bytes`}.`;
    case "text": return "Text content unavailable.";
  }
}
