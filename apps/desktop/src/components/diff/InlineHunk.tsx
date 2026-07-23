import { memo } from "react";

import type { DiffHunk } from "../../lib/types";
import { HunkHeader, HunkSection, LineContent, displayLineNumber } from "./DiffParts";

export const InlineHunk = memo(function InlineHunk({ hunk, index }: { hunk: DiffHunk; index: number }) {
  return (
    <HunkSection label={`gc-inline-hunk-${index}`}>
      <HunkHeader id={`gc-inline-hunk-${index}`}>{hunk.header}</HunkHeader>
      <table className="gc-diff-table gc-diff-table--inline">
        <colgroup>
          <col className="gc-diff-table__line-column" />
          <col className="gc-diff-table__line-column" />
          <col className="gc-diff-table__content-column" />
        </colgroup>
        <caption className="sr-only">
          Unified diff hunk: old lines {hunk.old_start}–{hunk.old_start + Math.max(0, hunk.old_count - 1)}, new lines {hunk.new_start}–{hunk.new_start + Math.max(0, hunk.new_count - 1)}
        </caption>
        <tbody>
          {hunk.lines.map((line, lineIndex) => {
            if (line.kind === "no_newline") {
              return (
                <tr className="gc-diff-line gc-diff-line--no-newline" key={`${lineIndex}:${line.content}`}>
                  <td aria-hidden="true" className="gc-diff-line__number" />
                  <td aria-hidden="true" className="gc-diff-line__number" />
                  <td className="gc-diff-line__content">
                    <LineContent line={line} />
                  </td>
                </tr>
              );
            }

            return (
              <tr className={`gc-diff-line gc-diff-line--${line.kind}`} key={`${lineIndex}:${line.old_line ?? ""}:${line.new_line ?? ""}`}>
                <td aria-label={line.old_line === null ? undefined : `Old line ${line.old_line}`} className="gc-diff-line__number gc-diff-line__number--old">
                  {displayLineNumber(line.old_line)}
                </td>
                <td aria-label={line.new_line === null ? undefined : `New line ${line.new_line}`} className="gc-diff-line__number gc-diff-line__number--new">
                  {displayLineNumber(line.new_line)}
                </td>
                <td className="gc-diff-line__content">
                  <LineContent line={line} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </HunkSection>
  );
});
