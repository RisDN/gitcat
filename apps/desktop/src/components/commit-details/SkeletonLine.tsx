import { cx } from "../../lib";

export function SkeletonLine({
  as: Tag = "span",
  className = "",
}: {
  as?: "span" | "small";
  className?: string;
}) {
  return <Tag className={cx("skeleton h-2.5 rounded-[3px]", className)} />;
}
