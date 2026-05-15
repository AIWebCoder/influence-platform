import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: "admin" | "operator" | "viewer" | string;
    };
  }

  interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    accessToken?: string;
    role?: "admin" | "operator" | "viewer" | string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    email?: string | null;
    role?: "admin" | "operator" | "viewer" | string;
  }
}
