// Student access is limited to UTA addresses. The designated reviewer registration
// exception is defined separately in visitApprover.ts and the database migration.

const ALLOWED_DOMAINS = ["uta.edu", "mavs.uta.edu"];

export const UTA_EMAIL_MESSAGE = "Use your @uta.edu or @mavs.uta.edu email address.";

export function isUtaEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || e.indexOf("@") !== at || /\s/.test(e)) return false;
  return ALLOWED_DOMAINS.includes(e.slice(at + 1));
}
