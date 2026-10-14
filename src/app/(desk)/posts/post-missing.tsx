import Link from "next/link";

export function PostMissing() {
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h2 className="font-display text-4xl leading-none font-medium tracking-tight text-paper">Post not found</h2>
      <p className="text-sm text-mist">That post does not exist, or you do not have access to it.</p>
      <Link href="/posts" className="text-sm font-medium text-accent">
        Back to posts
      </Link>
    </div>
  );
}
