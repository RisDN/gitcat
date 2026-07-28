import { GRAPH_LANE_SLOTS } from "../lib/styles";
import type { AppSettings } from "../lib/types";

export function applyTheme(settings: AppSettings): void {
    const root = document.documentElement;
    const theme = settings.theme;
    const variables: Record<string, string> = {
        "--gc-background": theme.background,
        "--gc-surface": theme.surface,
        "--gc-panel": theme.panel,
        "--gc-border": theme.border,
        "--gc-text": theme.text,
        "--gc-muted": theme.muted_text,
        "--gc-accent": theme.accent,
        "--gc-success": theme.success,
        "--gc-warning": theme.warning,
        "--gc-danger": theme.danger,
        "--gc-diff-add": theme.diff_addition,
        "--gc-diff-delete": theme.diff_deletion,
    };
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    for (let index = 0; index < GRAPH_LANE_SLOTS; index += 1) {
        root.style.setProperty(`--gc-lane-${index}`, theme.graph_palette[index % theme.graph_palette.length]);
    }
}
