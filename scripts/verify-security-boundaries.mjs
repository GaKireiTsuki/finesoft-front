/** Compare repaired boundaries with the untouched pre-fix worktree using built code. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline =
    process.env.FINESOFT_SECURITY_BASELINE_ROOT ??
    path.resolve(root, "../framework-security-baseline");
const output = path.join(root, "reports/framework-security");
await fs.mkdir(output, { recursive: true });
const nativeFetch = globalThis.fetch;
let internalHits = 0;
const internal = createServer((_request, response) => {
    internalHits++;
    response.end("test-internal-secret");
});
await new Promise((resolve) => internal.listen(0, "127.0.0.1", resolve));
const internalUrl = `http://127.0.0.1:${internal.address().port}/secret`;
const upstream = createServer((request, response) => {
    if (request.url === "/private") {
        response.writeHead(302, { location: internalUrl });
        response.end();
    } else if (request.url === "/public") {
        response.writeHead(302, { location: "https://public.test/ok" });
        response.end();
    } else response.end("public-ok");
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
function importBuilt(directory, packageName, entry = "index") {
    return import(
        pathToFileURL(path.join(directory, "packages", packageName, "dist", `${entry}.mjs`))
    );
}
function proxyHandler(register, config) {
    let handler;
    register(
        {
            all: (_path, value) => {
                handler = value;
            },
        },
        [config],
    );
    return (suffix) =>
        handler({
            req: { path: "/proxy" + suffix, url: "https://app.test/proxy" + suffix },
            text: (body, status) => new Response(body, { status }),
            json: (body, status) => Response.json(body, { status }),
            newResponse: (body, status, headers) => new Response(body, { status, headers }),
        });
}
try {
    for (const [version, directory] of [
        ["baseline", baseline],
        ["current", root],
    ]) {
        const core = await importBuilt(directory, "core");
        const web = await importBuilt(directory, "web");
        const ssr = await importBuilt(directory, "ssr");
        const server = await importBuilt(directory, "server", "ssr");
        const result = { version, locale: [] };
        for (const mode of ["ssr", "csr"]) {
            for (const field of ["lang", "dir"]) {
                const page = await browser.newPage();
                const payload =
                    'en"><script>globalThis.__localeAttack=1</script><html data-payload="';
                const locale = { lang: "en-US", dir: "ltr", [field]: payload };
                const template =
                    "<!doctype html><html><head></head><body><!--ssr-body--></body></html>";
                const html =
                    mode === "csr"
                        ? ssr.injectCSRShell(template, locale)
                        : ssr.injectSSRContent({
                              template,
                              locale,
                              html: "<main>safe</main>",
                              head: "",
                              css: "",
                              serializedData: "{}",
                          });
                await page.setContent(html);
                const state = await page.evaluate(
                    (name) => ({
                        executed: globalThis.__localeAttack === 1,
                        attribute: document.documentElement.getAttribute(name),
                    }),
                    field,
                );
                assert.equal(state.executed, version === "baseline");
                if (version === "current") assert.equal(state.attribute, payload);
                result.locale.push({ mode, field, ...state });
                await page.close();
            }
        }
        const routedFetch = async (input, init) => {
            const original = typeof input === "string" ? input : (input.url ?? input.href);
            const url = new URL(original);
            const mapped = url.hostname === "public.test" ? upstreamUrl + url.pathname : original;
            const response = await nativeFetch(mapped, init);
            if (!response.redirected) Object.defineProperty(response, "url", { value: original });
            return response;
        };
        const safe = core.secureFetch(routedFetch, { validateDns: false });
        const hitsBefore = internalHits;
        try {
            result.protectedRedirect = await (await safe("https://public.test/private")).text();
        } catch (error) {
            result.protectedRedirect = error.name;
        }
        result.internalHits = internalHits - hitsBefore;
        assert.equal(result.internalHits, version === "baseline" ? 1 : 0);
        assert.equal(await (await safe("https://public.test/ok")).text(), "public-ok");
        if (version === "current")
            assert.equal(await (await safe("https://public.test/public")).text(), "public-ok");
        result.legitimateFetch = "public-ok";

        const proxy = proxyHandler(server.registerProxyRoutes, {
            prefix: "/proxy",
            target: upstreamUrl,
            followRedirects: true,
        });
        const response = await proxy("/private");
        result.proxyRedirect = { status: response.status, body: await response.text() };
        assert.equal(response.status, version === "baseline" ? 200 : 502);

        let chunks = 0;
        let cancelled = false;
        globalThis.fetch = async () =>
            new Response(
                new ReadableStream(
                    {
                        pull(controller) {
                            controller.enqueue(new Uint8Array(1024 * 1024));
                            if (++chunks === 32) controller.close();
                        },
                        cancel() {
                            cancelled = true;
                        },
                    },
                    { highWaterMark: 0 },
                ),
            );
        const large = proxyHandler(server.registerProxyRoutes, {
            prefix: "/proxy",
            target: "https://upstream.test",
        });
        assert.equal((await large("/large")).status, 502);
        result.streamLimit = { chunks, cancelled };
        assert.equal(chunks, version === "baseline" ? 32 : 11);
        assert.equal(cancelled, version === "current");
        globalThis.fetch = nativeFetch;

        const tree = {
            kind: "tabs",
            active: "__proto__",
            order: ["__proto__"],
            branches: {
                ["__proto__"]: { kind: "leaf", intent: "home", params: {}, entryId: "safe-home" },
            },
        };
        const decoded = web.deserializeNavigation(JSON.parse(JSON.stringify(tree)));
        result.ownedBranch = Object.hasOwn(decoded.branches, "__proto__");
        assert.equal(result.ownedBranch, version === "current");

        const fixture = path.join(directory, "adversarial/target-app");
        const child = `import {pathToFileURL} from 'node:url'; const {render} = await import(pathToFileURL(process.cwd() + '/dist/server/ssr.js')); try { const bad=await render('/search?q=../../package'); const good=await render('/search'); console.log(JSON.stringify({traversalExposed:bad.html.includes('adversarial-target-app'),legitimate:good.html.includes('Parsed query:')})); } finally {await render.dispose();}`;
        result.search = JSON.parse(
            execFileSync("vp", ["exec", "node", "--input-type=module", "-e", child], {
                cwd: fixture,
                encoding: "utf8",
            }).trim(),
        );
        assert.equal(result.search.traversalExposed, version === "baseline");
        assert.equal(result.search.legitimate, true);
        results.push(result);
    }
} finally {
    globalThis.fetch = nativeFetch;
    await browser.close();
    for (const server of [upstream, internal]) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}
await fs.writeFile(
    path.join(output, "boundary-reproduction.json"),
    JSON.stringify({ node: process.version, baseline, current: root, results }, null, 2) + "\n",
);
console.log(JSON.stringify(results, null, 2));
