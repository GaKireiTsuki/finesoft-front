/** Focused real public artifact regressions for the final application-boundary fixes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { createSSRRender } from "../packages/front/dist/ssr.mjs";
import { staticAdapter } from "../packages/front/dist/vite.mjs";
import {
    defineWebApp,
    createWebRuntime,
    createNavigationController,
    createNavigationSessionAdapter,
    createSessionStore,
    leaf,
    stack,
    serializeNavigation,
} from "../packages/front/dist/web.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "reports/application-boundaries/final-fix");
fs.mkdirSync(output, { recursive: true });
const report = {
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    timestamp: new Date().toISOString(),
    node: process.version,
};
const page = (id) => ({ id, pageType: id, title: id });
report.session = [];
for (const mode of ["deny", "redirect", "commit", "redirect-commit"]) {
    const definition = defineWebApp({
        id: "final-session",
        pages: [
            { id: "home", handler: () => page("home"), routes: ["/"] },
            {
                id: "saved",
                handler: () => page("saved"),
                routes: [
                    {
                        path: "/saved",
                        beforeLoad: [
                            () =>
                                mode === "deny"
                                    ? { kind: "deny", status: 403, message: "denied" }
                                    : mode.startsWith("redirect")
                                      ? { kind: "redirect", status: 302, url: "/" }
                                      : { kind: "next" },
                        ],
                    },
                ],
            },
        ],
        getErrorPage: (_, message) => page(message),
    });
    const web = createWebRuntime({ definition });
    const navigation = createNavigationController({
        web,
        initial: stack(leaf("home", {}, { url: "/" })),
        onRedirect:
            mode === "redirect-commit" ? () => stack(leaf("home", {}, { url: "/" })) : undefined,
    });
    await navigation.resolve();
    const original = navigation.getSnapshot();
    let draft = "old";
    const session = createSessionStore({
        storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
        navigation: createNavigationSessionAdapter(navigation),
    });
    session.scope.set("old", "original");
    const oldScope = session.scope;
    session.register({
        key: "editor",
        version: 1,
        capture: () => draft,
        decode: (x) => x,
        restore: (x) => {
            draft = x;
        },
    });
    const result = await session.restore({
        version: 2,
        capturedAt: Date.now(),
        navigation: serializeNavigation(stack(leaf("saved", {}, { url: "/saved" }))),
        slices: { editor: { version: 1, data: "saved" } },
        scoped: { saved: true },
    });
    const committed = mode.endsWith("commit");
    assert.equal(result.status, committed ? "restored" : "failed");
    assert.equal(draft, committed ? "saved" : "old");
    assert.equal(navigation.getSnapshot() === original, !committed);
    assert.equal(session.scope === oldScope, !committed);
    report.session.push({ mode, status: result.status, committed });
    await session.dispose();
    await navigation.dispose();
    await web.dispose();
}
report.ssr = [];
for (const [strategy, createRender] of [["native", createSSRRender]]) {
    let mode = "deny",
        loads = 0,
        disposed = 0;
    const definition = defineWebApp({
        id: "public-ssr-policy",
        pages: [
            {
                id: "home",
                handler: (_params, context) => {
                    loads++;
                    context.onDispose(() => {
                        disposed++;
                    });
                    return page("home");
                },
                routes: [{ path: "/", cache: "public" }],
            },
        ],
        getErrorPage: (_, title) => page(title),
        beforeNavigate: [
            (context) => {
                assert.ok(context.execution.bindings.request instanceof Request);
                return mode === "redirect"
                    ? { kind: "redirect", status: 307, url: "/login" }
                    : { kind: "next" };
            },
        ],
        beforeCommit: [
            () =>
                mode === "deny"
                    ? { kind: "deny", status: 409, message: "draft" }
                    : { kind: "next" },
        ],
    });
    const render = createRender({
        definition,
        render: (app) => ({
            html: app.getSnapshot().entries.at(-1)?.page.title ?? "",
            head: "",
            css: "",
        }),
        resolveLocale: () => ({ lang: "ar", dir: "rtl" }),
    });
    const denied = await render("/", { request: new Request("https://local/") });
    assert.equal(denied.status, 409);
    assert.equal(denied.html, "draft");
    assert.deepEqual(denied.serverData, { tree: undefined, pages: [] });
    assert.equal(denied.cache, undefined);
    assert.deepEqual(denied.locale, { lang: "ar", dir: "rtl" });
    assert.equal(disposed, 1);
    mode = "redirect";
    const redirected = await render("/", { request: new Request("https://local/") });
    assert.deepEqual(redirected.redirect, { url: "/login", status: 307 });
    assert.equal(loads, 1);
    mode = "commit";
    const committed = await render("/", { request: new Request("https://local/") });
    assert.equal(committed.html, "home");
    assert.equal(committed.status, undefined);
    assert.equal(disposed, 2);
    await render.dispose();
    report.ssr.push({
        strategy,
        denied409NoDataNoCache: true,
        redirect307: true,
        locale: true,
        committed: true,
        disposed,
    });
}
// Native module URLs, real createSSRRender ownership, rewritten route metadata, same process.
const staticRoot = path.join(output, "native-static");
fs.mkdirSync(path.join(staticRoot, "dist/server"), { recursive: true });
fs.writeFileSync(path.join(staticRoot, "package.json"), '{"type":"module"}');
const web = pathToFileURL(path.join(root, "packages/front/dist/web.mjs")).href;
const ssr = pathToFileURL(path.join(root, "packages/front/dist/ssr.mjs")).href;
report.static = [];
for (const explicit of [false, true]) {
    for (const buildId of ["first", "second"]) {
        const route = buildId === "first" ? "/first" : "/second";
        const key = `${explicit}-${buildId}`;
        fs.writeFileSync(
            path.join(staticRoot, "dist/server/ssr.js"),
            `import {defineWebApp} from ${JSON.stringify(web)}; import {createSSRRender, serializeServerData as serialize} from ${JSON.stringify(ssr)}; const definition=defineWebApp({id:'native-static',pages:[{id:'page',handler:()=>({id:'page',pageType:'page',title:${JSON.stringify(key)}}),routes:[${JSON.stringify(route)}]}],getErrorPage:(_,title)=>({id:'error',pageType:'error',title})}); const owned=createSSRRender({definition,render:app=>({html:'<main>'+app.getSnapshot().entries.at(-1).page.title+'</main>',head:'',css:''})}); const dispose=owned.dispose; owned.dispose=async()=>{await dispose();(globalThis.__staticDisposed??=[]).push(${JSON.stringify(key)});}; export const render=owned; export const serializeServerData=data=>serialize(data,{buildId:${JSON.stringify(key)}});`,
        );
        const context = {
            root: staticRoot,
            buildId: key,
            fs,
            path,
            templateHtml: "<html><body><!--ssr-body--><!--ssr-data--></body></html>",
            copyStaticAssets() {},
            vite: {
                async build() {
                    fs.writeFileSync(
                        path.join(staticRoot, "dist/server/_routes.mjs"),
                        `export const routes=[{path:${JSON.stringify(route)},renderMode:'ssr'}];`,
                    );
                },
            },
        };
        await staticAdapter(explicit ? { routesExport: "src/routes.ts" } : {}).build(context);
        const html = fs.readFileSync(
            path.join(staticRoot, "dist/static", route, "index.html"),
            "utf8",
        );
        assert.ok(html.includes(`<main>${key}</main>`));
        assert.ok(html.includes(`"buildId":"${key}"`));
        assert.ok(globalThis.__staticDisposed.includes(key));
        assert.equal(fs.existsSync(path.join(staticRoot, "dist/server/_routes.mjs")), false);
        if (buildId === "second")
            assert.equal(
                fs.existsSync(path.join(staticRoot, "dist/static/first/index.html")),
                false,
            );
        report.static.push({
            explicit,
            buildId: key,
            route,
            disposed: true,
            htmlSha256: createHash("sha256").update(html).digest("hex"),
        });
    }
}
// Type-check the actual current Markdown fences from the selected React fixture, using public declarations.
report.docs = [];
const file = path.join(root, "templates/react/.final-fix-config.ts");
const declaration = path.join(root, "packages/front/dist/vite.d.mts");
const options = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { "@finesoft/front/vite": [declaration] },
};
try {
    for (const name of [
        "01-getting-started.md",
        "09-server-and-deployment.md",
        "zh/01-getting-started.md",
        "zh/09-server-and-deployment.md",
    ]) {
        const content = fs.readFileSync(path.join(root, "packages/front/docs", name), "utf8");
        const code = [...content.matchAll(/```ts\n([\s\S]*?)```/g)]
            .map((match) => match[1])
            .find(
                (code) => code.includes("finesoftFrontViteConfig") && code.includes("defineConfig"),
            );
        assert.ok(code);
        assert.ok(!code.includes("bootstrapEntry"));
        fs.writeFileSync(file, code);
        const program = ts.createProgram([file], options);
        const diagnostics = ts
            .getPreEmitDiagnostics(program)
            .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
        assert.deepEqual(diagnostics, [], name);
        report.docs.push({
            name,
            sha256: createHash("sha256").update(code).digest("hex"),
            diagnostics,
        });
    }
    const types = `import {defineWebApp, type BeforeNavigatePolicy, type BeforeCommitPolicy, type NavigationCommitContext} from '@finesoft/front/web';
const admission: BeforeNavigatePolicy = ctx => { const signal: AbortSignal=ctx.signal; const id: string=ctx.transitionId; return {kind:'redirect',url:'/login',status:302}; };
const commit: BeforeCommitPolicy = ctx => ({kind:'deny',status:409,message:ctx.candidate.destinations.length ? 'draft' : 'empty'});
const app=defineWebApp({id:'typed',pages:[],getErrorPage:()=>({id:'error',pageType:'error',title:'error'}),beforeNavigate:[admission],beforeCommit:[commit]});
// @ts-expect-error commit cannot redirect a candidate after its only check
const invalid: BeforeCommitPolicy = () => ({kind:'redirect',url:'/',status:302});
function readonlyContext(ctx: NavigationCommitContext) {
// @ts-expect-error transaction context identity is readonly
ctx.transitionId='changed';
// @ts-expect-error definition policy arrays are readonly
app.beforeNavigate!.push(admission);
}
`;
    fs.writeFileSync(file, types);
    const program = ts.createProgram([file], {
        ...options,
        paths: { "@finesoft/front/web": [path.join(root, "packages/front/dist/web.d.mts")] },
    });
    assert.deepEqual(
        ts
            .getPreEmitDiagnostics(program)
            .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
        [],
    );
    report.publicTypes = "positive and expected-negative declarations passed";
} finally {
    fs.rmSync(file, { force: true });
}
// Use the actual verifier's selection expression with an old archive in its persistent directory.
const verifier = fs.readFileSync(path.join(root, "scripts/verify-runtime-boundaries.mjs"), "utf8");
const selection = verifier.match(
    /const packedPackage = JSON.parse\(before\);([\s\S]*?)assert.ok\(tarball.endsWith/,
)[1];
const packedPackage = JSON.parse(fs.readFileSync(path.join(root, "packages/front/package.json")));
const evidence = path.join(output, "archive-selection");
fs.mkdirSync(evidence, { recursive: true });
const expected = `${packedPackage.name.replace(/^@/, "").replaceAll("/", "-")}-${packedPackage.version}.tgz`;
fs.writeFileSync(path.join(evidence, "finesoft-front-0.0.0.tgz"), "stale");
fs.writeFileSync(path.join(evidence, expected), "current-selection-only");
const selectionModule = path.join(evidence, "selection.mjs");
fs.writeFileSync(
    selectionModule,
    `import path from 'node:path'; const evidence=${JSON.stringify(evidence)}; const packedPackage=${JSON.stringify(packedPackage)}; ${selection}; export default tarball;`,
);
const { default: tarball } = await import(pathToFileURL(selectionModule));
assert.equal(tarball, path.join(evidence, expected));
report.archiveSelection = {
    twoArchives: fs.readdirSync(evidence).filter((name) => name.endsWith(".tgz")),
    selected: path.basename(tarball),
    note: "selection-only regression; real current archive hash recorded by pack evidence",
};
// Standard browser host and real DOM. Native roots own rendering and acknowledge each commit.
const browserFile = path.join(output, "browser.mjs");
fs.writeFileSync(
    browserFile,
    `import {defineWebApp} from '/packages/front/dist/web.mjs'; import {createBrowserApp} from '/packages/front/dist/browser.mjs';
const target=document.querySelector('#app'); const definition=defineWebApp({id:'browser-policy',pages:['home','other'].map(id=>({id,handler:()=>({id,pageType:id,title:id}),routes:[id==='home'?'/':'/other']})),getErrorPage:(_status,title)=>({id:'error',pageType:'error',title})});
const app=await createBrowserApp({definition,target,history:'browser'}); const render=()=>{const page=app.getSnapshot().entries.at(-1)?.page; target.innerHTML='<h1></h1><input aria-label="draft" />'; target.querySelector('h1').textContent=page?.title??'missing'; app.commit(app.getSnapshot().revision);}; app.subscribe(render); render(); await app.ready; window.probe={app,ready:true};`,
);
const server = await createServer({
    configFile: false,
    root,
    server: { host: "127.0.0.1", port: 0 },
    appType: "custom",
});
server.middlewares.use((req, res, next) => {
    if (["/", "/other"].includes(new URL(req.url, "http://local").pathname)) {
        res.setHeader("content-type", "text/html");
        res.end(
            '<html><body><div id="app"></div><script type="module" src="/reports/application-boundaries/final-fix/browser.mjs"></script></body></html>',
        );
    } else next();
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
report.browser = [];
try {
    const tab = await browser.newPage();
    const errors = [];
    tab.on("pageerror", (error) => errors.push(String(error)));
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    await tab.goto(`${base}/`);
    await tab.waitForFunction(() => window.probe?.ready);
    assert.equal(await tab.locator("h1").textContent(), "home");
    await tab.locator("input").fill("draft");
    await tab.evaluate(() => window.probe.app.navigation.navigate("/other"));
    await tab.waitForFunction(() => document.querySelector("h1")?.textContent === "other");
    assert.equal(await tab.locator("h1").textContent(), "other");
    assert.equal(
        await tab.evaluate(() => document.querySelector("#app").getAttribute("data-fs-app")),
        "browser-policy",
    );
    assert.deepEqual(errors, []);
    report.browser.push({
        nativeRoot: true,
        readyAfterCommit: true,
        navigation: true,
        rootMarker: true,
    });
    await tab.screenshot({ path: path.join(output, "browser-native.png") });
    await tab.close();
} finally {
    await browser.close();
    await server.close();
}
fs.writeFileSync(path.join(output, "public-probes.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
