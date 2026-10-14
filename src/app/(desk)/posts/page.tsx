import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth";
import { listPosts } from "@/server/posts";

export const metadata: Metadata = {
  title: "Posts",
};

const when = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function PostsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const posts = await listPosts(user);

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

      {posts.length === 0 ? (
        <p className="text-sm text-mist">No posts yet.</p>
      ) : (
        <section className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead className="text-xs tracking-wide text-mist uppercase">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-medium sm:px-6">Title</th>
                  <th className="px-3 py-3 font-medium">Slug</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium sm:px-6">Updated</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b border-line/80 last:border-b-0">
                    <td className="px-5 py-4 font-medium text-paper sm:px-6">{post.title}</td>
                    <td className="px-3 py-4 font-mono text-xs text-mist">{post.slug}</td>
                    <td className="px-3 py-4 text-mist">{post.status === "published" ? "Published" : "Draft"}</td>
                    <td className="px-5 py-4 text-mist sm:px-6">
                      {when.format(new Date(post.updatedAt))} IST
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
