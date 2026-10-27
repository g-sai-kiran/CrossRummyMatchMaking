/**
 * Public Android App Links endpoints, hosted by the existing matchmaking
 * Worker. No PlayFab credentials, D1 lookup, or game-room allocation is
 * performed by GET /join/:code. Joining is still performed by the authenticated
 * POST /invites/join/:code API after Unity receives the URL.
 */

const ANDROID_PACKAGE_NAME = "com.trilightstudios.crossrummy";
const VALID_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const CERT_FINGERPRINT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/i;

export interface AppLinksEnvironment {
  // Comma-separated Google Play app-signing (and optional debug) SHA-256
  // certificate fingerprints, using AA:BB:... formatting.
  ANDROID_APP_SHA256_FINGERPRINTS?: string;
}

const commonHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store"
};

function certificateFingerprints(env: AppLinksEnvironment): string[] | null {
  const raw = env.ANDROID_APP_SHA256_FINGERPRINTS ?? "";
  const fingerprints = raw.split(",").map(value => value.trim().toUpperCase())
    .filter(value => value.length > 0);

  if (fingerprints.length === 0 || fingerprints.some(
    fingerprint => !CERT_FINGERPRINT.test(fingerprint)
  )) {
    return null;
  }

  return [...new Set(fingerprints)];
}

function assetLinksResponse(method: string, env: AppLinksEnvironment): Response {
  const fingerprints = certificateFingerprints(env);
  if (!fingerprints) {
    // Never expose a fake/placeholder association document.
    return new Response(
      method === "HEAD" ? null : "Android App Links signing certificate is not configured.",
      {
        status: 503,
        headers: {
          ...commonHeaders,
          "content-type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  const body = JSON.stringify([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: ANDROID_PACKAGE_NAME,
      sha256_cert_fingerprints: fingerprints
    }
  }]);

  return new Response(method === "HEAD" ? null : body, {
    headers: {
      ...commonHeaders,
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function joinPage(code: string): string {
  // Only a validated A-Z/2-9 code is included in the HTML, preventing XSS.
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Join Cross Rummy</title>',
    '<style>',
    'html{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;',
    'place-items:center;background:#20150d;color:#ffedcc;',
    'font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}',
    'main{box-sizing:border-box;max-width:480px;width:calc(100% - 32px);',
    'text-align:center;padding:32px 24px;border:2px solid #b98a3d;',
    'border-radius:18px;background:#322215;box-shadow:0 12px 50px #0008}',
    'h1{margin:0 0 12px;color:#ffd86a;font-size:29px}',
    '.code{font:700 33px/1.4 monospace;letter-spacing:4px;color:#ffdb6a;',
    'margin:12px 0 20px;user-select:all}',
    '.button{display:block;border-radius:10px;background:#ffcf54;',
    'padding:13px 18px;color:#231607;text-decoration:none;font-weight:700}',
    'small{display:block;margin-top:20px;color:#ddd0be}',
    '</style></head><body><main>',
    '<h1>Join Cross Rummy</h1>',
    '<p>Open Cross Rummy on your phone to join your friend.</p>',
    '<div class="code" aria-label="Invite code">', code, '</div>',
    '<a class="button" href="crossrummy://join/', code, '">Open Cross Rummy</a>',
    '<small>If the app does not open, install Cross Rummy and enter ',
    'the code using Find Friends. This code can expire or be cancelled.',
    '</small></main></body></html>'
  ].join("");
}

/**
 * Returns null for all unrelated paths, so existing matchmaking APIs keep
 * their current authentication, response types, and behavior.
 */
export function handlePublicAppLink(
  request: Request,
  env: AppLinksEnvironment
): Response | null {
  const path = new URL(request.url).pathname;
  const isAssociationFile = path === "/.well-known/assetlinks.json";
  const isJoinPath = path === "/join" || path.startsWith("/join/");

  if (!isAssociationFile && !isJoinPath) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { ...commonHeaders, "allow": "GET, HEAD" }
    });
  }

  if (isAssociationFile) return assetLinksResponse(request.method, env);

  const matched = /^\/join\/([^/]+)\/?$/.exec(path);
  const code = matched?.[1]?.toUpperCase() ?? "";
  if (!VALID_CODE.test(code)) {
    return new Response(request.method === "HEAD" ? null : "Not found", {
      status: 404,
      headers: { ...commonHeaders, "content-type": "text/plain; charset=utf-8" }
    });
  }

  return new Response(request.method === "HEAD" ? null : joinPage(code), {
    headers: {
      ...commonHeaders,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}
