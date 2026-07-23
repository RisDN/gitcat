import type { ThemeColors } from "../../lib/types";
import { SectionHeading } from "./SettingsField";

const COLOR_FIELDS: Array<[keyof ThemeColors, string]> = [
  ["background", "Background"],
  ["surface", "Surface"],
  ["panel", "Panel"],
  ["border", "Border"],
  ["text", "Text"],
  ["muted_text", "Muted text"],
  ["accent", "Accent"],
  ["success", "Success"],
  ["warning", "Warning"],
  ["danger", "Danger"],
  ["diff_addition", "Diff addition"],
  ["diff_deletion", "Diff deletion"],
];

export function ThemeEditor({
  theme,
  onColorChange,
  onPaletteChange,
}: {
  theme: ThemeColors;
  onColorChange: (field: keyof ThemeColors, value: string) => void;
  onPaletteChange: (palette: string[]) => void;
}) {
  return (
    <section className="min-w-0">
      <SectionHeading>Interface colors</SectionHeading>
      <div className="grid grid-cols-2 gap-1.75">
        {COLOR_FIELDS.map(([field, label]) => (
          <label
            className="grid grid-cols-[25px_minmax(0,1fr)] grid-rows-[16px_12px] items-center gap-x-1.75 gap-y-0 rounded-[5px] border border-border bg-background/55 p-1.5"
            key={field}
          >
            <input
              aria-label={label}
              className="row-span-2 size-6.25 cursor-pointer rounded border-0 bg-transparent p-0"
              onChange={(event) => onColorChange(field, event.target.value)}
              type="color"
              value={theme[field] as string}
            />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-foreground">{label}</span>
            <code className="text-[9px] text-muted">{theme[field] as string}</code>
          </label>
        ))}
      </div>
      <SectionHeading>Graph lanes</SectionHeading>
      <div className="flex gap-1.75">
        {theme.graph_palette.map((color, index) => (
          <input
            aria-label={`Graph lane ${index + 1}`}
            className="size-7.75 cursor-pointer overflow-hidden rounded-full border border-border bg-transparent p-0"
            key={`${index}:${color}`}
            onChange={(event) => {
              const palette = [...theme.graph_palette];
              palette[index] = event.target.value;
              onPaletteChange(palette);
            }}
            type="color"
            value={color}
          />
        ))}
      </div>
    </section>
  );
}
