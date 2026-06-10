import { describe, expect, test } from "vite-plus/test";
import { classifyHost, classifyUrl } from "../../src/http/host-guard";

function assertBlocked(verdict: { ok: boolean; reason?: string }, hint: string): void {
    expect(verdict.ok, `expected ${hint} to be blocked`).toBe(false);
}

describe("classifyHost — IPv4 literal forms", () => {
    test.each([
        "127.0.0.1",
        "127.1.2.3",
        "10.0.0.5",
        "172.16.0.1",
        "172.31.255.254",
        "192.168.1.1",
        "169.254.169.254", // AWS metadata
        "0.0.0.0",
        "100.64.0.1", // CGNAT
        "224.0.0.1", // multicast
        "240.0.0.1", // reserved
    ])("blocks dotted-decimal private/reserved %s", (host) => {
        assertBlocked(classifyHost(host), host);
    });

    test.each(["8.8.8.8", "1.1.1.1", "208.67.222.222"])("allows public %s", (host) => {
        expect(classifyHost(host).ok).toBe(true);
    });

    test("blocks decimal-integer form 2130706433 (= 127.0.0.1)", () => {
        assertBlocked(classifyHost("2130706433"), "decimal 127.0.0.1");
    });

    test("blocks hex 0x7f000001 (= 127.0.0.1)", () => {
        assertBlocked(classifyHost("0x7f000001"), "hex 127.0.0.1");
    });

    test("blocks per-octet octal 0177.0.0.1 (= 127.0.0.1)", () => {
        assertBlocked(classifyHost("0177.0.0.1"), "octal 127.0.0.1");
    });
});

describe("classifyHost — IPv6 literal forms", () => {
    test.each(["::1", "::0", "::", "fe80::1", "fc00::1", "fd00::1", "ff02::1"])(
        "blocks %s",
        (host) => {
            assertBlocked(classifyHost(host), host);
        },
    );

    test.each(["2001:db8::1", "2606:4700:4700::1111"])("allows %s", (host) => {
        expect(classifyHost(host).ok).toBe(true);
    });

    test("blocks IPv4-mapped IPv6 ::ffff:127.0.0.1", () => {
        assertBlocked(classifyHost("::ffff:127.0.0.1"), "::ffff:127.0.0.1");
    });

    test("blocks IPv4-mapped IPv6 hex form ::ffff:7f00:1", () => {
        assertBlocked(classifyHost("::ffff:7f00:1"), "::ffff:7f00:1");
    });

    test("strips outer brackets if present", () => {
        assertBlocked(classifyHost("[::1]"), "[::1]");
    });
});

describe("classifyHost — names", () => {
    test("blocks localhost and *.localhost", () => {
        assertBlocked(classifyHost("localhost"), "localhost");
        assertBlocked(classifyHost("anything.localhost"), "anything.localhost");
    });

    test("allows arbitrary public-looking hostnames (DNS check is the caller's job)", () => {
        expect(classifyHost("example.com").ok).toBe(true);
        expect(classifyHost("api.github.com").ok).toBe(true);
    });
});

describe("classifyUrl", () => {
    test("rejects non-http(s) schemes", () => {
        assertBlocked(classifyUrl("file:///etc/passwd"), "file://");
        assertBlocked(classifyUrl("gopher://example.com/"), "gopher://");
        assertBlocked(classifyUrl("data:text/html,hi"), "data:");
    });

    test("rejects malformed URLs", () => {
        assertBlocked(classifyUrl("not-a-url"), "not a URL");
    });

    test("allows https://example.com", () => {
        expect(classifyUrl("https://example.com/").ok).toBe(true);
    });

    test("delegates to classifyHost for IPv4-mapped IPv6 via URL with brackets", () => {
        assertBlocked(classifyUrl("http://[::ffff:7f00:1]:9999/"), "http://[::ffff:7f00:1]:9999");
    });
});
