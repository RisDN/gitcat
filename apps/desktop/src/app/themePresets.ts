import type { AppTheme, ThemeColors } from "../lib/types";

export const DEFAULT_THEME_ID = "gitcat-midnight";

export const DEFAULT_THEME_COLORS: ThemeColors = {
    background: "#17191f",
    surface: "#1d2027",
    panel: "#242832",
    border: "#343946",
    text: "#f2f4f8",
    muted_text: "#9aa3b2",
    accent: "#20b8d8",
    success: "#4dbd74",
    warning: "#f0ad4e",
    danger: "#e05d6f",
    diff_addition: "#244d33",
    diff_deletion: "#562e32",
    graph_palette: ["#15a0bf", "#0669f7", "#8e00c2", "#c517b6", "#d90171", "#cd0101", "#f25d2e", "#f2ca33", "#7bd938", "#2ece9d"],
};

export const DEFAULT_THEMES: AppTheme[] = [
    {
        id: DEFAULT_THEME_ID,
        name: "GitCat Midnight",
        built_in: true,
        colors: DEFAULT_THEME_COLORS,
    },
    {
        id: "gitkraken-dark",
        name: "GitKraken Dark",
        built_in: true,
        colors: {
            background: "#141422",
            surface: "#1b1b2b",
            panel: "#242438",
            border: "#3b3b54",
            text: "#f5f3ff",
            muted_text: "#a5a2bb",
            accent: "#18d6b3",
            success: "#42d392",
            warning: "#f7b955",
            danger: "#ff6680",
            diff_addition: "#183f35",
            diff_deletion: "#4b2935",
            graph_palette: ["#18d6b3", "#7b61ff", "#f252d2", "#ff9f43", "#3fc5f0", "#7ed957"],
        },
    },
    {
        id: "github-desktop-dark",
        name: "GitHub Desktop Dark",
        built_in: true,
        colors: {
            background: "#1e1f22",
            surface: "#25262a",
            panel: "#2b2d31",
            border: "#41434a",
            text: "#f3f4f6",
            muted_text: "#a7abb4",
            accent: "#8a63d2",
            success: "#3fb950",
            warning: "#d29922",
            danger: "#f85149",
            diff_addition: "#183d25",
            diff_deletion: "#4b2226",
            graph_palette: ["#8a63d2", "#58a6ff", "#3fb950", "#d29922", "#f85149", "#db61a2"],
        },
    },
    {
        id: "github-desktop-light",
        name: "GitHub Desktop Light",
        built_in: true,
        colors: {
            background: "#f6f8fa",
            surface: "#ffffff",
            panel: "#eef1f4",
            border: "#d0d7de",
            text: "#24292f",
            muted_text: "#57606a",
            accent: "#8250df",
            success: "#1a7f37",
            warning: "#9a6700",
            danger: "#cf222e",
            diff_addition: "#dafbe1",
            diff_deletion: "#ffebe9",
            graph_palette: ["#8250df", "#0969da", "#1a7f37", "#bf8700", "#cf222e", "#bf3989"],
        },
    },
    {
        id: "paper-light",
        name: "Paper Light",
        built_in: true,
        colors: {
            background: "#f4f2ed",
            surface: "#fffefa",
            panel: "#e9e6df",
            border: "#cbc6bc",
            text: "#26241f",
            muted_text: "#6e6a61",
            accent: "#087f8c",
            success: "#2f855a",
            warning: "#a35b00",
            danger: "#c43d4b",
            diff_addition: "#dcefe3",
            diff_deletion: "#f7dddd",
            graph_palette: ["#087f8c", "#4c6fff", "#8b5cf6", "#cc5de8", "#e8590c", "#2f9e44"],
        },
    },
    {
        id: "oled-black",
        name: "OLED Black",
        built_in: true,
        colors: {
            background: "#000000",
            surface: "#080808",
            panel: "#101010",
            border: "#292929",
            text: "#f5f5f5",
            muted_text: "#929292",
            accent: "#35cfff",
            success: "#4ade80",
            warning: "#fbbf24",
            danger: "#fb7185",
            diff_addition: "#123821",
            diff_deletion: "#421821",
            graph_palette: ["#35cfff", "#818cf8", "#c084fc", "#f472b6", "#fb923c", "#4ade80"],
        },
    },
];

export const BUILTIN_THEME_IDS = new Set(DEFAULT_THEMES.map((theme) => theme.id));

export function cloneDefaultThemes(): AppTheme[] {
    return structuredClone(DEFAULT_THEMES);
}
