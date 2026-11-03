// Unsubscribe link from notification emails: removes every watch the user has.
// GET only shows a confirm button, because mail scanners (Microsoft Safe Links on UTA mail) open
// links in emails and would otherwise unsubscribe people. POST does the work, and is also what
// mail clients send for the one-click List-Unsubscribe header.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { admin } from "./_lib/clients.js";
import { APP_URL } from "./_lib/sendEmail.js";
import { verifyUnsubscribeToken } from "../shared/notifyDigest.js";

const page = (body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>Thyme Saver emails</title><body style="font-family:system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem">${body}</body>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = typeof req.query.t === "string" ? req.query.t : "";
  const userId = token ? await verifyUnsubscribeToken(process.env.SUPABASE_SECRET_KEY!, token) : null;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!userId) return res.status(400).send(page("<p>This unsubscribe link is not valid.</p>"));

  if (req.method === "POST") {
    const { error } = await admin.rpc("stop_wishlist_emails", { p_user_id: userId });
    if (error) return res.status(500).send(page("<p>Something went wrong. Try again in a minute.</p>"));
    return res.status(200).send(
      page(`<p>Wishlist availability emails are paused. Your wishlist is still saved. You can turn email alerts back on in <a href="${APP_URL}/profile?list=wishlist">your Wishlist</a>.</p>`),
    );
  }
  if (req.method !== "GET") return res.status(405).send(page("<p>Method not allowed.</p>"));

  return res.status(200).send(
    page(
      `<p>Pause wishlist availability emails from Thyme Saver? Your wishlist items will stay saved.</p>` +
        `<form method="post"><button type="submit" style="padding:.5rem 1rem">Unsubscribe</button></form>`,
    ),
  );
}
