import { NextResponse } from "next/server";

/**
 * Soft shutdown: the live site returns offline for all routes.
 * No app code, data, or routes are deleted — remove this middleware
 * (or set SITE_SHUTDOWN=0) to bring the site back.
 */
export function middleware() {
  const flag = process.env.SITE_SHUTDOWN?.trim().toLowerCase();
  const shutDown = flag !== "0" && flag !== "false" && flag !== "off";

  if (!shutDown) {
    return NextResponse.next();
  }

  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Green Gas — Site shut down</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Source Sans 3", "Segoe UI", sans-serif;
      background: linear-gradient(160deg, #0f2a1f 0%, #1a3d2e 45%, #243628 100%);
      color: #f4f7f2;
    }
    main {
      max-width: 28rem;
      padding: 2rem;
      text-align: center;
    }
    h1 {
      margin: 0 0 0.75rem;
      font-family: Fraunces, Georgia, serif;
      font-size: 1.75rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    p { margin: 0; opacity: 0.85; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>Green Gas Fleet Tracker</h1>
    <p>This site is shut down. Tracking and alerts are offline.</p>
  </main>
</body>
</html>`;

  return new NextResponse(body, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "86400",
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-touch-icon.png).*)"],
};
