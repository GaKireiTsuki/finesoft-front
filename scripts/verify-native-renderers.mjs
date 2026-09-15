import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer, build } from "vite-plus";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import nodeFs from "node:fs";
import nodePath from "node:path";
const root = new URL("../", import.meta.url).pathname;
const requireAt = (name) => createRequire(root + "templates/" + name + "/package.json");
const react = (await import(pathToFileURL(requireAt("react").resolve("@vitejs/plugin-react"))))
    .default;
const vue = (await import(pathToFileURL(requireAt("vue").resolve("@vitejs/plugin-vue")))).default;
const { svelte } = await import(
    pathToFileURL(requireAt("svelte").resolve("@sveltejs/vite-plugin-svelte"))
);
await build({
    configFile: false,
    root,
    build: {
        lib: {
            entry: root + "adversarial/runtime-app/src/browser-worker.ts",
            formats: ["es"],
            fileName: "worker",
        },
        outDir: root + "reports/native-renderers/worker",
        emptyOutDir: true,
    },
});
const fixture = "/test/native-app/";
const server = await createServer({
    configFile: false,
    root: root + "packages/front",
    optimizeDeps: {
        force: true,
        include: [
            "react",
            "react-dom",
            "react-dom/client",
            "react/jsx-dev-runtime",
            "vue",
            "svelte",
            "svelte/store",
        ],
    },
    plugins: [react(), vue(), svelte({ configFile: false })],
    server: { port: 5197, host: "127.0.0.1", fs: { allow: [root] } },
    appType: "custom",
});
const template = (ui) =>
    '<html lang="en"><head><link rel="icon" href="data:,"><!--ssr-head--></head><body><div id="a"><!--ssr-body--><!--ssr-data--></div><div id="b"></div><script type="module" src="' +
    fixture +
    ui +
    '-browser.ts"></script></body></html>';
const { prerenderRoutes } = await server.ssrLoadModule(
    root + "packages/server/src/adapters/shared.ts",
);
const { injectSSRContent, injectCSRShell } = await server.ssrLoadModule(
    root + "packages/ssr/src/inject.ts",
);
for (const ui of process.env.NATIVE_ERRORS_ONLY ? [] : ["react", "vue", "svelte"])
    for (const mode of ["root", "entries"]) {
        const output = root + "reports/native-renderers/static/" + ui + "-" + mode;
        await build({
            configFile: false,
            root: root + "packages/front",
            plugins: [react(), vue(), svelte({ configFile: false })],
            ssr: { noExternal: true },
            build: {
                ssr: root + "packages/front" + fixture + ui + "-static-" + mode + ".ts",
                outDir: output + "/dist/server",
                rollupOptions: { output: { entryFileNames: "ssr.js" } },
            },
        });
        const pages = await prerenderRoutes({
            root: output,
            fs: nodeFs,
            path: nodePath,
            vite: { build },
            templateHtml: template(ui),
            buildId: "native-" + ui + "-" + mode,
        });
        assert.deepEqual(
            pages.map((page) => page.url),
            ["/static"],
        );
        await fs.mkdir(output + "/dist/prerender/static", { recursive: true });
        await fs.writeFile(output + "/dist/prerender/static/index.html", pages[0].html);
    }
server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/probe")) return next();
    try {
        const url = new URL(req.url, "http://localhost");
        const ui = url.searchParams.get("ui") ?? "react",
            mode = url.searchParams.get("mode") ?? "root";
        const renderMode = url.searchParams.get("render") ?? "ssr";
        let html;
        if (renderMode === "prerender")
            html = await fs.readFile(
                root +
                    "reports/native-renderers/static/" +
                    ui +
                    "-" +
                    mode +
                    "/dist/prerender/static/index.html",
                "utf8",
            );
        else {
            const mod = await server.ssrLoadModule(fixture + ui + "-server.ts");
            const result = await mod.render(
                url.searchParams.get("route") ?? (renderMode === "csr" ? "/csr" : "/"),
                mode,
                url.searchParams.has("structured"),
            );
            res.statusCode = result.status ?? 200;
            html =
                result.renderMode === "csr"
                    ? injectCSRShell(template(ui))
                    : injectSSRContent({
                          ...result,
                          template: template(ui),
                          serializedData: result.serialized,
                      });
        }
        res.setHeader("content-type", "text/html");
        res.end(await server.transformIndexHtml(req.url, html));
    } catch (error) {
        res.statusCode = 500;
        res.end(String(error));
        console.error(error);
    }
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
await server.listen();
const results = [];
try {
    for (const ui of ["react", "vue", "svelte"])
        for (const mode of ["root", "entries"])
            for (const renderMode of ["ssr", "csr", "prerender"]) {
                const page = await browser.newPage();
                const errors = [];
                page.on("pageerror", (e) => errors.push(String(e)));
                page.on("console", (m) => {
                    if (m.type() === "error") errors.push(m.text());
                });
                const response = await page.goto(
                    "http://127.0.0.1:5197/probe?ui=" +
                        ui +
                        "&mode=" +
                        mode +
                        "&render=" +
                        renderMode,
                );
                const html = await response.text();
                const wire = html.match(
                    /<script data-fs-server-data type="application\/json">(.*?)<\/script>/s,
                );
                assert.equal(!!wire, renderMode !== "csr");
                const prefetch = wire ? JSON.parse(wire[1]) : undefined;
                await page.waitForFunction(() => globalThis.ready === true);
                if (prefetch)
                    assert.equal(
                        await page.evaluate(
                            () => globalThis.apps.a.getSnapshot().destinations[0].entryId,
                        ),
                        prefetch.payload.find((item) => item.intent.id === "probe").entryId,
                    );
                assert.equal(await page.locator("#a h1").innerText(), "first 1");
                assert.equal(await page.locator("#b h1").innerText(), "second 1");
                await page.locator("#a input").fill("alpha");
                await page.locator("#b input").fill("beta");
                await page.evaluate(() => {
                    globalThis.inputA = document.querySelector("#a input");
                });
                await page.evaluate(async () => {
                    await globalThis.apps.a.refresh();
                });
                assert.equal(await page.locator("#a input").inputValue(), "alpha");
                assert.equal(
                    await page.evaluate(
                        () => globalThis.inputA === document.querySelector("#a input"),
                    ),
                    true,
                );
                await page.evaluate(async () => {
                    await globalThis.apps.a.session.save();
                    await globalThis.apps.b.session.save();
                });
                assert.equal(await page.locator("#a").getAttribute("lang"), "en");
                assert.equal(await page.locator("#b").getAttribute("lang"), "ar");
                await page.evaluate(async () => {
                    await globalThis.apps.a.dispose();
                    globalThis.apps.a = await globalThis.mount(
                        document.getElementById("a"),
                        "native-a",
                    );
                    await globalThis.apps.b.refresh();
                });
                assert.equal(await page.locator("#a input").inputValue(), "alpha");
                assert.equal(await page.locator("#b input").inputValue(), "beta");
                assert.equal(await page.locator("#a span").innerText(), "alpha");
                await page.evaluate(async () => {
                    await globalThis.apps.a.refresh();
                });
                assert.equal(await page.locator("#a input").inputValue(), "alpha");
                await page.reload();
                await page.waitForFunction(() => globalThis.ready === true);
                assert.equal(await page.locator("#a input").inputValue(), "alpha");
                assert.equal(await page.locator("#b input").inputValue(), "beta");
                await page.evaluate(async () => {
                    await globalThis.apps.a.navigate("/other");
                });
                assert.equal(await page.locator("#a h1").innerText(), "Other");
                assert.equal(await page.locator("#a input").inputValue(), "");
                if (mode === "entries") {
                    await page.evaluate(async () => {
                        await globalThis.apps.a.navigation.pop();
                    });
                    assert.equal(await page.locator("#a input").inputValue(), "alpha");
                }
                await page.evaluate(async () => {
                    globalThis.previousInput = document.querySelector("#b input");
                    globalThis.setType(globalThis.apps.b, "other");
                    await globalThis.apps.b.refresh();
                });
                assert.equal(await page.locator("#b input").inputValue(), "");
                assert.equal(
                    await page.evaluate(
                        () => globalThis.previousInput === document.querySelector("#b input"),
                    ),
                    false,
                );
                await page.evaluate(async () => {
                    const c = document.createElement("div");
                    c.id = "c";
                    document.body.append(c);
                    const d = document.createElement("div");
                    d.id = "d";
                    document.body.append(d);
                    globalThis.owner = await globalThis.mount(
                        c,
                        "native-c",
                        "en",
                        "owner",
                        "browser",
                    );
                    try {
                        await globalThis.mount(d, "native-d", "en", "owner2", "browser");
                        throw Error("competing owner accepted");
                    } catch (error) {
                        if (!String(error).includes("history already owned")) throw error;
                    }
                    globalThis.ownerEntry = globalThis.owner.getSnapshot().destinations[0].entryId;
                    await globalThis.owner.navigate("/other");
                });
                await page.goBack();
                await page.waitForFunction(
                    () =>
                        globalThis.owner.getSnapshot().destinations[0]?.entryId ===
                        globalThis.ownerEntry,
                );
                await page.screenshot({
                    path:
                        root +
                        "reports/native-renderers/" +
                        ui +
                        "-" +
                        mode +
                        "-" +
                        renderMode +
                        ".png",
                });
                await page.evaluate(async () => {
                    await globalThis.owner.dispose();
                    globalThis.owner = await globalThis.mount(
                        document.getElementById("d"),
                        "native-d",
                        "en",
                        "remounted",
                        "browser",
                    );
                    await globalThis.owner.dispose();
                    await globalThis.apps.a.dispose();
                    await globalThis.apps.b.dispose();
                });
                if (ui === "react" && mode === "root" && renderMode === "ssr") {
                    const workerResults = await page.evaluate(
                        async (path) => {
                            const worker = new Worker(path, { type: "module" });
                            const send = (message) =>
                                new Promise((resolve, reject) => {
                                    worker.onmessage = (event) => resolve(event.data);
                                    worker.onerror = reject;
                                    worker.postMessage(message);
                                });
                            try {
                                return [
                                    await send({
                                        protocolVersion: 1,
                                        id: "a",
                                        operation: "inspect",
                                        input: 7,
                                        tenant: "browser-worker",
                                        authorized: true,
                                    }),
                                    await send({
                                        protocolVersion: 1,
                                        id: "b",
                                        operation: "inspect",
                                        input: 7,
                                        tenant: "other",
                                        authorized: false,
                                    }),
                                    await send({ protocolVersion: 9 }),
                                    await send({ protocolVersion: 1, operation: "dispose" }),
                                ];
                            } finally {
                                worker.terminate();
                            }
                        },
                        "/@fs/" + root + "reports/native-renderers/worker/worker.js",
                    );
                    assert.deepEqual(workerResults, [
                        {
                            protocolVersion: 1,
                            id: "a",
                            result: { value: 14, tenant: "browser-worker" },
                            dom: "undefined",
                        },
                        { protocolVersion: 1, id: "b", error: "denied" },
                        { protocolVersion: 1, error: "invalid-message" },
                        { protocolVersion: 1, operation: "disposed" },
                    ]);
                    results.push({ worker: "bundled browser module", status: "passed" });
                }

                assert.equal(await page.locator("input").count(), 0);
                assert.deepEqual(errors, []);
                results.push({ ui, mode, renderMode, status: "passed" });
                console.log(ui, mode, renderMode, "passed");
                await page.close();
            }
    if (!process.env.NATIVE_ERRORS_ONLY) {
        const structured = await browser.newPage();
        const structuredErrors = [];
        structured.on("pageerror", (error) => structuredErrors.push(String(error)));
        await structured.goto("http://127.0.0.1:5197/probe?ui=svelte&mode=entries&structured=1");
        await structured.waitForFunction(() => globalThis.ready === true);
        assert.equal(await structured.locator("#a input").count(), 2);
        await structured.locator("#a input").nth(0).fill("left-draft");
        await structured.locator("#a input").nth(1).fill("right-draft");
        await structured.evaluate(async () => {
            await globalThis.apps.a.navigation.push(
                "other",
                {},
                {
                    target: [
                        { kind: "tab", key: "workspace" },
                        { kind: "column", id: "right" },
                    ],
                },
            );
        });
        assert.equal(await structured.locator("#a input").nth(0).inputValue(), "left-draft");
        assert.equal(await structured.locator("#a input").nth(1).inputValue(), "");
        await structured.evaluate(async () => {
            await globalThis.apps.a.navigation.pop();
        });
        assert.equal(await structured.locator("#a input").nth(1).inputValue(), "right-draft");
        await structured.evaluate(async () => {
            await globalThis.apps.a.navigation.selectTab("notes");
        });
        assert.equal(await structured.locator("#a input").count(), 1);
        await structured.evaluate(async () => {
            await globalThis.apps.a.navigation.selectTab("workspace");
        });
        assert.deepEqual(
            await structured
                .locator("#a input")
                .evaluateAll((inputs) => inputs.map((input) => input.value)),
            ["left-draft", "right-draft"],
        );
        await structured.evaluate(async () => {
            await globalThis.apps.a.session.save();
        });
        await structured.reload();
        await structured.waitForFunction(() => globalThis.ready === true);
        assert.deepEqual(
            await structured
                .locator("#a input")
                .evaluateAll((inputs) => inputs.map((input) => input.value)),
            ["left-draft", "right-draft"],
        );
        await structured.evaluate(async () => {
            await globalThis.apps.a.refresh();
        });
        assert.deepEqual(await structured.locator("#a span").allTextContents(), [
            "left-draft",
            "right-draft",
        ]);
        await structured.screenshot({
            path: root + "reports/native-renderers/svelte-tabs-split-stacks.png",
        });
        await structured.evaluate(async () => {
            await globalThis.apps.a.dispose();
            await globalThis.apps.b.dispose();
        });
        assert.equal(await structured.locator("input").count(), 0);
        assert.deepEqual(structuredErrors, []);
        results.push({
            ui: "svelte",
            mode: "entries",
            structure: "Tabs/Split/nested Stack",
            status: "passed",
        });
        console.log("Svelte Tabs/Split/nested Stack passed");
        await structured.close();
    }
    for (const ui of ["react", "vue", "svelte"])
        for (const mode of ["root", "entries"]) {
            const page = await browser.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(String(error)));
            const response = await page.goto(
                "http://127.0.0.1:5197/probe?ui=" + ui + "&mode=" + mode + "&route=/missing",
            );
            assert.equal(response.status(), 404);
            const html = await response.text();
            assert.match(html, /404/);
            await page.waitForFunction(() => globalThis.ready === true);
            assert.match(await page.locator("#a h1").innerText(), /404/);
            await page.evaluate(async () => {
                await globalThis.apps.a.navigate("/");
            });
            assert.match(await page.locator("#a h1").innerText(), /first/);
            await page.evaluate(async () => {
                const app = globalThis.apps.a;
                globalThis.beforeDenied = app.getSnapshot();
                app.framework.beforeLoad(() => ({ kind: "deny", status: 403, message: "blocked" }));
                await app.navigate("/other");
                if (app.getSnapshot() !== globalThis.beforeDenied)
                    throw Error("rejected candidate committed");
            });
            assert.match(await page.locator("#a h1").innerText(), /first/);
            await page.evaluate(async () => {
                await globalThis.apps.a.dispose();
                await globalThis.apps.b.dispose();
            });
            assert.equal(await page.locator("input").count(), 0);
            assert.deepEqual(errors, []);
            console.log(ui, mode, "initial404/rejected-navigation passed");
            results.push({
                ui,
                mode,
                initial404: true,
                rejectedNavigationPreserved: true,
                status: "passed",
            });
            await page.close();
        }
} finally {
    await browser.close();
    await server.close();
    await fs.mkdir(root + "reports/native-renderers", { recursive: true });
    await fs.writeFile(
        root +
            "reports/native-renderers/" +
            (process.env.NATIVE_ERRORS_ONLY ? "errors-results.json" : "results.json"),
        JSON.stringify(results, null, 2),
    );
}
