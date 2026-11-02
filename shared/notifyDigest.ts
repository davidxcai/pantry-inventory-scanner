// Pure logic for stock notification emails: group queued rows into one digest per user and render it.
// The sender is api/notify.ts; the queue is filled by a trigger on item_status_log.

import type { PublicAvailability } from "./catalogView";

export type QueuedNotification = {
  id: number;
  user_id: string;
  item_id: string;
  item_name: string;
  status: PublicAvailability;
  // 'report' is a new status (pending until a second student agrees), 'confirm' is that agreement.
  kind: "report" | "confirm";
  created_at: string;
};

export type DigestItem = { itemId: string; name: string; status: PublicAvailability; kind: "report" | "confirm" };

export type Digest = {
  userId: string;
  // Every queue row the digest covers, including ones collapsed away.
  rowIds: number[];
  items: DigestItem[];
};

// One digest per user. Several updates to the same item collapse to the latest. Items are sorted by name.
export function groupDigests(rows: QueuedNotification[]): Digest[] {
  const byUser = new Map<string, { rowIds: number[]; latest: Map<string, QueuedNotification> }>();
  for (const r of rows) {
    let d = byUser.get(r.user_id);
    if (!d) byUser.set(r.user_id, (d = { rowIds: [], latest: new Map() }));
    d.rowIds.push(r.id);
    const prev = d.latest.get(r.item_id);
    if (!prev || r.created_at > prev.created_at || (r.created_at === prev.created_at && r.id > prev.id)) {
      d.latest.set(r.item_id, r);
    }
  }
  return [...byUser].map(([userId, d]) => ({
    userId,
    rowIds: d.rowIds,
    items: [...d.latest.values()]
      .map((r) => ({ itemId: r.item_id, name: r.item_name, status: r.status, kind: r.kind }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

const STATUS_TEXT: Record<PublicAvailability, string> = { in_stock: "In stock", low: "Low", out: "Out of stock" };

export function describeUpdate(item: DigestItem): string {
  const status = STATUS_TEXT[item.status];
  return item.kind === "confirm" ? `${status} (confirmed by a second student)` : `${status} (reported, waiting for a second student)`;
}

export function digestSubject(items: DigestItem[]): string {
  if (items.length === 1) return `${items[0].name}: ${STATUS_TEXT[items[0].status].toLowerCase()}`;
  return `${items.length} items you watch were updated`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const FOOTER = "Thyme Saver is a student-run project and is not affiliated with UTA.";

export function renderDigest(items: DigestItem[], links: { app: string; watching: string; unsubscribe: string }) {
  const lines = items.map((i) => `- ${i.name}: ${describeUpdate(i)}`);
  const text = [
    "Items you watch on Thyme Saver were updated:",
    "",
    ...lines,
    "",
    `See the pantry: ${links.app}`,
    `Manage what you watch: ${links.watching}`,
    `Stop all of these emails: ${links.unsubscribe}`,
    "",
    FOOTER,
  ].join("\n");

  const rows = items
    .map((i) => `<li><strong>${escapeHtml(i.name)}</strong>: ${escapeHtml(describeUpdate(i))}</li>`)
    .join("");
  const html =
    `<p>Items you watch on Thyme Saver were updated:</p><ul>${rows}</ul>` +
    `<p><a href="${escapeHtml(links.app)}">See the pantry</a></p>` +
    `<p style="font-size:12px;color:#666">` +
    `<a href="${escapeHtml(links.watching)}">Manage what you watch</a> · ` +
    `<a href="${escapeHtml(links.unsubscribe)}">Stop all of these emails</a><br>${escapeHtml(FOOTER)}</p>`;

  return { subject: digestSubject(items), text, html };
}

// ---------- unsubscribe token: HMAC-SHA256 of the user id, so a link only works for its own user ----------

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`unsubscribe:${message}`)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function unsubscribeToken(secret: string, userId: string): Promise<string> {
  return `${userId}.${await hmac(secret, userId)}`;
}

// Returns the user id when the token is genuine, otherwise null.
export async function verifyUnsubscribeToken(secret: string, token: string): Promise<string | null> {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const userId = token.slice(0, dot);
  const expected = await hmac(secret, userId);
  const given = token.slice(dot + 1);
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0 ? userId : null;
}
