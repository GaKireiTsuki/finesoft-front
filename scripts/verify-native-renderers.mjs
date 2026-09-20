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
if (!process.env.NATIVE_FIX_ONLY)
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
    server: {
        port: 5197,
        host: "127.0.0.1",
        fs: { allow: [root] },
        // Static fixture builds are outputs, not dev inputs. Their writes must not trigger HMR.
        watch: { ignored: [root + "reports/**"] },
    },
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
for (const ui of process.env.NATIVE_ERRORS_ONLY || process.env.NATIVE_FIX_ONLY
    ? []
    : ["react", "vue", "svelte"]) {
    const output = root + "reports/native-renderers/static/" + ui;
    await build({
        configFile: false,
        root: root + "packages/front",
        plugins: [react(), vue(), svelte({ configFile: false })],
        ssr: { noExternal: true },
        build: {
            ssr: root + "packages/front" + fixture + ui + "-static-root.ts",
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
        buildId: "native-" + ui,
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
        const ui = url.searchParams.get("ui") ?? "react";
        const renderMode = url.searchParams.get("render") ?? "ssr";
        let html;
        if (renderMode === "prerender")
            html = await fs.readFile(
                root +
                    "reports/native-renderers/static/" +
                    ui +
                    "/dist/prerender/static/index.html",
                "utf8",
            );
        else {
            const mod = await server.ssrLoadModule(fixture + ui + "-server.ts");
            const result = await mod.render(
                url.searchParams.get("route") ?? (renderMode === "csr" ? "/csr" : "/"),
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
    for (const ui of process.env.NATIVE_ERRORS_ONLY || process.env.NATIVE_FIX_ONLY
        ? []
        : ["react", "vue", "svelte"])
        for (const renderMode of ["ssr", "csr", "prerender"]) {
            const page = await browser.newPage();
            const errors = [];
            const navigations = [];
            page.on("framenavigated", (frame) => {
                if (frame === page.mainFrame())
                    navigations.push({ time: Date.now(), url: frame.url() });
            });
            page.on("pageerror", (e) => errors.push(String(e)));
            page.on("console", (m) => {
                if (m.type() === "error") errors.push(m.text());
            });
            const response = await page.goto(
                "http://127.0.0.1:5197/probe?ui=" + ui + "&render=" + renderMode,
            );
            const html = await response.text();
            const wire = html.match(
                /<script data-fs-server-data type="application\/json">(.*?)<\/script>/s,
            );
            assert.equal(!!wire, renderMode !== "csr");
            if (renderMode !== "csr") assert.match(html, /data-context-locale="en"/);
            const prefetch = wire ? JSON.parse(wire[1]) : undefined;
            await page.waitForFunction(() => globalThis.ready === true);
            if (prefetch)
                assert.equal(
                    await page.evaluate(() => globalThis.apps.a.getSnapshot().entries[0].entryId),
                    prefetch.payload.pages.find((item) => item.intent.id === "probe").entryId,
                );
            assert.equal(await page.locator("#a h1").innerText(), "first 1");
            assert.equal(await page.locator("#b h1").innerText(), "second 1");
            assert.equal(
                await page
                    .locator("#a [data-fs-entry]:not([hidden]) [data-context-locale]")
                    .getAttribute("data-context-locale"),
                "en",
            );
            assert.equal(
                await page
                    .locator("#b [data-fs-entry]:not([hidden]) [data-context-locale]")
                    .getAttribute("data-context-locale"),
                "ar",
            );
            await page.locator("#a [data-context-update]").click();
            await page
                .waitForFunction(
                    () =>
                        document
                            .querySelector("#a [data-fs-entry]:not([hidden]) [data-context-locale]")
                            ?.getAttribute("data-context-locale") === "en:updated",
                )
                .catch(async (error) => {
                    console.error("Context update failed", {
                        ui,
                        renderMode,
                        navigations,
                        errors,
                        state: await page.evaluate(() => ({
                            ready: globalThis.ready,
                            locale: document.querySelector(
                                "#a [data-fs-entry]:not([hidden]) [data-context-locale]",
                            )?.outerHTML,
                            button: document.querySelector("#a [data-context-update]")?.outerHTML,
                        })),
                    });
                    throw error;
                });
            await page.evaluate(async () => {
                await globalThis.apps.a.navigation.push("other");
            });
            await page.waitForFunction(
                () => globalThis.apps.a.getSnapshot().entries.at(-1)?.page.title === "Other",
            );
            assert.equal(
                await page
                    .locator("#a [data-fs-entry]:not([hidden]) [data-context-locale]")
                    .getAttribute("data-context-locale"),
                "en:updated",
            );
            await page.evaluate(async () => {
                await globalThis.apps.a.navigation.pop();
            });
            await page.waitForFunction(
                () => globalThis.apps.a.getSnapshot().entries.at(-1)?.page.title === "first 1",
            );
            assert.equal(
                await page
                    .locator("#a [data-fs-entry]:not([hidden]) [data-context-locale]")
                    .getAttribute("data-context-locale"),
                "en:updated",
            );
            await page.locator("#a input").fill("alpha");
            await page.locator("#b input").fill("beta");
            await page.evaluate(() => {
                globalThis.inputA = document.querySelector("#a input");
            });
            await page.evaluate(async () => {
                await globalThis.apps.a.navigation.refresh();
            });
            assert.equal(await page.locator("#a input").inputValue(), "alpha");
            assert.equal(
                await page.evaluate(() => globalThis.inputA === document.querySelector("#a input")),
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
                await globalThis.apps.b.navigation.refresh();
            });
            assert.equal(await page.locator("#a input").inputValue(), "alpha");
            assert.equal(await page.locator("#b input").inputValue(), "beta");
            assert.equal(await page.locator("#a span").innerText(), "alpha");
            await page.evaluate(async () => {
                await globalThis.apps.a.navigation.refresh();
            });
            assert.equal(await page.locator("#a input").inputValue(), "alpha");
            await page.reload();
            await page.waitForFunction(() => globalThis.ready === true);
            assert.equal(await page.locator("#a input").inputValue(), "alpha");
            assert.equal(await page.locator("#b input").inputValue(), "beta");
            const linkChecks = await page.evaluate(() => {
                const rootA = document.getElementById("a");
                const rootB = document.getElementById("b");
                if (!rootA || !rootB) throw Error("native link roots missing");
                const nested = document.createElement("div");
                nested.id = "native-link-probes";
                rootB.append(nested);
                const add = (parent, id, href, attributes = {}) => {
                    const anchor = document.createElement("a");
                    anchor.id = id;
                    anchor.href = href;
                    Object.assign(anchor, attributes);
                    anchor.textContent = id;
                    parent.append(anchor);
                    return anchor;
                };
                const ignored = [
                    ["meta", "/other", { metaKey: true }],
                    ["ctrl", "/other", { ctrlKey: true }],
                    ["shift", "/other", { shiftKey: true }],
                    ["alt", "/other", { altKey: true }],
                    ["button", "/other", { button: 1 }],
                    ["download", "/other", {}, { download: "" }],
                    ["blank", "/other", {}, { target: "_blank" }],
                    ["external-origin", "https://example.invalid/other"],
                    ["external-rel", "/other", {}, { rel: "external" }],
                    ["hash", location.pathname + location.search + "#native-link"],
                ];
                const observed = [];
                for (const [index, item] of ignored.entries()) {
                    const [id, href, init = {}, attributes = {}] = item;
                    const anchor = add(nested, id, href, attributes);
                    let appPrevented;
                    const guard = (event) => {
                        appPrevented = event.defaultPrevented;
                        event.preventDefault();
                    };
                    document.addEventListener("click", guard);
                    anchor.dispatchEvent(
                        new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
                    );
                    document.removeEventListener("click", guard);
                    observed.push({ id, appPrevented, order: index });
                }
                const plain = add(rootA, "plain-same-origin", "/other");
                const event = new MouseEvent("click", { bubbles: true, cancelable: true });
                plain.dispatchEvent(event);
                return { ignored: observed, plainPrevented: event.defaultPrevented };
            });
            assert.deepEqual(
                linkChecks.ignored.map(({ id, appPrevented }) => [id, appPrevented]),
                [
                    ["meta", false],
                    ["ctrl", false],
                    ["shift", false],
                    ["alt", false],
                    ["button", false],
                    ["download", false],
                    ["blank", false],
                    ["external-origin", false],
                    ["external-rel", false],
                    ["hash", false],
                ],
            );
            assert.equal(linkChecks.plainPrevented, true);
            await page.waitForFunction(
                () => globalThis.apps.a.getSnapshot().entries.at(-1)?.page.title === "Other",
            );
            assert.equal(await page.locator("#a h1:visible").innerText(), "Other");
            assert.equal(await page.locator("#a input:visible").inputValue(), "");
            assert.equal(
                await page.locator("#a [data-fs-entry][hidden] input").inputValue(),
                "alpha",
            );
            await page.evaluate(() => globalThis.apps.a.navigation.pop());
            assert.equal(await page.locator("#a input:visible").inputValue(), "alpha");
            assert.equal(
                await page
                    .locator("#b [data-fs-entry]:not([hidden]) [data-context-locale]")
                    .getAttribute("data-context-locale"),
                "ar",
            );
            await page.evaluate(async () => {
                globalThis.previousInput = document.querySelector("#b input");
                globalThis.setType(globalThis.apps.b, "other");
                await globalThis.apps.b.navigation.refresh();
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
                globalThis.owner = await globalThis.mount(c, "native-c", "en", "owner", "browser");
                try {
                    await globalThis.mount(d, "native-d", "en", "owner2", "browser");
                    throw Error("competing owner accepted");
                } catch (error) {
                    if (!String(error).includes("history already owned")) throw error;
                }
                globalThis.ownerEntry = globalThis.owner.getSnapshot().entries[0].entryId;
                await globalThis.owner.navigation.navigate("/other");
            });
            assert.equal(await page.locator("#c h1:visible").innerText(), "Other");
            await page.goBack();
            await page.waitForFunction(
                () =>
                    globalThis.owner.getSnapshot().entries.at(-1)?.entryId ===
                    globalThis.ownerEntry,
            );
            assert.match(await page.locator("#c h1:visible").innerText(), /^owner \d+$/);
            await page.screenshot({
                path: root + "reports/native-renderers/" + ui + "-" + renderMode + ".png",
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
            const afterDispose = await page.evaluate(() => {
                const root = document.getElementById("a");
                if (!root) throw Error("disposed native root missing");
                const anchor = document.createElement("a");
                anchor.href = "/";
                anchor.textContent = "after-dispose";
                root.append(anchor);
                let appPrevented;
                const guard = (event) => {
                    appPrevented = event.defaultPrevented;
                    event.preventDefault();
                };
                document.addEventListener("click", guard);
                anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                document.removeEventListener("click", guard);
                return { appPrevented, path: location.pathname };
            });
            assert.equal(afterDispose.appPrevented, false);
            if (ui === "react" && renderMode === "ssr") {
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
            results.push({ ui, renderMode, status: "passed" });
            console.log(ui, renderMode, "passed");
            await page.close();
        }
    if (!process.env.NATIVE_ERRORS_ONLY && !process.env.NATIVE_FIX_ONLY) {
        const structured = await browser.newPage();
        const structuredErrors = [];
        structured.on("pageerror", (error) => structuredErrors.push(String(error)));
        await structured.goto("http://127.0.0.1:5197/probe?ui=svelte&structured=1");
        await structured.waitForFunction(() => globalThis.ready === true);
        assert.equal(await structured.locator("#a input:visible").count(), 2);
        await structured.locator("#a input:visible").nth(0).fill("left-draft");
        await structured.locator("#a input:visible").nth(1).fill("right-draft");
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
        assert.equal(
            await structured.locator("#a input:visible").nth(0).inputValue(),
            "left-draft",
        );
        assert.equal(await structured.locator("#a input:visible").nth(1).inputValue(), "");
        assert.equal(await structured.locator("#a input").count(), 3);
        await structured.evaluate(async () => {
            await globalThis.apps.a.navigation.pop();
        });
        assert.equal(await structured.locator("#a input").count(), 2);
        assert.equal(
            await structured.locator("#a input:visible").nth(1).inputValue(),
            "right-draft",
        );
        await structured.evaluate(async () => {
            await globalThis.apps.a.navigation.selectTab("notes");
        });
        assert.equal(await structured.locator("#a input:visible").count(), 1);
        assert.equal(await structured.locator("#a input").count(), 3);
        await structured.evaluate(async () => {
            await globalThis.apps.a.navigation.selectTab("workspace");
        });
        assert.deepEqual(
            await structured
                .locator("#a input:visible")
                .evaluateAll((inputs) => inputs.map((input) => input.value)),
            ["left-draft", "right-draft"],
        );
        await structured.evaluate(async () => {
            await globalThis.apps.a.session.save();
        });
        await structured.reload();
        await structured.waitForFunction(() => globalThis.ready === true);
        assert.equal(await structured.locator("#a input:visible").count(), 2);
        assert.deepEqual(
            await structured
                .locator("#a input:visible")
                .evaluateAll((inputs) => inputs.map((input) => input.value)),
            ["left-draft", "right-draft"],
        );
        await structured.evaluate(async () => {
            await globalThis.apps.a.navigation.refresh();
        });
        assert.deepEqual(await structured.locator("#a span:visible").allTextContents(), [
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
            structure: "Tabs/Split/nested Stack",
            status: "passed",
        });
        console.log("Svelte Tabs/Split/nested Stack passed");
        await structured.close();
    }
    for (const ui of ["react", "vue", "svelte"]) {
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        const response = await page.goto(
            "http://127.0.0.1:5197/probe?ui=" + ui + "&route=/missing",
        );
        assert.equal(response.status(), 404);
        const html = await response.text();
        assert.match(html, /404/);
        assert.match(html, /data-snapshot-title="404/);
        await page.waitForFunction(() => globalThis.ready === true);
        assert.match(await page.locator("#a h1").last().innerText(), /404/);
        assert.match(
            await page
                .locator("#b [data-snapshot-title]")
                .last()
                .getAttribute("data-snapshot-title"),
            /404/,
        );
        assert.match(
            await page
                .locator("#a [data-snapshot-title]")
                .last()
                .getAttribute("data-snapshot-title"),
            /404/,
        );
        await page.evaluate(async () => {
            await globalThis.apps.a.navigation.navigate("/");
        });
        assert.match(await page.locator("#a h1").last().innerText(), /first/);
        await page.evaluate(async () => {
            const app = globalThis.apps.a;
            globalThis.beforeDenied = app.getSnapshot();
            globalThis.setGuard(app, (ctx) =>
                ctx.path === "/other"
                    ? { kind: "deny", status: 403, message: "blocked" }
                    : { kind: "next" },
            );
            try {
                await app.navigation.navigate("/other");
            } catch (error) {
                if (!String(error).includes("Navigation was not committed")) throw error;
            }
            if (app.getSnapshot() !== globalThis.beforeDenied)
                throw Error("rejected candidate committed");
        });
        assert.match(await page.locator("#a h1").last().innerText(), /first/);
        const redirected = await page.evaluate(async () => {
            const app = globalThis.apps.a;
            let release;
            globalThis.nativeGate = new Promise((resolve) => (release = resolve));
            globalThis.setGuard(app, (ctx) =>
                ctx.path === "/redirect"
                    ? { kind: "redirect", url: "/slow", status: 302 }
                    : { kind: "next" },
            );
            let settled = false;
            const work = app.navigation.navigate("/redirect").then(() => {
                settled = true;
            });
            await new Promise((resolve) => setTimeout(resolve, 30));
            const beforeRelease = settled;
            release();
            await work;
            return {
                beforeRelease,
                title: [...document.querySelectorAll("#a h1")].at(-1).textContent,
                snapshot: app.getSnapshot().entries.at(-1).page.title,
            };
        });
        assert.deepEqual(redirected, {
            beforeRelease: false,
            title: "Slow target",
            snapshot: "Slow target",
        });
        await page.evaluate(async () => {
            await globalThis.apps.a.dispose();
            await globalThis.apps.b.dispose();
        });
        assert.equal(await page.locator("input").count(), 0);
        assert.deepEqual(errors, []);
        console.log(ui, "initial404/rejected-navigation/redirect-ready passed");
        results.push({
            ui,
            initial404: true,
            snapshotAligned: true,
            redirectAwaitedNativeReady: true,
            rejectedNavigationPreserved: true,
            status: "passed",
        });
        await page.close();
    }
    if (process.env.NATIVE_FIX_ONLY)
        for (const ui of ["react", "vue", "svelte"]) {
            const page = await browser.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(String(error)));
            await page.goto("http://127.0.0.1:5197/probe?ui=" + ui);
            await page.waitForFunction(() => globalThis.ready === true);
            await page.locator("#b input").fill("previous-view-draft");
            await page.evaluate(async () => {
                const app = globalThis.apps.b;
                const id = app.getSnapshot().entries[0].entryId;
                app.session.scope.set(id, { ...app.session.scope.get(id), business: "keep" });
                await app.session.save();
                globalThis.setType(app, "other");
                await app.navigation.refresh();
                const bag = app.session.scope.get(id);
                if (bag.business !== "keep" || bag.__dom)
                    throw Error("root reset must clear only DOM state");
                await app.session.save();
                await app.dispose();
                globalThis.apps.b = await globalThis.mount(
                    document.getElementById("b"),
                    "native-b",
                    "ar",
                    "second",
                    "memory",
                    "other",
                );
            });
            assert.equal(await page.locator("#b input").inputValue(), "");
            assert.equal(await page.locator("#b span").innerText(), "");
            assert.equal(
                await page
                    .locator("#b [data-fs-entry]:not([hidden]) [data-context-locale]")
                    .getAttribute("data-context-locale"),
                "ar",
            );
            await page.evaluate(() => globalThis.apps.b.navigation.refresh());
            assert.equal(await page.locator("#b input").inputValue(), "");
            assert.equal(await page.locator("#b span").innerText(), "");
            assert.equal(
                await page
                    .locator("#b [data-fs-entry]:not([hidden]) [data-context-locale]")
                    .getAttribute("data-context-locale"),
                "ar",
            );
            await page.evaluate(async () => {
                await globalThis.apps.a.dispose();
                await globalThis.apps.b.dispose();
            });
            assert.deepEqual(errors, []);
            await page.close();
            results.push({ ui, resetSaveRemount: true, status: "passed" });
            console.log(ui, "native reset/save/remount passed");
        }
} catch (error) {
    for (const context of browser.contexts())
        for (const page of context.pages())
            console.error("Native browser failure", {
                url: page.url(),
                overlay: await page
                    .locator("vite-error-overlay")
                    .evaluateAll((elements) =>
                        elements.map((element) => element.shadowRoot?.textContent),
                    ),
            });
    throw error;
} finally {
    await browser.close();
    await server.close();
    await fs.mkdir(root + "reports/native-renderers", { recursive: true });
    await fs.writeFile(
        root +
            "reports/native-renderers/" +
            (process.env.NATIVE_FIX_ONLY
                ? "fix-results.json"
                : process.env.NATIVE_ERRORS_ONLY
                  ? "errors-results.json"
                  : "results.json"),
        JSON.stringify(results, null, 2),
    );
}
