/** Real paired Vite builds: public package producer/consumer, IDs, prerender and payload safety. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite-plus";
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(
    repository,
    ".superpowers/sdd/2026-09-15-application-boundaries/task-5-evidence/build-app",
);
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.mkdirSync(path.join(root, "node_modules/@finesoft"), { recursive: true });
for (const name of ["front", "core", "web", "ssr", "server", "browser"]) {
    const link = path.join(root, "node_modules/@finesoft", name);
    if (!fs.existsSync(link)) fs.symlinkSync(path.join(repository, "packages", name), link, "dir");
}
for (const name of ["vite-plus", "hono", "@hono/node-server"]) {
    const link = path.join(root, "node_modules", name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    if (!fs.existsSync(link))
        fs.symlinkSync(
            fs.realpathSync(
                path.join(
                    repository,
                    name === "vite-plus" ? "node_modules" : "packages/server/node_modules",
                    name,
                ),
            ),
            link,
            "dir",
        );
}
fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module", private: true }),
);
fs.writeFileSync(
    path.join(root, "index.html"),
    '<html><head><!--ssr-head--></head><body><main id="app"><!--ssr-body--></main><!--ssr-data--><script type="module" src="/src/client.ts"></script></body></html>',
);
fs.writeFileSync(
    path.join(root, "vite.config.ts"),
    `import { finesoftFrontViteConfig } from '@finesoft/front'; export default { build: { modulePreload: false }, plugins: [finesoftFrontViteConfig({ adapter: 'node', ssr: { entry: 'src/ssr.ts' }, bootstrapEntry: 'src/app.ts' })] };`,
);
fs.writeFileSync(
    path.join(root, "src/client.ts"),
    `import { getFrameworkBuildId, decodeWireEnvelope, deserializeServerData } from '@finesoft/front/browser'; globalThis.__stateProtocolProbe = { buildId: getFrameworkBuildId(), decode: decodeWireEnvelope, read: deserializeServerData };`,
);
fs.writeFileSync(
    path.join(root, "src/app.ts"),
    `import { defineWebApp, markPublic } from '@finesoft/front'; export default defineWebApp({ id:'probe', controllers:[{id:'home',handler:()=>markPublic({id:'home',pageType:'home',title:'Home',user:{name:'Alice',secret:'SECRET'}},{user:{name:true}})}], routes:[{path:'/',intentId:'home',renderMode:'prerender',cache:'public'}], getErrorPage:(status,message)=>({id:String(status),pageType:'error',title:message}) });`,
);
fs.writeFileSync(
    path.join(root, "src/ssr.ts"),
    `import { createSSRRender } from '@finesoft/front'; import definition from './app'; export { serializeServerData } from '@finesoft/front'; export const render=createSSRRender({definition,renderApp:page=>({html:page.title,head:'',css:''})});`,
);
const ids = [];
for (let round = 0; round < 2; round++) {
    fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
    await build({ root, logLevel: "warn" });
    const html = fs.readFileSync(path.join(root, "dist/prerender/index.html"), "utf8");
    const raw = html.match(
        /<script id="serialized-server-data" type="application\/json">(.*?)<\/script>/s,
    )?.[1];
    assert.ok(raw, "standard shared response emitted wire envelope");
    const wire = JSON.parse(raw);
    const client = fs
        .readdirSync(path.join(root, "dist/client/assets"))
        .find((name) => name.endsWith(".js"));
    assert.ok(client);
    const scriptPath = path.join(root, "dist/client/assets", client);
    const clientSource = fs.readFileSync(scriptPath, "utf8");
    assert.doesNotMatch(clientSource, /node:|from["']hono|require\(/);
    await import(pathToFileURL(scriptPath).href + `?round=${round}`);
    const consumer = globalThis.__stateProtocolProbe;
    assert.equal(consumer.buildId, wire.buildId);
    assert.notEqual(wire.buildId, "unbundled");
    assert.equal(consumer.decode(wire).status, "ready");
    assert.equal(consumer.read({ script: { textContent: raw, parentNode: null } }).status, "ready");
    assert.equal(consumer.decode({ ...wire, buildId: "old" }).code, "build-mismatch");
    assert.equal(wire.payload[0].data.user.name, "Alice");
    assert.equal(wire.payload[0].data.user.secret, undefined);
    assert.ok(fs.statSync(path.join(root, "dist/server/index.mjs")).size);
    ids.push(wire.buildId);
}
assert.notEqual(ids[0], ids[1]);
console.log(
    JSON.stringify({
        passed: true,
        pairedBuildIds: ids,
        buildIdsChanged: true,
        consumerDecoded: true,
        nestedSecretExcluded: true,
        nodeHostBuilt: true,
    }),
);
