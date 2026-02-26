import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

export const ADMIN_SESSION_COOKIE = "admin_session";

type AdminSession = {
  username: string;
};

type CookieSecurityInput = {
  forwardedProto?: string | null;
  requestUrl?: string | null;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is not set or too short.");
  }
  return new TextEncoder().encode(secret);
}

export function shouldUseSecureCookies({ forwardedProto, requestUrl }: CookieSecurityInput = {}) {
  const secureOverride = String(process.env.COOKIE_SECURE || "")
    .trim()
    .toLowerCase();
  if (secureOverride === "true") return true;
  if (secureOverride === "false") return false;

  if (process.env.NODE_ENV !== "production") {
    return false;
  }

  const normalizedProto = forwardedProto
    ?.split(",")
    .map((item) => item.trim().toLowerCase())
    .find(Boolean);
  if (normalizedProto) {
    return normalizedProto === "https";
  }

  if (requestUrl) {
    try {
      return new URL(requestUrl).protocol === "https:";
    } catch {
      return false;
    }
  }

  return false;
}

export async function createAdminSessionToken(username: string) {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getAuthSecret());
}

export async function verifyAdminSessionToken(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (payload.role !== "admin" || typeof payload.sub !== "string") {
      return null;
    }
    return { username: payload.sub };
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  return verifyAdminSessionToken(token);
}
