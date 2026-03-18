import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

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
          let apiUrl = process.env.NEXT_PUBLIC_CONTENT_API_URL || "http://localhost:8000";
          if (apiUrl.includes("localhost")) {
            apiUrl = "http://content-factory:8000";
          }
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

          console.log("FastAPI status:", res.status);
          const data = await res.json();
          console.log("FastAPI response:", data);

          if (res.ok && data.access_token) {
            return {
              id: "1",
              name: credentials?.username,
              accessToken: data.access_token,
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
      }
      return token;
    },
    async session({ session, token }: { session: any, token: any }) {
      session.accessToken = token.accessToken;
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
