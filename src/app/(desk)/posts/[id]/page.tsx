import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth";
import { EditPostScreen } from "../edit-post-screen";

export const metadata: Metadata = {
  title: "Edit post",
};

export default async function EditPostPage(props: PageProps<"/posts/[id]">) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <EditPostScreen key={id} postId={id} role={user.role} userId={user.id} />;
}
