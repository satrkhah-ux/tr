import { describe, expect, it } from "vitest";
import { fetchPublic, isPublicAddress, isPublicHostname } from "./fetch-public";

/** The forms the old regex let through (security audit M6), plus the obvious ones. */
describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "127.0.0.1",
    "10.1.2.3",
    "172.17.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "::ffff:127.0.0.1",
    "[::ffff:127.0.0.1]",
    "[::ffff:7f00:1]",
    "::ffff:8.8.8.8",
    "::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "fd00::1",
    "fc00::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "2002:7f00:1::",
    "2001:db8::1",
    "not-an-ip",
  ])("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "100.128.0.1", "172.32.0.1", "2606:4700:4700::1111", "[2a00:1450:4001::64]"])(
    "allows %s",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );
});

describe("isPublicHostname", () => {
  it.each(["kong", "localhost", "db", "metadata", "app.localhost", "printer.local", "metadata.google.internal", "0.0.0.0", "[::ffff:127.0.0.1]"])(
    "refuses %s",
    (host) => {
      expect(isPublicHostname(host)).toBe(false);
    },
  );

  it.each(["example.com", "brochures.supplier.travel.", "8.8.8.8"])("allows %s", (host) => {
    expect(isPublicHostname(host)).toBe(true);
  });
});

describe("fetchPublic", () => {
  it.each([
    "http://0.0.0.0:8000/",
    "http://[::ffff:127.0.0.1]:8000/",
    "http://kong:8000/",
    "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/", // 127.0.0.1 written as a number
    "file:///etc/passwd",
    "http://user:pass@example.com/",
  ])("refuses %s without connecting", async (url) => {
    await expect(fetchPublic(url, 1024, 2_000)).resolves.toBeNull();
  });
});
