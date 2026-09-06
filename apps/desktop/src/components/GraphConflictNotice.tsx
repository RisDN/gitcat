import { TriangleAlert } from "lucide-react";

import { visibleGraphColumns } from "../lib/columns";
import { conflictNoticeMessage } from "../lib/conflicts";
import type { GraphColumnSettings, OperationSource, RepositoryOperationState } from "../lib/types";

// A stopped operation is stated on the working-copy row rather than in a bar of
// its own above the graph: the conflicts belong to the row the resolutions land
// on, and every action for them already lives in the working tree panel, which
// is where the files are. This is a cell of that row -- it starts at the commit
// message column, so the ref and graph columns stay readable, and runs to the
// end of the row.
export function GraphConflictNotice({
  branchName,
  columns,
  count,
  onSelect,
  operation,
  source,
}: {
  branchName: string;
  columns: GraphColumnSettings;
  count: number;
  onSelect: () => void;
  operation: RepositoryOperationState;
  source: OperationSource | null;
}) {
  const messageColumn = visibleGraphColumns(columns).indexOf("message");
  const message = conflictNoticeMessage(operation, source, branchName);
  const remaining = `${count} file${count === 1 ? "" : "s"} left to resolve`;

  return (
    <button
      className="gc-graph-notice"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      style={{ gridColumn: `${messageColumn < 0 ? 1 : messageColumn + 1} / -1` }}
      title={`${message}. ${remaining}.`}
      type="button"
    >
      <TriangleAlert aria-hidden="true" className="shrink-0" size={13} />
      <span className="min-w-0 truncate">{message}</span>
      <span className="shrink-0 opacity-75">· {remaining}</span>
    </button>
  );
}
