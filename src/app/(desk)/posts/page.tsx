import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth";
import { PostsList } from "./posts-list";

export const metadata: Metadata = {
  title: "Posts",
};

export default async function PostsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-4xl leading-none font-medium tracking-tight text-paper">Posts</h2>
        <Link
          href="/posts/new"
          className="inline-flex h-11 shrink-0 items-center self-start rounded-lg bg-accent px-4 text-sm font-semibold text-ink transition-[filter] hover:brightness-110"
        >
          New Post
        </Link>
      </div>
      <PostsList />
    </div>
  );
}
