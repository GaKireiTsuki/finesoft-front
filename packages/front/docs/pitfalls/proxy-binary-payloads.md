# Pitfall: proxy binary payloads

## Symptom

You proxy an upstream that returns an image / PDF / protobuf, and:

- Images come through corrupted (broken thumbnails, gray boxes)
- PDFs fail to open ("invalid PDF structure")
- Protobuf clients throw "unexpected wire type" / decoding errors
- File sizes are slightly different between source and proxied response

The headers look fine. The status is 200. The body is what's broken.

## Root cause

Earlier versions of the proxy forwarded responses via `response.text()`. `text()` decodes bytes as **UTF-8** — which works for JSON and HTML but **destroys** any non-UTF-8 byte sequence:

- Bytes that aren't valid UTF-8 are replaced with `U+FFFD` (the replacement character, `0xEF 0xBF 0xBD`)
- The decoded string is then re-encoded as UTF-8 when it goes back into the response, producing a **different byte sequence than the original**

A PNG file starts with `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A` — the leading `0x89` is not valid UTF-8, so it becomes `0xEF 0xBF 0xBD`. The browser's image decoder sees garbage starting at byte 0 and bails.

The current implementation uses `response.arrayBuffer()` and forwards bytes verbatim:

```ts
// packages/server/src/proxy.ts
const body = await resp.arrayBuffer();
return c.newResponse(body, resp.status, respHeaders);
```

This preserves the response byte-for-byte. Images render correctly, PDFs open, protobuf decodes.

## Verifying

The framework's own test (`packages/server/test/proxy.test.ts`) checks this with a PNG signature:

```ts
const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
const fetchMock = vi.fn(
    async () =>
        new Response(binary, {
            status: 200,
            headers: { "Content-Type": "image/png" },
        }),
);

// ... after the handler runs ...

expect(new Uint8Array(capturedBuffer)).toEqual(binary);
```

If you suspect a proxy is corrupting binaries:

```bash
# Compare hashes of direct vs proxied
curl -s https://upstream.example/image.png | sha256sum
curl -s http://localhost:3000/api/image.png | sha256sum
```

Different hash = corruption. Same hash = the proxy is fine, look elsewhere.

## When you'd hit this

If you're on the current version (which uses `arrayBuffer`), you won't. This pitfall exists primarily as historical context for:

- **Upgrading from an older version** — verify your binary endpoints after upgrade
- **Building your own custom proxy logic** — if you copy from older examples, you'll reintroduce the bug
- **Diagnosing if a third-party proxy in front of yours has the same issue** — apply the same `arrayBuffer` test against it

## Custom proxies — get this right

If you write your own proxy code (outside the framework's `registerProxyRoutes`), use `arrayBuffer`:

```ts
// GOOD
app.all("/api/*", async (c) => {
    const resp = await fetch(targetUrl);
    const body = await resp.arrayBuffer();
    return c.newResponse(body, resp.status, {
        "Content-Type": resp.headers.get("Content-Type") ?? "application/octet-stream",
    });
});
```

```ts
// BAD — corrupts non-UTF-8 bytes
app.all("/api/*", async (c) => {
    const resp = await fetch(targetUrl);
    return c.text(await resp.text(), resp.status);
});
```

## Streaming for large bodies

For responses >10 MB, the framework's bundled proxy rejects with HTTP 502 to avoid loading them entirely into memory. If you need to support larger responses, write a streaming proxy:

```ts
app.all("/api/*", async (c) => {
    const resp = await fetch(targetUrl);
    return new Response(resp.body, {
        status: resp.status,
        headers: {
            "Content-Type": resp.headers.get("Content-Type") ?? "application/octet-stream",
        },
    });
});
```

`resp.body` is a `ReadableStream`. Returning it directly streams bytes without buffering. But you lose the size-limit guard — only do this if you trust the upstream.

## The size limit lives in two places

The framework enforces `MAX_RESPONSE_SIZE = 10 * 1024 * 1024` (10 MB) in two paths:

1. **Runtime** (`registerProxyRoutes`): checks `Content-Length` header first, then `body.byteLength` after fetch
2. **Generated code** (`generateProxyCode`): the inlined version for serverless emits the same two checks

If you change the limit in one place, change both. The test `generated proxy code embeds the same response size limit as runtime (parity)` enforces this.

## Why `Content-Length` and `byteLength` both

`Content-Length` is what the upstream **claims**. `byteLength` is what actually arrived. Some upstreams send `Content-Length: 1000` but stream 10MB. Some omit `Content-Length` entirely.

The double check covers both:

- Fast-reject on declared `Content-Length` to avoid downloading 100MB just to reject it
- Final reject on actual bytes received in case `Content-Length` was missing or lying

## Related

- [Chapter 9: Server & deployment — proxy routes](../09-server-and-deployment.md#proxy-routes)
- The actual implementation: `packages/server/src/proxy.ts`
- The regression test: `packages/server/test/proxy.test.ts`
