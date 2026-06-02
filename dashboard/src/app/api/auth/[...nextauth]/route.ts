import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

type FastApiTokenClaims = {
  sub?: string;
  role?: string;
  user_id?: string;
  organization_id?: string;
  exp?: number;
};

/** Server-side login must hit FastAPI directly (/auth/login), not the browser gateway path (/api/content). */
function resolveContentFactoryAuthBaseUrl(): string {
  const internal = (process.env.CONTENT_FACTORY_URL || "").trim();
  if (internal) return internal.replace(/\/$/, "");

  const publicUrl = (process.env.NEXT_PUBLIC_CONTENT_API_URL || "http://localhost:8000").trim();
  if (
    publicUrl.includes("localhost") ||
    publicUrl.includes("127.0.0.1") ||
    publicUrl.includes("content-factory")
  ) {
    return "http://content-factory:8000";
  }
  // Nginx exposes the API as /api/content; auth routes live at /auth/login on the app root.
  if (publicUrl.includes("/api/content")) {
    return "http://content-factory:8000";
  }
  return publicUrl.replace(/\/$/, "");
}

function decodeJwtPayload(token: string): FastApiTokenClaims | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const decoded = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          const e2eBypass = process.env.E2E_TEST_BYPASS_AUTH === "true";
          const e2eUser = process.env.E2E_TEST_USERNAME || "e2e-user";
          const e2ePass = process.env.E2E_TEST_PASSWORD || "e2e-pass";
          if (
            e2eBypass &&
            credentials?.username === e2eUser &&
            credentials?.password === e2ePass
          ) {
            return {
              id: "e2e-user",
              name: e2eUser,
              email: e2eUser,
              accessToken: "e2e-access-token",
              role: "admin",
            };
          }

          const apiUrl = resolveContentFactoryAuthBaseUrl();
          const res = await fetch(`${apiUrl}/auth/login`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              username: credentials?.username || "",
              password: credentials?.password || "",
            }),
          });

          const data = await res.json().catch(() => ({}));

          if (res.ok && data.access_token) {
            const claims = decodeJwtPayload(data.access_token) ?? {};
            const apiUser = (data && typeof data === "object" ? data.user : null) as
              | { id?: string; email?: string; role?: string; organization_id?: string }
              | null;
            const email = apiUser?.email || claims.sub || credentials?.username || "";
            const role = apiUser?.role || claims.role || "viewer";
            const userId = apiUser?.id || claims.user_id || email;
            const organizationId =
              apiUser?.organization_id || claims.organization_id || undefined;
            return {
              id: userId,
              name: email,
              email,
              accessToken: data.access_token,
              role,
              organizationId,
            };
          }
          return null;
        } catch (err) {
          console.error("Auth error:", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }: { token: any, user: any }) {
      if (user) {
        token.accessToken = user.accessToken;
        token.role = user.role;
        token.email = user.email;
        token.organizationId = user.organizationId;
      }
      return token;
    },
    async session({ session, token }: { session: any, token: any }) {
      session.accessToken = token.accessToken;
      session.user = {
        ...(session.user ?? {}),
        email: token.email ?? session.user?.email ?? null,
        role: token.role ?? "viewer",
        organizationId: token.organizationId,
      };
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET || "changeme_in_production",
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
