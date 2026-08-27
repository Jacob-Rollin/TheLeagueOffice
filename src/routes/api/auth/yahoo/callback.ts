import { createFileRoute } from "@tanstack/react-router";

type YahooToken = { access_token?: string; error?: string };

/** Yahoo OAuth return leg: exchanges the code and hands the league back to /auth/confirmed. */
export const Route = createFileRoute("/api/auth/yahoo/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const code = url.searchParams.get("code");
        const clientId = process.env["YAHOO_CLIENT_ID"];
        const clientSecret = process.env["YAHOO_CLIENT_SECRET"];

        const fail = (reason: string) =>
          new Response(null, {
            status: 302,
            headers: {
              location: `${origin}/auth/confirmed?sync=error&reason=${encodeURIComponent(reason)}`,
              "cache-control": "no-store",
            },
          });

        if (!code) return fail("Yahoo did not return an authorization code.");
        if (!clientId || !clientSecret) return fail("Yahoo sync is not configured.");

        try {
          const tokenRes = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: `${origin}/api/auth/yahoo/callback`,
            }).toString(),
          });
          const token = (await tokenRes.json()) as YahooToken;
          if (!tokenRes.ok || !token.access_token) return fail("Yahoo token exchange failed.");

          const leaguesRes = await fetch(
            "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/leagues?format=json",
            { headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" } },
          );
          if (!leaguesRes.ok) return fail("Could not read your Yahoo leagues.");
          const payload = (await leaguesRes.json()) as unknown;

          const found = firstLeague(payload);
          if (!found) return fail("No Yahoo fantasy football leagues found on this account.");

          const next = new URL(`${origin}/auth/confirmed`);
          next.searchParams.set("sync", "yahoo");
          next.searchParams.set("league_key", found.key);
          next.searchParams.set("label", found.name);
          return new Response(null, {
            status: 302,
            headers: { location: next.toString(), "cache-control": "no-store" },
          });
        } catch {
          return fail("Yahoo connection failed. Please try again.");
        }
      },
    },
  },
});

/** Walks Yahoo's deeply nested JSON envelope for the first league key/name pair. */
function firstLeague(node: unknown): { key: string; name: string } | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (typeof obj["league_key"] === "string") {
    return {
      key: obj["league_key"] as string,
      name: typeof obj["name"] === "string" ? (obj["name"] as string) : (obj["league_key"] as string),
    };
  }
  for (const value of Object.values(obj)) {
    const hit = firstLeague(value);
    if (hit) return hit;
  }
  return null;
}
