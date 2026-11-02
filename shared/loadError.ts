// Wording for a failed list load. Only blames the connection when the request never got an answer:
// a database or API error (it has a code, e.g. 42703) is our fault, and telling students to check
// their wifi sends them chasing the wrong thing. When older data is still on screen, says so.

type ErrorLike = { message?: string; code?: string } | null | undefined;

// supabase-js turns a failed fetch into { code: "", message: "TypeError: Failed to fetch" }
// (Chrome), "TypeError: Load failed" (Safari) or "TypeError: NetworkError ..." (Firefox).
export function isNetworkError(error: ErrorLike, online = true): boolean {
  if (!online) return true;
  if (!error || error.code) return false;
  return /failed to fetch|load failed|networkerror|network request failed/i.test(error.message ?? "");
}

export function loadErrorMessage(error: ErrorLike, opts: { what: string; hasData: boolean; online?: boolean }): string {
  const stale = opts.hasData ? ` The ${opts.what} below may be out of date.` : "";
  return isNetworkError(error, opts.online)
    ? `Can't reach the server. Check your connection.${stale}`
    : `Something went wrong loading ${opts.what}. Try again in a few minutes.${stale}`;
}
