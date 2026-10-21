/**
 * Whether the session cookie carries the Secure flag. Browsers only store Secure
 * cookies over https (and on localhost), so it follows the protocol the request
 * really arrived on — Next.js fills `x-forwarded-proto` from the socket, or keeps
 * the value a TLS proxy sent. Plain http on a network address
 * (http://192.168.1.20:3000) then still signs people in instead of bouncing them
 * back to the login page. `COOKIE_SECURE=true|false` overrides the detection.
 */
export function secureCookieFor(forwardedProto: string | null | undefined, setting = "auto", isProduction = false): boolean {
  const forced = setting.trim().toLowerCase();
  if (forced === "true") return true;
  if (forced === "false") return false;
  const proto = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  return proto ? proto === "https" : isProduction;
}
