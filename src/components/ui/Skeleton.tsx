import { cn } from "@/lib/utils";

type SkeletonProps = {
  className?: string;
};

/** Shimmer placeholder (handoff section 6.2). */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn("tv-shimmer rounded-md", className)} />;
}
