import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, shouldUseSecureCookies } from "@/lib/auth";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const secureCookie = shouldUseSecureCookies({
    forwardedProto: request.headers.get("x-forwarded-proto"),
    requestUrl: request.url,
  });

  cookieStore.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    maxAge: 0,
  });

  return Response.json({ ok: true });
}
