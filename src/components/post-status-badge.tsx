import type { PostStatus } from "@/lib/posts-client";

const label: Record<PostStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const tone: Record<PostStatus, string> = {
  draft: "bg-white/5 text-paper",
  published: "bg-accent/15 text-accent",
  archived: "bg-white/5 text-mist",
};

export function PostStatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tone[status]}`}>
      {label[status]}
    </span>
  );
}

export function PendingReviewBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-accent/40 px-2.5 py-1 text-xs font-medium text-accent">
      Pending review
    </span>
  );
}
