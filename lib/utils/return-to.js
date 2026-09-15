/**
 * Where a form goes back to, when something else sent you to it.
 *
 * A claim raised from inside the Projects module should land back in the
 * Projects module, not in My Claims — the module the user was working in is
 * where the answer they wanted appears. The originating page says so with a
 * `?returnTo=` on the link.
 *
 * AND THAT PARAMETER IS ATTACKER-CONTROLLED, because every query parameter is.
 * `router.push(searchParams.get("returnTo"))` with `https://evil.example` is an
 * open redirect, and the fact that our own links only ever put a `/dashboard/`
 * path there is not a control — it describes our links, not the ones somebody
 * else can email. So this is an ALLOW-LIST, not a sanitiser: a value that is
 * not plainly an internal dashboard path is discarded and the caller's own
 * default is used.
 *
 * `//evil.example` is the case a naive `startsWith("/")` misses — the browser
 * reads a protocol-relative URL as a host, so it must be rejected explicitly.
 * A backslash is rejected for the same reason: some parsers fold `\` to `/`.
 */
export function safeReturnTo(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (candidate !== "/dashboard" && !candidate.startsWith("/dashboard/")) {
    return fallback;
  }
  if (candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  // A control character can smuggle a newline past a parser that splits on one.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  return candidate;
}

/**
 * A `&returnTo=` fragment for a link, or "" when there is nowhere to go back
 * to, so a caller can interpolate it unconditionally.
 */
export function returnToParam(value) {
  const safe = safeReturnTo(value);
  return safe ? `&returnTo=${encodeURIComponent(safe)}` : "";
}
