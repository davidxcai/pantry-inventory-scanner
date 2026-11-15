// UTA-specific checks remain separate from the pantry login policy, which also
// permits Gmail. Review privileges are independently allowlisted.

const ALLOWED_DOMAINS = ["uta.edu", "mavs.uta.edu"];

export const UTA_EMAIL_MESSAGE = "Use your @uta.edu or @mavs.uta.edu email address.";

export function isUtaEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || e.indexOf("@") !== at || /\s/.test(e)) return false;
  return ALLOWED_DOMAINS.includes(e.slice(at + 1));
}

export function isPantryEmail(email: string): boolean {
  if (isUtaEmail(email)) return true
  const value = email.trim().toLowerCase()
  return /^[^@\s]+@gmail\.com$/.test(value)
}
