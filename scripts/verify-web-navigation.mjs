/** Build the ordinary Web SSR -> shared handler -> Node prerender production chain. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import { nodeAdapter } from "../packages/server/dist/index.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = path.join(repository, "reports/application-boundaries/web-navigation");
const root = path.join(evidence, "artifact-app");
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.mkdirSync(path.join(root, "node_modules/@finesoft"), { recursive: true });
for (const name of ["front", "core", "web", "ssr", "server", "browser"]) {
    const link = path.join(root, "node_modules/@finesoft", name);
    if (!fs.existsSync(link)) fs.symlinkSync(path.join(repository, "packages", name), link, "dir");
}
const honoLink = path.join(root, "node_modules/hono");
if (!fs.existsSync(honoLink))
    fs.symlinkSync(
        fs.realpathSync(path.join(repository, "packages/server/node_modules/hono")),
        honoLink,
        "dir",
    );
fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module", private: true }),
);
fs.writeFileSync(
    path.join(root, "src/app.ts"),
    `
import { defineWebApp, markPublic } from "@finesoft/front/web";
export default defineWebApp({
    id: "production-probe",
    controllers: [{ id: "page", handler: () => markPublic({ id: "public", pageType: "probe", title: "Public artifact" }, true) }],
    routes: [
        { path: "/public", intentId: "page", renderMode: "prerender", cache: "public" },
        { path: "/private", intentId: "page", renderMode: "prerender" },
    ],
    getErrorPage: (status, message) => ({ id: String(status), pageType: "error", title: message }),
});
`,
);
fs.writeFileSync(
    path.join(root, "src/ssr.ts"),
    `
import { createSSRRender } from "@finesoft/front/ssr";
import definition from "./app";
export { serializeServerData } from "@finesoft/front/ssr";
export const render = createSSRRender({ definition, renderApp: page => ({ html: "<main>" + page.title + "</main>", head: "", css: "" }) });
`,
);
const vite = { build: (options) => build({ ...options, configFile: false, logLevel: "warn" }) };
await vite.build({
    root,
    build: {
        ssr: "src/ssr.ts",
        outDir: "dist/server",
        rollupOptions: { output: { entryFileNames: "ssr.js" } },
    },
});
const context = {
    root,
    fs,
    path,
    vite,
    ssrEntry: "src/ssr.ts",
    templateHtml:
        "<!DOCTYPE html><html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
    resolvedResolve: {},
    resolvedCss: {},
    proxies: [],
};
await nodeAdapter().build(context);
const publicFile = path.join(root, "dist/prerender/public/index.html");
const html = fs.readFileSync(publicFile, "utf8");
assert.match(html, /<main>Public artifact<\/main>/);
assert.match(html, /entryId/);
assert.equal(fs.existsSync(path.join(root, "dist/prerender/private/index.html")), false);
assert.ok(fs.statSync(path.join(root, "dist/server/index.mjs")).size > 0);
console.log(
    JSON.stringify(
        {
            passed: true,
            publicFile: path.relative(repository, publicFile),
            privateArtifact: false,
            nodeHostBuilt: true,
            hydrationEntryId: true,
        },
        null,
        2,
    ),
);
