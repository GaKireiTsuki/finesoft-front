import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { finesoftFrontViteConfig, injectSSRContent } from "../packages/front/dist/index-node.mjs";

const root = new URL("../", import.meta.url).pathname;
const requireAt = (name) => createRequire(root + "templates/" + name + "/package.json");
const react = (await import(pathToFileURL(requireAt("react").resolve("@vitejs/plugin-react"))))
    .default;
const vue = (await import(pathToFileURL(requireAt("vue").resolve("@vitejs/plugin-vue")))).default;
const { svelte } = await import(
    pathToFileURL(requireAt("svelte").resolve("@sveltejs/vite-plugin-svelte"))
);
const compiler = finesoftFrontViteConfig({ controllerTypes: false });
const server = await createServer({
    configFile: false,
    root: root + "packages/front",
    cacheDir: root + "reports/external-hydration/vite-cache",
    optimizeDeps: {
        force: true,
        include: ["react", "react-dom/client", "react/jsx-dev-runtime", "vue", "svelte"],
    },
    plugins: [
        {
            name: "finesoft-hydration-fixture",
            enforce: "pre",
            configResolved: (config) => compiler.configResolved(config),
            resolveId(...args) {
                return compiler.resolveId.apply(this, args);
            },
            transform: compiler.transform,
        },
        react(),
        vue(),
        svelte({ configFile: false }),
    ],
    server: { port: 0, host: "127.0.0.1", fs: { allow: [root] } },
    appType: "custom",
});
const { stampHydrationDOM } = await server.ssrLoadModule(root + "packages/ssr/src/hydration.ts");
const samples = [
    {
        name: "normalized-markup",
        html: `<html><head></head><body><div id="app">
        <table><tr><td>&amp; &lt; test</td></tr></table><!--native marker-->
        <svg viewBox="0 0 20 20"><linearGradient id="a"/><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#a"/></svg>
        <textarea>initial &amp; text</textarea><input checked value="&quot;">
        <template><strong>inert</strong></template><style nonce="test">div { color: red }</style>
        <sample-widget upgraded="server"><template shadowrootmode="open"><b>shadow</b></template><span>light DOM</span></sample-widget>
        <script data-fs-server-data type="application/json">{}</script></div></body></html>`,
    },
    ...(await Promise.all(
        process.argv
            .slice(2)
            .map(async (path) => ({ name: path, html: await readFile(path, "utf8") })),
    )),
];
server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/dom-probe?")) return next();
    try {
        const sample =
            samples[Number(new URL(req.url, "http://fixture.local").searchParams.get("index"))];
        // These probes compare captured SSR markup without starting its application or loading its assets.
        const source = sample.html
            .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (tag, attrs) =>
                attrs.includes("data-fs-server-data") ? tag : "",
            )
            .replace(/<link\b[^>]*>/gi, "");
        const times = [];
        let html;
        for (let count = 0; count < 7; count++) {
            const start = performance.now();
            html = stampHydrationDOM(source);
            times.push(performance.now() - start);
        }
        const boot = `<script type="module">
            import { digestHydrationDOM } from '/@fs/${root}packages/browser/src/hydration.ts';
            const target = document.getElementById('app');
            const expected = target.querySelector('script[data-fs-server-data]').getAttribute('data-fs-dom');
            const times = [];
            let actual;
            for (let count = 0; count < 7; count++) {
                const start = performance.now();
                actual = digestHydrationDOM(target);
                times.push(performance.now() - start);
            }
            globalThis.domProbe = { expected, actual, bytes: ${source.length}, nodes: target.querySelectorAll('*').length, serverMedianMs: ${times.sort((a, b) => a - b)[3]}, browserMedianMs: times.sort((a,b)=>a-b)[3] };
        </script>`;
        res.setHeader("content-type", "text/html");
        res.end(html.replace("</body>", boot + "</body>"));
    } catch (error) {
        res.statusCode = 500;
        res.end(String(error));
    }
});
server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/probe?")) return next();
    try {
        const url = new URL(req.url, "http://fixture.local");
        const ui = url.searchParams.get("ui");
        const mode = url.searchParams.get("case");
        assert.ok(["react", "vue", "svelte"].includes(ui));
        assert.ok(
            [
                "clean",
                "attribute",
                "style",
                "text",
                "insert",
                "remove",
                "outside",
                "edited",
                "mismatch",
            ].includes(mode),
        );
        const mod = await server.ssrLoadModule(`/test/native-app/${ui}-server.ts`);
        const result = await mod.render("/");
        // An application mismatch exists before the fingerprint is produced.
        if (mode === "mismatch") result.html = result.html.replace("<h1", '<h1 class="unexpected"');
        const mutation = `<script>
            const originalHeading = document.querySelector('#a h1');
            const originalInput = document.querySelector('#a input');
            window.originalHeading = originalHeading;
            window.originalInput = originalInput;
            const mode = ${JSON.stringify(mode)};
            if (mode === 'attribute' || mode === 'edited') originalHeading.setAttribute('data-arbitrary-tool', 'unexpected');
            if (mode === 'style') originalHeading.style.color = 'red';
            if (mode === 'text') originalHeading.textContent = 'translated text';
            if (mode === 'insert') originalHeading.append(document.createElement('i'));
            if (mode === 'remove') originalHeading.remove();
            if (mode === 'outside') {
                document.head.append(document.createElement('style'));
                document.getElementById('a').setAttribute('data-arbitrary-tool', 'outside');
            }
            if (mode === 'edited') originalInput.value = 'typed before startup';
        </script>`;
        const template = `<html lang="en"><head><link rel="icon" href="data:,"><!--ssr-head--></head><body><div id="a"><!--ssr-body--><!--ssr-data--></div><div id="b"></div>${mutation}<script type="module" src="/test/native-app/${ui}-browser.ts"></script></body></html>`;
        const html = injectSSRContent({ ...result, template, serializedData: result.serialized });
        res.setHeader("content-type", "text/html");
        res.end(await server.transformIndexHtml(req.url, html));
    } catch (error) {
        res.statusCode = 500;
        res.end(String(error));
    }
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const [index, sample] of samples.entries()) {
        const page = await browser.newPage();
        try {
            await page.goto(`${origin}/dom-probe?index=${index}`);
            await page.waitForFunction(() => !!globalThis.domProbe);
            const result = await page.evaluate(() => globalThis.domProbe);
            assert.equal(result.actual, result.expected, sample.name);
            console.log(JSON.stringify({ sample: sample.name, ...result, passed: true }));
        } finally {
            await page.close();
        }
    }
    for (const ui of ["react", "vue", "svelte"]) {
        for (const mode of [
            "clean",
            "attribute",
            "style",
            "text",
            "insert",
            "remove",
            "outside",
            "edited",
            ...(ui === "react" ? ["mismatch"] : []),
        ]) {
            const page = await browser.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
                if (message.type() === "error") errors.push(message.text());
            });
            try {
                await page.goto(`${origin}/probe?ui=${ui}&case=${mode}`);
                await page.waitForFunction(() => globalThis.ready === true);
                const state = await page.evaluate(() => ({
                    shouldHydrate: globalThis.apps.a.shouldHydrate,
                    sameHeading: globalThis.originalHeading === document.querySelector("#a h1"),
                    sameInput: globalThis.originalInput === document.querySelector("#a input"),
                    title: document.querySelector("#a h1").textContent,
                    input: document.querySelector("#a input").value,
                }));
                const recover = ["attribute", "style", "text", "insert", "remove"].includes(mode);
                assert.equal(state.shouldHydrate, !recover);
                assert.equal(state.sameHeading, !recover);
                assert.equal(state.sameInput, !recover);
                assert.equal(state.title, "first 1");
                if (mode === "edited") assert.equal(state.input, "typed before startup");
                if (mode !== "edited" && mode !== "mismatch") assert.deepEqual(errors, []);
                if (mode === "mismatch") assert.ok(errors.some((error) => /hydrat/i.test(error)));
                await page.locator("#a input").fill("works after startup");
                assert.equal(await page.locator("#a span").innerText(), "works after startup");
                console.log(
                    JSON.stringify({
                        ui,
                        mode,
                        ...state,
                        diagnostics: errors.length,
                        passed: true,
                    }),
                );
            } finally {
                await page.close();
            }
        }
    }
} finally {
    await browser.close();
    await server.close();
}
