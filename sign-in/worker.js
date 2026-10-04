// The app creator website's sign-in helper.
//
// It does the one step of signing in with GitHub that a web page cannot do
// itself, because it needs the sign-in App's client secret: it swaps the code
// GitHub hands back for a token that lasts 8 hours. It does nothing else. The
// token can only do what the sign-in App may (write issues) on the
// repositories it is installed on (the app creator), as the signed-in person.
//
// Runs as a Cloudflare Worker (README.md, beside this file) with:
//   SITE           variable: the website's origin, with no path
//   CLIENT_ID      variable: the sign-in App's client ID
//   CLIENT_SECRET  secret:   the sign-in App's client secret

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.SITE,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    // only the website may use it
    if (request.headers.get("Origin") !== env.SITE) return new Response("Not found", { status: 404 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ error: "bad_request" }, 400, cors);
    }
    const { code, code_verifier: verifier, redirect_uri: redirect } = body || {};
    if (![code, verifier, redirect].every((v) => typeof v === "string" && v.length > 0 && v.length < 512)) {
      return reply({ error: "bad_request" }, 400, cors);
    }

    // GitHub only gives the token for a code issued to this App, to this
    // redirect, with the PKCE verifier the page started the sign-in with
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "app-creator-sign-in" },
      body: JSON.stringify({
        client_id: env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.access_token) {
      return reply({ error: data.error || "sign_in_failed", error_description: data.error_description || "" }, 400, cors);
    }
    // the refresh token stays here, unused: signing in again is quick
    return reply({ access_token: data.access_token, expires_in: data.expires_in || 28800 }, 200, cors);
  },
};

function reply(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
