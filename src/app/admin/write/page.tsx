import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import AdminEditor from "../admin-editor";

export const dynamic = "force-dynamic";

export default async function AdminWritePage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  return <AdminEditor username={session.username} />;
}
