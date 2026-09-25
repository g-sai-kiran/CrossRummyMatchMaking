import { listPushInstallations } from "./invite-store";

export interface FirebasePushEnv {
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}

interface CachedAccessToken {
  token: string;
  expiresAt: number;
}

let cachedAccessToken: CachedAccessToken | null = null;

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n");
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getAccessToken(env: FirebasePushEnv): Promise<string> {
  if (
    !env.FCM_PROJECT_ID?.trim() ||
    !env.FCM_CLIENT_EMAIL?.trim() ||
    !env.FCM_PRIVATE_KEY?.trim()
  ) {
    throw new Error("Firebase push credentials are not configured");
  }

  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt - 60_000 > nowMs) {
    return cachedAccessToken.token;
  }

  const now = Math.floor(nowMs / 1000);
  const header = base64UrlEncodeText(JSON.stringify({
    alg: "RS256",
    typ: "JWT"
  }));
  const payload = base64UrlEncodeText(JSON.stringify({
    iss: env.FCM_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsignedJwt = `${header}.${payload}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.FCM_PRIVATE_KEY),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedJwt)
  );

  const assertion = `${unsignedJwt}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const body = await response.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new Error(
      `Unable to obtain Firebase access token: ${body.error_description ?? body.error ?? response.status}`
    );
  }

  cachedAccessToken = {
    token: body.access_token,
    expiresAt: nowMs + (body.expires_in ?? 3600) * 1000
  };

  return body.access_token;
}

async function sendToInstallation(
  env: FirebasePushEnv,
  installationId: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<void> {
  const accessToken = await getAccessToken(env);

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          fid: installationId,
          notification: {
            title,
            body
          },
          data
        }
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `FCM send failed for installation ${installationId}: ${response.status} ${errorBody}`
    );
  }
}

export async function sendPushToPlayer(
  db: D1Database,
  env: FirebasePushEnv,
  playerId: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<void> {
  if (
    !env.FCM_PROJECT_ID?.trim() ||
    !env.FCM_CLIENT_EMAIL?.trim() ||
    !env.FCM_PRIVATE_KEY?.trim()
  ) {
    console.warn("Firebase push is not configured; invite was saved without a push.");
    return;
  }

  const installationIds = await listPushInstallations(db, playerId);
  if (installationIds.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    installationIds.map(installationId =>
      sendToInstallation(env, installationId, title, body, data)
    )
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Push notification failed", result.reason);
    }
  }
}
