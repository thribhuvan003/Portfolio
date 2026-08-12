# Spotify setup for `/api/now-playing`

One-time OAuth setup to produce a **refresh token**. The refresh token does not
expire on its own, so this is done once.

## 1. Create the app

1. Go to <https://developer.spotify.com/dashboard> and log in.
2. **Create app**. Name and description can be anything.
3. Under "Which API/SDKs are you planning to use?" tick **Web API**.
4. Save. Open the app → **Settings** to see **Client ID** and **Client secret**
   (click "View client secret").

## 2. Add the Redirect URI

In the app's **Settings → Redirect URIs**, add exactly:

```
http://127.0.0.1:8888/callback
```

Then **Save**.

> `localhost` is rejected. Spotify's redirect-URI rules state verbatim that
> *"'localhost' is not allowed as redirect URI"* and that a loopback address must
> be *"the explicit IPv4 or IPv6, like `http://127.0.0.1:PORT` or
> `http://[::1]:PORT`"*. Plain `http://` is permitted **only** for loopback
> addresses; everything else must be HTTPS. Verified against
> <https://developer.spotify.com/documentation/web-api/concepts/redirect_uri>
> (checked 2026-08-12).
>
> Known dashboard quirk: after saving, the UI sometimes redisplays `127.0.0.1`
> as `localhost`. The saved value is correct — navigate away and back to confirm.

Nothing needs to listen on port 8888. The redirect will fail to load in the
browser; you only need the `code` from the address bar.

## 3. Authorize

Paste this into a browser, replacing `YOUR_CLIENT_ID`:

```
https://accounts.spotify.com/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2Fcallback&scope=user-read-currently-playing%20user-read-recently-played
```

Approve. The browser lands on a dead page at:

```
http://127.0.0.1:8888/callback?code=AQD...very-long...
```

Copy everything after `code=` (stop at `&` if there is one). This code is
single-use and short-lived — if step 4 fails, redo step 3 for a fresh one.

## 4. Exchange the code for a refresh token

`curl` (Git Bash, macOS, Linux, or WSL). Replace the three placeholders:

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=YOUR_CODE_FROM_STEP_3" \
  -d "redirect_uri=http://127.0.0.1:8888/callback"
```

`-u` builds the `Authorization: Basic <base64>` header for you.

PowerShell equivalent (`curl` there is an alias for `Invoke-WebRequest`, so call
`curl.exe` explicitly):

```powershell
curl.exe -X POST https://accounts.spotify.com/api/token -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" -d "grant_type=authorization_code" -d "code=YOUR_CODE_FROM_STEP_3" -d "redirect_uri=http://127.0.0.1:8888/callback"
```

Response:

```json
{
  "access_token": "BQ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "AQ...",
  "scope": "user-read-currently-playing user-read-recently-played"
}
```

Keep `refresh_token`. Ignore `access_token` — the function mints its own.

If you get `invalid_grant`, the code was reused or expired: redo step 3.

## 5. Set the env vars on Vercel

Vercel dashboard → the project → **Settings → Environment Variables**. Add three,
each for **Production**, **Preview**, and **Development**:

| Name | Value |
| --- | --- |
| `SPOTIFY_CLIENT_ID` | Client ID from step 1 |
| `SPOTIFY_CLIENT_SECRET` | Client secret from step 1 |
| `SPOTIFY_REFRESH_TOKEN` | `refresh_token` from step 4 |

**A redeploy is required.** Env vars are injected at deploy time; existing
deployments will not pick them up. Deployments → latest → **⋯ → Redeploy**.

## 6. Verify

```
https://YOUR-DOMAIN.vercel.app/api/now-playing
```

Expected: `{"ok":true,"isPlaying":...}`. Failure modes (always HTTP 200):

| `reason` | Meaning |
| --- | --- |
| `not_configured` | One or more env vars missing — check step 5, then redeploy |
| `auth_failed` | Refresh token rejected — redo steps 3–4 |
| `spotify_error` | Spotify returned an error or timed out |
| `no_recent_tracks` | Nothing playing and no listening history |

Play something in Spotify and reload. Responses are cached for 30s at the edge
(`s-maxage=30`), so allow up to 30s for a change to show.
