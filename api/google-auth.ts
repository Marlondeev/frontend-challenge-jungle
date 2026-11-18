import type { ServerResponse } from "node:http";
import { defaultGoogleClientId } from "../config/google-client.js";
import {
  createHostedGoogleHandler,
  type HostedGoogleRequest,
} from "../server/hosted-google-auth.js";

const handler = createHostedGoogleHandler({
  clientId: process.env.VITE_GOOGLE_CLIENT_ID?.trim() || defaultGoogleClientId,
});

/** Vercel Node Function: actual Google verification, no application database or session store. */
export default function googleAuth(
  req: HostedGoogleRequest,
  res: ServerResponse,
): Promise<void> {
  return handler(req, res);
}
