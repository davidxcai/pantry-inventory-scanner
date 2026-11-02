// Sends stock notification digests: one email per user covering every watched item that changed.
// Called every 10 minutes by Supabase pg_cron (migration 20261101010000_notify_schedule.sql) with
// Authorization: Bearer $CRON_SECRET.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { admin } from "./_lib/clients.js";
import { APP_URL, sendEmail } from "./_lib/sendEmail.js";
import { groupDigests, renderDigest, unsubscribeToken, type QueuedNotification } from "../shared/notifyDigest.js";

export const config = { maxDuration: 60 };

// Resend's free tier allows 100 emails a day; leave the rest queued for the next run.
const USERS_PER_RUN = 25;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // Claiming marks the rows sent, so an overlapping run cannot pick them up too.
  const { data, error } = await admin.rpc("claim_notifications", { p_users: USERS_PER_RUN });
  if (error) return res.status(500).json({ error: error.message });

  const digests = groupDigests(data as QueuedNotification[]);
  const outcomes = { sent: 0, failed: 0, limited: 0 };
  let limited = false;

  for (const digest of digests) {
    if (limited) {
      await admin.rpc("release_notifications", { p_ids: digest.rowIds });
      outcomes.limited++;
      continue;
    }
    try {
      const { data: user } = await admin.auth.admin.getUserById(digest.userId);
      const to = user.user?.email;
      if (!to) continue; // no address to send to; the rows stay marked
      const unsubscribeUrl = `${APP_URL}/api/unsubscribe?t=${encodeURIComponent(
        await unsubscribeToken(process.env.SUPABASE_SECRET_KEY!, digest.userId),
      )}`;
      const content = renderDigest(digest.items, { app: APP_URL, watching: `${APP_URL}/watching`, unsubscribe: unsubscribeUrl });
      const result = await sendEmail({ to, unsubscribeUrl, ...content });
      if (result === "limited") {
        limited = true;
        await admin.rpc("release_notifications", { p_ids: digest.rowIds });
        outcomes.limited++;
      } else {
        outcomes.sent++;
      }
    } catch {
      await admin.rpc("release_notifications", { p_ids: digest.rowIds });
      outcomes.failed++;
    }
  }
  return res.status(200).json({ digests: digests.length, ...outcomes });
}
