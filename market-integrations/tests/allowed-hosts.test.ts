import { describe, expect, it } from "vitest";
import {
  getRequestOrigin,
  isAllowedHost,
  isLoopbackOrPrivateHostname,
  isMlWafBlockedRedirectUri,
  resolveCallbackUri,
} from "@/lib/net/allowed-hosts";

describe("allowed hosts", () => {
  it("allows LAN IP and quick tunnel", () => {
    expect(isAllowedHost("10.131.24.6")).toBe(true);
    expect(isAllowedHost("foo.trycloudflare.com")).toBe(true);
    expect(isAllowedHost("evil.example.com")).toBe(false);
  });

  it("resolves callback for allowed origin", () => {
    expect(resolveCallbackUri("http://10.131.24.6:3000")).toBe(
      "http://10.131.24.6:3000/api/auth/ml/callback"
    );
    expect(resolveCallbackUri("https://abc.trycloudflare.com")).toBe(
      "https://abc.trycloudflare.com/api/auth/ml/callback"
    );
  });

  it("uses Cloudflare forwarded headers", () => {
    const headers = new Headers({
      "x-forwarded-host": "abc.trycloudflare.com",
      "x-forwarded-proto": "https",
    });
    expect(getRequestOrigin(headers, "http://localhost:3000")).toBe(
      "https://abc.trycloudflare.com"
    );
  });

  it("detects hosts blocked by ML CloudFront WAF in redirect_uri", () => {
    expect(isLoopbackOrPrivateHostname("localhost")).toBe(true);
    expect(isLoopbackOrPrivateHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackOrPrivateHostname("10.131.24.6")).toBe(true);
    expect(isLoopbackOrPrivateHostname("192.168.1.10")).toBe(true);
    expect(isLoopbackOrPrivateHostname("abc.trycloudflare.com")).toBe(false);
    expect(isLoopbackOrPrivateHostname("example.com")).toBe(false);

    expect(
      isMlWafBlockedRedirectUri("http://10.131.24.6:3000/api/auth/ml/callback")
    ).toBe(true);
    expect(
      isMlWafBlockedRedirectUri("http://localhost:3000/api/auth/ml/callback")
    ).toBe(true);
    expect(
      isMlWafBlockedRedirectUri(
        "https://abc.trycloudflare.com/api/auth/ml/callback"
      )
    ).toBe(false);
  });
});
