import { createFileRoute } from "@tanstack/react-router";

/** Kicks off Yahoo Fantasy OAuth and sends the browser to Yahoo's consent screen. */
export const Route = createFileRoute("/api/auth/yahoo/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env["YAHOO_CLIENT_ID"];
        const origin = new URL(request.url).origin;

        if (!clientId) {
          return new Response(
            "Yahoo sync is not configured yet. Add YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET to enable it.",
            { status: 503, headers: { "content-type": "text/plain" } },
          );
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
