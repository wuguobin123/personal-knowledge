import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  const username = String(process.env.ADMIN_USERNAME || "").trim();
  const password = String(process.env.ADMIN_PASSWORD || "").trim();

  if (!username || !password) {
    return Response.json(
      { error: "ADMIN_USERNAME or ADMIN_PASSWORD is not configured." },
      { status: 500 },
    );
  }

  const payload = await request.json();
  const inputUsername = String(payload.username || "").trim();
  const inputPassword = String(payload.password || "").trim();

  if (inputUsername !== username || inputPassword !== password) {
    return Response.json({ error: "用户名或密码错误。" }, { status: 401 });
  }

  try {
    const token = await createAdminSessionToken(inputUsername);
    const cookieStore = await cookies();

    cookieStore.set(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session.";
    return Response.json({ error: message }, { status: 500 });
  }
}
