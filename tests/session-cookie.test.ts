import { describe, expect, it } from "vitest";
import { decideCookieSecure } from "@/server/auth/session";

/**
 * Whether the session cookie is marked `Secure`.
 *
 * This was the bug that made Moonpool unusable on a LAN: the flag was derived
 * from NODE_ENV, the production image always sets NODE_ENV=production, and a
 * browser silently discards a `Secure` cookie on a plain-HTTP origin. Sign-in
 * returned 200, the session row was written, the cookie evaporated, and the
 * app bounced straight back to the login screen with nothing to show for it.
 *
 * The rule is therefore about the REQUEST, never the build.
 */

const headers = (map: Record<string, string>) => (name: string) => map[name.toLowerCase()] ?? null;

describe("decideCookieSecure", () => {
  it("is NOT secure for plain HTTP on the LAN — the case that broke sign-in", () => {
    expect(decideCookieSecure(headers({ origin: "http://moonpool.local:3000" }), undefined)).toBe(false);
  });

  it("is NOT secure when the request carries no protocol hints at all", () => {
    expect(decideCookieSecure(headers({}), undefined)).toBe(false);
  });

  it("is secure behind a TLS-terminating proxy", () => {
    expect(decideCookieSecure(headers({ "x-forwarded-proto": "https" }), undefined)).toBe(true);
  });

  it("reads only the client-facing hop of a proxy chain", () => {
    expect(decideCookieSecure(headers({ "x-forwarded-proto": "https, http" }), undefined)).toBe(true);
    expect(decideCookieSecure(headers({ "x-forwarded-proto": "http, https" }), undefined)).toBe(false);
  });

  it("tolerates spacing and case from odd proxies", () => {
    expect(decideCookieSecure(headers({ "x-forwarded-proto": "  HTTPS  " }), undefined)).toBe(true);
    expect(decideCookieSecure(headers({ "x-forwarded-protocol": "https" }), undefined)).toBe(true);
  });

  it("falls back to the origin when no proxy header is present", () => {
    expect(decideCookieSecure(headers({ origin: "https://pool.example.com" }), undefined)).toBe(true);
    expect(decideCookieSecure(headers({ referer: "https://pool.example.com/login" }), undefined)).toBe(true);
  });

  it("lets the operator force it either way for direct TLS", () => {
    expect(decideCookieSecure(headers({}), "true")).toBe(true);
    expect(decideCookieSecure(headers({ "x-forwarded-proto": "https" }), "false")).toBe(false);
  });

  it("prefers the proxy header over a stale origin", () => {
    // A page loaded over https that posts through an http hop must not get a
    // cookie the browser will then refuse to send back.
    expect(decideCookieSecure(headers({ "x-forwarded-proto": "http", origin: "https://pool.example.com" }), undefined)).toBe(false);
  });
});
