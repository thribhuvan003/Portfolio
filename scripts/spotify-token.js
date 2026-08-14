#!/usr/bin/env node
/**
 * One-off helper: turns a Spotify client id + secret into a refresh token.
 *
 *   node scripts/spotify-token.js <CLIENT_ID> <CLIENT_SECRET>
 *
 * It opens the Spotify consent page, catches the redirect on 127.0.0.1:8888,
 * exchanges the code, and prints the refresh token. Nothing is written to disk
 * and nothing leaves your machine except the call to Spotify itself.
 *
 * Add the three values to Vercel yourself:
 *   Project -> Settings -> Environment Variables -> then redeploy.
 */
const http = require("http");
const { exec } = require("child_process");

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3];
const PORT = 8888;
// Spotify rejects "localhost"; a loopback redirect must use the literal IP.
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = "user-read-currently-playing user-read-recently-played";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("\nUsage: node scripts/spotify-token.js <CLIENT_ID> <CLIENT_SECRET>\n");
  console.error("Get both from https://developer.spotify.com/dashboard after creating an app,");
  console.error(`and add ${REDIRECT} to that app's Redirect URIs first.\n`);
  process.exit(1);
}

const authUrl =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT,
    scope: SCOPES,
  }).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end("not found");
    return;
  }

  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(200, { "Content-Type": "text/html" }).end(`<p>Denied: ${err}. You can close this tab.</p>`);
    console.error("\nAuthorisation denied:", err, "\n");
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("no code");
    return;
  }

  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
      }),
    });
    const data = await r.json();

    if (!r.ok || !data.refresh_token) {
      res.writeHead(200, { "Content-Type": "text/html" }).end("<p>Exchange failed. Check the terminal.</p>");
      console.error("\nToken exchange failed:", r.status, JSON.stringify(data, null, 2), "\n");
      server.close();
      process.exit(1);
    }

    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<h2>Done.</h2><p>Your refresh token is in the terminal. You can close this tab.</p>"
    );

    console.log("\n" + "=".repeat(64));
    console.log("Set these three in Vercel (Settings -> Environment Variables):\n");
    console.log("SPOTIFY_CLIENT_ID     =", CLIENT_ID);
    console.log("SPOTIFY_CLIENT_SECRET =", CLIENT_SECRET);
    console.log("SPOTIFY_REFRESH_TOKEN =", data.refresh_token);
    console.log("\nThen redeploy. Refresh tokens do not expire, so this is a one-time step.");
    console.log("=".repeat(64) + "\n");
  } catch (e) {
    res.writeHead(500).end("error");
    console.error("\nRequest failed:", e.message, "\n");
  }

  server.close();
  process.exit(0);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("\nOpening Spotify authorisation in your browser…");
  console.log("If it does not open, paste this URL yourself:\n\n" + authUrl + "\n");
  const open =
    process.platform === "win32" ? `start "" "${authUrl}"`
    : process.platform === "darwin" ? `open "${authUrl}"`
    : `xdg-open "${authUrl}"`;
  exec(open, () => {});
});
