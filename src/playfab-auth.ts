import { readSecret, type SecretBinding } from "./secret-binding";
export interface PlayFabAuthEnv {
  CR_TITLEID: SecretBinding;
  CR_PLAYFAB_SECRET: SecretBinding;
}

export class AuthenticationError extends Error {
  readonly status = 401;

  constructor(message: string) {
    super(message);
  }
}

interface AuthenticateSessionTicketResponse {
  code?: number;
  status?: string;
  data?: {
    UserInfo?: {
      PlayFabId?: string;
    };
  };
}

export async function requirePlayerId(
  request: Request,
  env: PlayFabAuthEnv
): Promise<string> {
  const authorization = request.headers.get("authorization")?.trim();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const sessionTicket = match?.[1]?.trim();

  if (!sessionTicket) {
    throw new AuthenticationError("Authorization bearer token is required");
  }

  const titleId = await readSecret(env.CR_TITLEID, "CR_TITLEID");
  const secretKey = await readSecret(env.CR_PLAYFAB_SECRET, "CR_PLAYFAB_SECRET");

  if (!/^[A-Za-z0-9]+$/.test(titleId)) {
    throw new Error("Invalid PlayFab title ID binding");
  }

  const response = await fetch(
    `https://${titleId}.playfabapi.com/Server/AuthenticateSessionTicket`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-secretkey": secretKey
      },
      body: JSON.stringify({
        SessionTicket: sessionTicket
      })
    }
  );

  let payload: AuthenticateSessionTicketResponse | undefined;
  try {
    payload = await response.json() as AuthenticateSessionTicketResponse;
  } catch {
    payload = undefined;
  }

  const playerId = payload?.data?.UserInfo?.PlayFabId?.trim();
  if (!response.ok || !playerId) {
    throw new AuthenticationError("Invalid or expired PlayFab session");
  }

  return playerId;
}
