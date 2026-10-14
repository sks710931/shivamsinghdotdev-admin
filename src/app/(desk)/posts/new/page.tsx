import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth";
import { PostEditor } from "../post-editor";

export const metadata: Metadata = {
  title: "New post",
};

export default async function NewPostPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <PostEditor mode="create" role={user.role} />;
}
