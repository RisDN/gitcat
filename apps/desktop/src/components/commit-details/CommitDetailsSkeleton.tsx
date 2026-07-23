import { cx } from "../../lib";
import { SidePanel } from "../ui";
import { MessageCard } from "./CommitMessage";
import { Avatar, FilesHeader, FilesPanel, IdentityRow, StatsRow } from "./CommitSections";
import { ShaBar } from "./ShaBar";
import { SkeletonLine } from "./SkeletonLine";

// Staggered widths and indents so the placeholder reads as a file tree rather
// than a stack of identical bars.
function fileRowShape(index: number): string {
    const position = index + 1;
    if (position % 3 === 0) return "ml-8.5 w-[calc(88%-34px)]";
    if (position % 2 === 0) return "ml-4.5 w-[calc(82%-18px)]";
    return "w-[94%]";
}

export function CommitDetailsSkeleton() {
    const fileRows = Array.from({ length: 8 }, (_, index) => index);

    return (
        <SidePanel className="pointer-events-none" aria-busy="true" aria-label="Loading commit details">
            <ShaBar>
                <SkeletonLine className="w-10.5" />
                <SkeletonLine className="w-18.5" />
            </ShaBar>
            <MessageCard>
                <SkeletonLine className="h-4.25 w-[86%]" />
                <SkeletonLine className="mt-3.75 w-[94%]" />
                <SkeletonLine className="mt-2 w-[63%]" />
            </MessageCard>
            <IdentityRow>
                <Avatar />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <SkeletonLine className="h-3 w-35.5" />
                    <SkeletonLine className="mt-1 w-47.5" />
                    <SkeletonLine className="mt-1.5 h-2.25 w-32" />
                </div>
            </IdentityRow>
            <StatsRow>
                <span className="skeleton h-5.25 w-15.5 rounded" />
                <SkeletonLine className="w-11.5" />
                <SkeletonLine className="w-11.5" />
            </StatsRow>
            <FilesPanel>
                <FilesHeader>
                    <SkeletonLine className="w-28" />
                    <SkeletonLine as="small" className="ml-auto w-5.5" />
                </FilesHeader>
                <div className="flex flex-col gap-1.75 overflow-auto pt-2" aria-hidden="true">
                    {fileRows.map((row) => (
                        <SkeletonLine className={cx("h-4.75", fileRowShape(row))} key={row} />
                    ))}
                </div>
            </FilesPanel>
        </SidePanel>
    );
}
