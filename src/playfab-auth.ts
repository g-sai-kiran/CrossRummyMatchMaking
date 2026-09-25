export interface PlayFabAuthEnv {
  CR_TITLEID: string;
  CR_PLAYFAB_SECRET: string;
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

  if (!env.CR_TITLEID?.trim() || !env.CR_PLAYFAB_SECRET?.trim()) {
    throw new Error("PlayFab server authentication is not configured");
  }

  const response = await fetch(
    `https://${env.CR_TITLEID}.playfabapi.com/Server/AuthenticateSessionTicket`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-secretkey": env.CR_PLAYFAB_SECRET
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
