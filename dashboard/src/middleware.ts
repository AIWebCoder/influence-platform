export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/",
    "/analytics(.*)",
    "/ab-tests(.*)",
    "/accounts(.*)",
    "/campaigns(.*)",
    "/generation-studio(.*)",
    "/publications(.*)",
    "/emulators(.*)"
  ]
};
