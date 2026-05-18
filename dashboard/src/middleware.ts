export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/",
    "/analytics(.*)",
    "/ab-tests(.*)",
    "/personas(.*)",
    "/accounts(.*)",
    "/account-health(.*)",
    "/campaigns(.*)",
    "/calendar(.*)",
    "/queue(.*)",
    "/templates(.*)",
    "/proxies(.*)",
    "/users(.*)",
    "/generation-studio(.*)",
    "/publications(.*)",
    "/emulators(.*)",
  ],
};
