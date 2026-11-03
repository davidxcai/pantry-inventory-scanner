// The only module that knows the email provider (Resend, via the Vercel Marketplace integration).
// Swapping providers means changing this file and its env vars.

export const APP_URL = process.env.APP_URL ?? "https://utapantry.xyz";

const FROM = `Thyme Saver <alerts@${process.env.RESEND_EMAIL_DOMAIN ?? "utapantry.xyz"}>`;

export type Email = { to: string; subject: string; text: string; html: string; unsubscribeUrl: string };

// 'limited' means the provider's rate or daily quota was hit; the caller should stop and retry later.
export async function sendEmail(email: Email): Promise<"sent" | "limited"> {
  if (!process.env.RESEND_API_KEY) throw new Error("Email provider is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      // One-click unsubscribe (RFC 8058). Gmail and Outlook show it as an Unsubscribe button.
      headers: {
        "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (res.status === 429) return "limited";
  if (!res.ok) throw new Error(`email send failed: ${res.status} ${await res.text()}`);
  return "sent";
}
