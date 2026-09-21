/** Public-package acceptance: class boundary, SSR, browser RPC and request cookies. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer, preview } from "vite-plus";
import { chromium } from "playwright";
import { BaseController } from "../packages/front/dist/index.mjs";
import { BaseServerController, createSSRRender } from "../packages/front/dist/ssr.mjs";
import { definePage, defineWebApp, markPublic } from "../packages/front/dist/web.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const reportDir = path.join(root, "reports/server-controllers");
const fixture = path.join(reportDir, "fixture");
const sentinel = "SERVER_ONLY_PROBE_7a1832";
await fs.rm(fixture, { recursive: true, force: true });
await fs.mkdir(path.join(fixture, "src"), { recursive: true });
await fs.symlink(
    path.join(root, "templates/react/node_modules"),
    path.join(fixture, "node_modules"),
    "dir",
);
const files = {
    "package.json": '{"name":"server-controller-acceptance","type":"module","private":true}',
    "index.html": `<!doctype html><html><head><!--ssr-head--></head><body><div id="app"><!--ssr-body--><!--ssr-data--></div><button id="next">Next account</button><script type="module" src="/src/main.ts"></script></body></html>`,
    "vite.config.ts": `import {defineConfig} from "vite-plus";
import {finesoftFrontViteConfig} from "@finesoft/front";
export default defineConfig({build:{sourcemap:true}, plugins:[finesoftFrontViteConfig({ssr:{entry:"src/ssr.ts"},setup:"src/setup.ts"})]});`,
    "src/private-service.ts": `import {createHash} from "node:crypto";
export const secret = "${sentinel}";
export const digest = () => createHash("sha256").update(secret).digest("hex");`,
    "src/account.ts": `import {BaseServerController} from "@finesoft/front";
import {markPublic} from "@finesoft/front";
import {secret,digest} from "./private-service";
let calls=0;
export class AccountController extends BaseServerController {
    async execute({params,query,context}) {
        const old=context.getCookie("session") ?? "anonymous";
        const response=await context.fetch("/api/refresh", {method:"POST",headers:{cookie:"session="+old}});
        for(const cookie of response.headers.getSetCookie()) context.responseHeaders.append("set-cookie",cookie);
        const current=await response.text();
        context.setCookie("seen",String(params.id),{httpOnly:true,sameSite:"Lax"});
        return markPublic({id:String(params.id),pageType:"account",title:params.id+":"+current+":"+query.q, calls:++calls, privateValue:secret+digest()+old},["calls"]);
    }
}`,
    "src/app-definition.ts": `import {int,str} from "@finesoft/front";
import {definePage,defineWebApp,next,deny,redirect} from "@finesoft/front";
import {AccountController} from "./account";
const account=definePage({id:"account",create:()=>new AccountController(),routes:[{path:"/account/:id",params:{id:int()},query:{q:str()}}]});
export const app=defineWebApp({id:"server-probe",pages:[account,{id:"home",routes:["/"],handler:()=>({id:"home",pageType:"home",title:"Home"})}],getErrorPage:(status,title)=>({id:String(status),pageType:"error",title}),beforeLoad:[ctx=>ctx.isServer&&ctx.query.q==="deny"?deny(403):ctx.isServer&&ctx.query.q==="redirect"?redirect("/"):next()]});`,
    "src/main.ts": `import {createBrowserApp} from "@finesoft/front";
import {app} from "./app-definition";
const target=document.getElementById("app");
const handle=await createBrowserApp({definition:app,target});
const heading=target.querySelector("h1") ?? target.appendChild(document.createElement("h1"));
function paint(){const snapshot=handle.getSnapshot();heading.textContent=snapshot.destinations.at(-1)?.page.title ?? "";handle.commit(snapshot.revision);}
handle.subscribe(paint);paint();await handle.ready;
window.probe=handle;
document.getElementById("next").onclick=()=>handle.perform({kind:"flow",url:"/account/2?q=second"});`,
    "src/ssr.ts": `import {createSSRRender} from "@finesoft/front";
import {app} from "./app-definition";
export const render=createSSRRender({definition:app,render:app=>"<h1>"+app.getSnapshot().destinations.at(-1).page.title+"</h1>"});
export {serializeServerData} from "@finesoft/front";`,
    "src/setup.ts": `export default function setup(app){app.post("/api/refresh",c=>{const old=/(?:^|; )session=([^;]+)/.exec(c.req.header("cookie") ?? "")?.[1] ?? "anonymous";c.header("Set-Cookie","session="+old+"-r; HttpOnly; Path=/; SameSite=Lax",{append:true});c.header("Set-Cookie","refresh=yes; HttpOnly; Path=/",{append:true});return c.text(old+"-r");});}`,
};
for (const [name, contents] of Object.entries(files))
    await fs.writeFile(path.join(fixture, name), contents);

await build({ root: fixture, logLevel: "warn" });
const clientFiles = (
    await fs.readdir(path.join(fixture, "dist/client"), { recursive: true })
).filter((name) => /\.(?:js|map|html)$/.test(name));
for (const name of clientFiles) {
    const contents = await fs.readFile(path.join(fixture, "dist/client", name), "utf8");
    assert.ok(!contents.includes(sentinel), `secret in ${name}`);
    assert.ok(!contents.includes("private-service"), `private dependency in ${name}`);
}
assert.ok((await fs.readFile(path.join(fixture, "dist/server/ssr.js"), "utf8")).includes(sentinel));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const evidence = { clientFiles: clientFiles.length, cases: [], browser: browser.version() };
try {
    for (const mode of ["preview", "dev"]) {
        const server =
            mode === "preview"
                ? await preview({
                      root: fixture,
                      logLevel: "warn",
                      preview: { host: "127.0.0.1", port: 0 },
                  })
                : await createServer({
                      root: fixture,
                      logLevel: "silent",
                      server: { host: "127.0.0.1", port: 0 },
                  });
        if (mode === "dev") await server.listen();
        const port = server.httpServer.address().port;
        const base = `http://127.0.0.1:${port}`;
        const context = await browser.newContext();
        await context.addCookies([
            { name: "session", value: "alice", url: base, httpOnly: true, sameSite: "Lax" },
        ]);
        const page = await context.newPage();
        const errors = [],
            calls = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("request", (request) => {
            if (request.url().endsWith("/__finesoft/controller")) calls.push(request);
        });
        try {
            const response = await page.goto(base + "/account/1?q=first");
            assert.equal(response.status(), 200);
            assert.match(await response.text(), /<h1>1:alice-r:first<\/h1>/);
            assert.ok(!(await response.text()).includes(sentinel));
            await page.waitForFunction(() => !!window.probe);
            assert.equal(calls.length, 0, "hydration must consume SSR data without another call");
            await page.locator("#next").click();
            await page.waitForFunction(
                () => document.querySelector("h1").textContent === "2:alice-r-r:second",
            );
            assert.equal(calls.length, 1);
            assert.equal(
                await page.evaluate(
                    () => window.probe.getSnapshot().destinations.at(-1).page.privateValue,
                ),
                undefined,
            );
            assert.equal(await page.evaluate(() => document.cookie), "");
            assert.equal(
                (await context.cookies()).find((cookie) => cookie.name === "session").value,
                "alice-r-r",
            );
            assert.equal(
                (await context.cookies()).find((cookie) => cookie.name === "seen").value,
                "2",
            );
            await page.evaluate(() =>
                window.probe.perform({
                    kind: "push",
                    intent: "account",
                    params: { id: 3 },
                    query: { q: "third" },
                }),
            );
            assert.equal(await page.locator("h1").textContent(), "3:alice-r-r-r:third");
            assert.match(
                await page.evaluate(() =>
                    window.probe.perform({ kind: "flow", url: "/account/4?q=deny" }).then(
                        () => "unexpected commit",
                        (error) => error.message,
                    ),
                ),
                /not committed/,
            );
            assert.equal(await page.locator("h1").textContent(), "3:alice-r-r-r:third");
            await page.evaluate(() =>
                window.probe.perform({ kind: "flow", url: "/account/4?q=redirect" }),
            );
            assert.equal(await page.locator("h1").textContent(), "Home");
            if (mode === "dev") {
                const module = await fetch(base + "/src/account.ts?t=123");
                assert.equal(module.status, 200);
                assert.ok(!(await module.text()).includes(sentinel));
                const raw = await fetch(base + "/src/account.ts?raw");
                assert.equal(raw.status, 500);
                assert.ok(!(await raw.text()).includes(sentinel));
                const dependency = await fetch(base + "/src/private-service.ts?raw");
                assert.ok(!dependency.ok, "server dependency must not be served as browser source");
                assert.ok(!(await dependency.text()).includes(sentinel));
            }
            assert.deepEqual(errors, []);
            evidence.cases.push({
                mode,
                ssr: true,
                hydrationCalls: 0,
                remoteCalls: calls.length,
                httpOnly: true,
                guards: true,
            });
        } finally {
            await context.close();
            if (mode === "dev") await server.close();
            else
                await new Promise((resolve, reject) =>
                    server.httpServer.close((error) => (error ? reject(error) : resolve())),
                );
        }
    }
} finally {
    await browser.close();
}
const renderers = Object.fromEntries(
    [
        ["shared", BaseController],
        ["server", BaseServerController],
    ].map(([name, Base]) => {
        class Controller extends Base {
            execute({ params }) {
                return markPublic({ id: params.id, pageType: "probe", title: "Account" }, []);
            }
        }
        return [
            name,
            createSSRRender({
                definition: defineWebApp({
                    id: name,
                    pages: [
                        definePage({
                            id: "account",
                            routes: ["/account/:id"],
                            create: () => new Controller(),
                        }),
                    ],
                    getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }),
                }),
                render: () => "",
            }),
        ];
    }),
);
const samples = { shared: [], server: [] };
try {
    for (const render of Object.values(renderers))
        for (let i = 0; i < 200; i++) await render("/account/1");
    for (let i = 0; i < 1000; i++)
        for (const name of i % 2 ? ["shared", "server"] : ["server", "shared"]) {
            const start = performance.now();
            const result = await renderers[name]("/account/1");
            samples[name].push((performance.now() - start) * 1000);
            assert.equal(result.serverData.pages[0].data.title, "Account");
        }
} finally {
    await Promise.all(Object.values(renderers).map((render) => render.dispose()));
}
evidence.ssrMicroseconds = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => {
        values.sort((a, b) => a - b);
        return [
            name,
            {
                samples: values.length,
                median: values[Math.floor(values.length * 0.5)],
                p95: values[Math.floor(values.length * 0.95)],
            },
        ];
    }),
);
await fs.writeFile(
    path.join(reportDir, "acceptance.json"),
    JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence, null, 2));
