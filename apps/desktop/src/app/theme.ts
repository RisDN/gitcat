import { GRAPH_LANE_SLOTS } from "../lib/styles";
import type { AppSettings, AppTheme, ThemeColors } from "../lib/types";
import { DEFAULT_THEME_COLORS } from "./themePresets";

export function activeTheme(settings: Pick<AppSettings, "active_theme_id" | "themes">): AppTheme | undefined {
    return settings.themes.find((theme) => theme.id === settings.active_theme_id) ?? settings.themes[0];
}

export function activeThemeColors(settings: Pick<AppSettings, "active_theme_id" | "themes">): ThemeColors {
    return activeTheme(settings)?.colors ?? DEFAULT_THEME_COLORS;
}

export function applyTheme(settings: AppSettings): void {
    const root = document.documentElement;
    const theme = activeThemeColors(settings);
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
