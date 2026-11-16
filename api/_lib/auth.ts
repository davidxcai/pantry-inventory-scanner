import type { VercelRequest } from "@vercel/node";
import { isUtaEmail } from "../../shared/email.js";
import { admin } from "./clients.js";

// Only signed-in UTA users may spend Gemini quota.
export async function utaUser(req: VercelRequest): Promise<{ id: string } | { status: 401 | 403; error: string }> {
  const token = req.headers.authorization?.replace(/^Bearer /i, "");
  const { data } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  const user = data.user;
  if (!user) return { status: 401, error: "sign in required" };
  if (!isUtaEmail(user.email ?? "")) return { status: 403, error: "UTA email required" };
  return { id: user.id };
}
