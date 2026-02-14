import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) {
    redirect("/admin");
  }

  return (
    <main className="admin-login-page">
      <div className="admin-login-bg">
        <div className="admin-login-orb admin-login-orb-left" />
        <div className="admin-login-orb admin-login-orb-right" />
      </div>

      <section className="admin-login-shell">
        <header className="admin-login-head">
          <div className="admin-login-logo">AI</div>
          <h1>Admin Portal</h1>
          <p>Enter your credentials to manage your blog and AI assistant.</p>
        </header>

        <LoginForm />

        <footer className="admin-login-footer">
          <Link href="/">Back to Blog</Link>
          <p>(c) 2024 CMS Engine. All rights reserved.</p>
          <p>
            Integrated with <span>GPT-4 Assistant</span>
          </p>
        </footer>
      </section>
      <div className="admin-login-bottom-line" />
    </main>
  );
}
