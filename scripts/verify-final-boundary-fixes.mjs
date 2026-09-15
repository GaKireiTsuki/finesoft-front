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
import { createSSRRender, createSSRNavigationRender } from "../packages/front/dist/ssr.mjs";
import { staticAdapter } from "../packages/front/dist/vite.mjs";
import {
    defineWebApp,
    Framework,
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
        controllers: ["home", "saved"].map((id) => ({ id, handler: () => page(id) })),
        routes: [
            { path: "/", intentId: "home" },
            {
                path: "/saved",
                intentId: "saved",
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
        getErrorPage: (_, message) => page(message),
    });
    const framework = Framework.create({ definition });
    const navigation = createNavigationController({
        framework,
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
        version: 1,
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
    await framework.dispose();
}
report.ssr = [];
for (const [strategy, createRender] of [
    ["flat", createSSRRender],
    ["navigation", createSSRNavigationRender],
]) {
    let mode = "deny",
        loads = 0,
        disposed = 0;
    const definition = defineWebApp({
        id: "public-ssr-policy",
        routes: [{ path: "/", intentId: "home", cache: "public" }],
        controllers: [
            {
                id: "home",
                handler: (_params, context) => {
                    loads++;
                    context.onDispose(() => {
                        disposed++;
                    });
                    return page("home");
                },
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
        renderApp: (value) => ({ html: value.title, head: "", css: "" }),
        resolveLocale: () => ({ lang: "ar", dir: "rtl" }),
    });
    const denied = await render("/", { request: new Request("https://local/") });
    assert.equal(denied.status, 409);
    assert.equal(denied.html, "draft");
    assert.deepEqual(denied.serverData, []);
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
            `import {defineWebApp} from ${JSON.stringify(web)}; import {createSSRRender, serializeServerData as serialize} from ${JSON.stringify(ssr)}; const definition=defineWebApp({id:'native-static',controllers:[{id:'page',handler:()=>({id:'page',pageType:'page',title:${JSON.stringify(key)}})}],routes:[{path:${JSON.stringify(route)},intentId:'page'}],getErrorPage:(_,title)=>({id:'error',pageType:'error',title})}); const owned=createSSRRender({definition,renderApp:page=>({html:'<main>'+page.title+'</main>',head:'',css:''})}); const dispose=owned.dispose; owned.dispose=async()=>{await dispose();(globalThis.__staticDisposed??=[]).push(${JSON.stringify(key)});}; export const render=owned; export const serializeServerData=data=>serialize(data,{buildId:${JSON.stringify(key)}});`,
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
const app=defineWebApp({id:'typed',routes:[],getErrorPage:()=>({id:'error',pageType:'error',title:'error'}),beforeNavigate:[admission],beforeCommit:[commit]});
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
// Standard browser host and real DOM, both presentation strategies; no alternate navigation engine.
const browserFile = path.join(output, "browser.mjs");
fs.writeFileSync(
    browserFile,
    `import {defineWebApp,collectVisibleDestinations} from '/packages/front/dist/web.mjs'; import {startBrowserApp} from '/packages/front/dist/browser.mjs';
const state=window.probe={deny:false,initialDeny:new URL(location.href).searchParams.has('deny'),events:[],loads:0,visits:0};
const app=defineWebApp({id:'browser-policy',controllers:['home','other'].map(id=>({id,handler:()=>{state.loads++;return {id,pageType:id,title:id};}})),routes:[{path:'/',intentId:'home'},{path:'/other',intentId:'other'},{path:'/redirect',intentId:'home'}],getErrorPage:(status,title)=>({id:String(status),pageType:'error',title}),beforeNavigate:[ctx=>{state.events.push(['beforeNavigate',ctx.transitionId]); if(state.initialDeny)return {kind:'deny',status:403,message:'Admission blocked'};if(collectVisibleDestinations(ctx.tree).at(-1)?.url==='/redirect')return {kind:'redirect',url:'/other',status:302};return {kind:'next'};}],beforeCommit:[async ctx=>{state.events.push(['beforeCommit',ctx.transitionId]);const result=state.deny?{kind:'deny',status:409,message:'Unsaved draft'}:{kind:'next'};if(state.pause)await new Promise(resolve=>state.release=resolve);return result;}]});
const renderer={mode:new URL(location.href).searchParams.get('mode')??'root',mount:async({target,page,context})=>{target.innerHTML='<h1></h1><input aria-label="draft" />';target.querySelector('h1').textContent=page.title;state.renderedSnapshot=context.snapshot;return {update:page=>{target.querySelector('h1').textContent=page.title;},dispose:()=>target.replaceChildren()};}};
state.app=await startBrowserApp({app,renderer,target:document.querySelector('#app'),history:'browser'});const visit=state.app.framework.didEnterPage.bind(state.app.framework);state.app.framework.didEnterPage=page=>{state.visits++;visit(page);};state.ready=true;`,
);
const server = await createServer({
    configFile: false,
    root,
    server: { host: "127.0.0.1", port: 0 },
    appType: "custom",
});
server.middlewares.use((req, res, next) => {
    if (["/", "/other", "/redirect"].includes(new URL(req.url, "http://local").pathname)) {
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
    for (const mode of ["root", "entries"]) {
        const tab = await browser.newPage();
        const errors = [];
        tab.on("pageerror", (error) => errors.push(String(error)));
        const base = `http://127.0.0.1:${server.httpServer.address().port}`;
        await tab.goto(`${base}/?mode=${mode}&deny`);
        await tab.waitForFunction(() => window.probe?.ready);
        assert.equal(await tab.locator("h1").textContent(), "Admission blocked");
        assert.equal(await tab.evaluate(() => window.probe.loads), 0);
        assert.equal(await tab.evaluate(() => window.probe.renderedSnapshot.rejection.status), 403);
        await tab.goto(`${base}/?mode=${mode}`);
        await tab.waitForFunction(() => window.probe?.ready);
        await tab.locator("input").fill("unsaved original");
        await tab.evaluate(() => {
            window.probe.deny = true;
            window.probe.original = window.probe.app.getSnapshot();
            window.probe.historyLength = history.length;
            return window.probe.app.navigate("/other");
        });
        assert.equal(await tab.locator("h1").textContent(), "home");
        assert.equal(await tab.locator("input").inputValue(), "unsaved original");
        assert.ok(
            await tab.evaluate(
                () =>
                    window.probe.app.getSnapshot() === window.probe.original &&
                    history.length === window.probe.historyLength &&
                    window.probe.visits === 0,
            ),
        );
        await tab.evaluate(async () => {
            window.probe.deny = false;
            await window.probe.app.navigate("/other");
        });
        await tab.locator("input").fill("unsaved second");
        await tab.evaluate(() => {
            window.probe.deny = true;
            window.probe.original = window.probe.app.getSnapshot();
            window.probe.eventCount = window.probe.events.length;
            window.probe.committedHistoryId = history.state.id;
            history.back();
        });
        await tab.waitForFunction(() => window.probe.events.length >= window.probe.eventCount + 2);
        await tab.waitForFunction(
            () =>
                location.pathname === "/other" &&
                history.state.id === window.probe.committedHistoryId,
        );
        assert.equal(await tab.locator("h1").textContent(), "other");
        assert.equal(await tab.locator("input").inputValue(), "unsaved second");
        assert.ok(
            await tab.evaluate(() => window.probe.app.getSnapshot() === window.probe.original),
        );
        await tab.evaluate(() => {
            window.probe.deny = false;
            history.back();
        });
        await tab.waitForFunction(() => document.querySelector("h1")?.textContent === "home");
        assert.equal(new URL(tab.url()).pathname, "/");
        await tab.evaluate(() => window.probe.app.navigate("/other"));
        await tab.evaluate(() => {
            window.probe.pause = true;
            window.probe.deny = true;
            history.back();
        });
        await tab.waitForFunction(() => !!window.probe.release);
        await tab.evaluate(async () => {
            window.probe.pause = false;
            window.probe.deny = false;
            const next = window.probe.app.navigate("/redirect");
            window.probe.release();
            await next;
        });
        assert.equal(new URL(tab.url()).pathname, "/other");
        assert.equal(await tab.locator("h1").textContent(), "other");
        assert.deepEqual(errors, []);
        report.browser.push({
            mode,
            initialAdmission403: true,
            urlVetoPreservesDraftSnapshotHistoryAndVisits: true,
            popVetoPreservesDraftSnapshotHistoryIdentity: true,
            acceptedBack: true,
            newerNavigationSupersedesAsyncVeto: true,
            admissionRedirect: true,
            nativePopBoundary:
                "owned entries compensate to the committed position; unknown ownership is diagnosed without guessed traversal",
        });
        await tab.screenshot({ path: path.join(output, `browser-${mode}.png`) });
        await tab.close();
    }
} finally {
    await browser.close();
    await server.close();
}
fs.writeFileSync(path.join(output, "public-probes.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
