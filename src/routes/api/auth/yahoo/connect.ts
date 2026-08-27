import { createFileRoute } from "@tanstack/react-router";

/** Kicks off Yahoo Fantasy OAuth and sends the browser to Yahoo's consent screen. */
export const Route = createFileRoute("/api/auth/yahoo/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env["YAHOO_CLIENT_ID"];
        const origin = new URL(request.url).origin;

        if (!clientId) {
          // No credentials yet: send the user back to the sync page with a notice
          // instead of failing the request with a blank error screen.
          return new Response(null, {
            status: 302,
            headers: {
              location: `${origin}/leaguesync?yahoo=unconfigured`,
              "cache-control": "no-store",
            },
          });
        }

        const authorize = new URL("https://api.login.yahoo.com/oauth2/request_auth");
        authorize.searchParams.set("client_id", clientId);
        authorize.searchParams.set("redirect_uri", `${origin}/api/auth/yahoo/callback`);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("language", "en-us");

        return new Response(null, {
          status: 302,
          headers: { location: authorize.toString(), "cache-control": "no-store" },
        });
      },
    },
  },
});
