/** Actual locally packed installs, declaration consumers and entry dependency graphs. No source aliases. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
const root = new URL("../", import.meta.url).pathname;
const evidence = path.join(root, "reports/application-boundaries/packed");
await fs.mkdir(evidence, { recursive: true });
const manifestPath = root + "packages/front/package.json";
const before = await fs.readFile(manifestPath);
const run = (args, cwd) =>
    execFileSync("vp", args, { cwd, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
try {
    await fs.writeFile(
        evidence + "/pack.log",
        run(["pm", "pack", "--pack-destination", evidence], root + "packages/front"),
    );
} finally {
    run(["exec", "node", root + "scripts/restore-front-publish.mjs"], root + "packages/front");
}
assert.deepEqual(await fs.readFile(manifestPath), before);
const packedPackage = JSON.parse(before);
const tarball = path.join(
    evidence,
    `${packedPackage.name.replace(/^@/, "").replaceAll("/", "-")}-${packedPackage.version}.tgz`,
);
assert.ok(tarball.endsWith(".tgz"));
const result = {
    tarball,
    sha256: createHash("sha256")
        .update(await fs.readFile(tarball))
        .digest("hex"),
    node: process.version,
    consumers: [],
    graphs: {},
};
const scratch = await fs.mkdtemp(path.join(tmpdir(), "front-packed-consumers-"));
const peers = {
    react: {
        react: "19.2.8",
        "react-dom": "19.2.8",
        "@types/react": "19.2.18",
        "@types/react-dom": "19.2.4",
    },
    vue: { vue: "3.5.41" },
    svelte: { svelte: "5.55.1" },
    node: { "@hono/node-server": "2.1.0", "@types/node": "24.12.2" },
    tooling: {
        vite: "npm:@voidzero-dev/vite-plus-core@0.2.8",
        hono: "4.12.9",
        "@types/node": "24.12.2",
    },
};
async function files(dir) {
    return (
        await Promise.all(
            (
                await fs.readdir(dir, { withFileTypes: true })
            ).map(async (entry) =>
                entry.isDirectory()
                    ? files(path.join(dir, entry.name))
                    : [path.join(dir, entry.name)],
            ),
        )
    ).flat();
}
function imports(source, file) {
    const names = [];
    const visit = (node) => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        )
            names.push(node.moduleSpecifier.text);
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
        )
            names.push(node.arguments[0].text);
        ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));
    return names;
}
async function graph(entry, dist) {
    const visited = new Set(),
        external = new Set();
    async function walk(file) {
        if (visited.has(file)) return;
        visited.add(file);
        for (const spec of imports(await fs.readFile(file, "utf8"), file)) {
            if (spec.startsWith(".")) await walk(path.resolve(path.dirname(file), spec));
            else external.add(spec);
        }
    }
    await walk(path.join(dist, entry));
    return {
        files: [...visited].map((file) => path.relative(dist, file)),
        external: [...external].sort((a, b) => a.localeCompare(b)),
    };
}
const typeSource = `import { defineApp, defineOperation, createRuntime, BaseController } from '@finesoft/front';
import { definePage, defineWebApp } from '@finesoft/front/web';
import { createHttpHandler, defineEndpoint } from '@finesoft/front/http';
import { createWorkerHandler } from '@finesoft/front/worker';
import { startBrowserApp } from '@finesoft/front/browser';
import { createSSRHandler } from '@finesoft/front/ssr';
const double = defineOperation({id:'double',kind:'query',handler:(n:number)=>n*2});
const runtime=createRuntime({app:defineApp({id:'packed',operations:[double]})});
const promise:Promise<number>=runtime.execute(double,3);
// @ts-expect-error Operation input stays typed through the packed declaration.
runtime.execute(double,'3');
// @ts-expect-error Operation result stays typed through the packed declaration.
const bad:Promise<string>=runtime.execute(double,3);
const product=definePage({id:'load-product',handler:(params:{id:number})=>({id:String(params.id),pageType:'product' as const,title:'Product'})});
product.leaf({id:1});
// @ts-expect-error Required parameter preserved.
product.leaf();
// @ts-expect-error Input type preserved.
product.leaf({id:'1'});
product.bindView('product',{});
class ProductController extends BaseController<{id:number}, {id:string,pageType:'product',title:string}> {
    readonly intentId='class-product';
    execute(params:{id:number}) { return {id:String(params.id),pageType:'product' as const,title:'Product'}; }
}
const classProduct=definePage({id:'class-product',create:()=>new ProductController()});
classProduct.leaf({id:1});
classProduct.bindView('product',{});
// @ts-expect-error Factory parameter inference survives packing.
classProduct.leaf({id:'one'});
// @ts-expect-error Factory result pageType inference survives packing.
classProduct.bindView('class-product',{});
// @ts-expect-error Transport id is not a result pageType.
product.bindView('load-product',{});
const app=defineWebApp({id:'web',controllers:[product],routes:[product.route('/product/:id')],getErrorPage:(_,title)=>({id:'error',pageType:'error',title})});
void [promise,bad,app,startBrowserApp,createHttpHandler,defineEndpoint,createWorkerHandler,createSSRHandler];`;
function typecheck(file, selected) {
    const program = ts.createProgram([file], {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ["node", "tooling"].includes(selected) ? ["node"] : [],
        typeRoots: [path.dirname(file) + "/node_modules/@types"],
        lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
        diagnostics.length,
        0,
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
            getCurrentDirectory: () => scratch,
            getCanonicalFileName: (f) => f,
            getNewLine: () => "\n",
        }),
    );
}
try {
    for (const selected of ["portable", "react", "vue", "svelte", "node", "tooling"]) {
        const cwd = scratch + "/" + selected;
        await fs.mkdir(cwd);
        await fs.writeFile(cwd + "/.npmrc", "auto-install-peers=false\n");
        await fs.writeFile(
            cwd + "/package.json",
            JSON.stringify(
                {
                    name: "packed-" + selected,
                    private: true,
                    type: "module",
                    packageManager: "pnpm@11.20.0",
                    dependencies: {
                        "@finesoft/front": "file:" + tarball,
                        ...peers[selected],
                    },
                },
                null,
                2,
            ),
        );
        await fs.writeFile(evidence + "/install-" + selected + ".log", run(["install"], cwd));
        const requireFromConsumer = createRequire(cwd + "/package.json");
        const absentPeers = [];
        for (const peer of ["react", "vue", "svelte", "vite", "@types/node"]) {
            if (Object.hasOwn(peers[selected] ?? {}, peer)) continue;
            assert.throws(() => requireFromConsumer.resolve(peer + "/package.json"), {
                code: "MODULE_NOT_FOUND",
            });
            absentPeers.push(peer);
        }
        const dist = await fs.realpath(cwd + "/node_modules/@finesoft/front/dist");
        const manifest = JSON.parse(await fs.readFile(path.resolve(dist, "../package.json")));
        assert.equal(manifest.devDependencies, undefined);
        assert.equal(manifest.exports["./core"], undefined);
        assert.ok(!JSON.stringify(manifest).includes("workspace:"));
        for (const file of await files(dist)) {
            assert.ok(!file.endsWith(".map"), "No source maps in packed files");
            if (!/\.(?:mjs|mts)$/.test(file)) continue;
            for (const spec of imports(await fs.readFile(file, "utf8"), file))
                assert.ok(
                    !/^@finesoft\/(core|web|browser|ssr|server)(\/|$)/.test(spec),
                    "Private package leak: " + spec,
                );
        }
        const entries =
            selected === "portable"
                ? ["index", "web", "http", "worker", "browser", "ssr"]
                : selected === "node"
                  ? ["node"]
                  : selected === "tooling"
                    ? ["vite"]
                    : ["renderers/" + selected + "/browser", "renderers/" + selected + "/server"];
        for (const entry of entries) {
            const info = await graph(entry + ".mjs", dist);
            result.graphs[entry] = info;
            if (selected === "portable")
                assert.deepEqual(
                    info.external,
                    [],
                    entry + " has external environment dependencies",
                );
            if (["react", "vue", "svelte"].includes(selected))
                for (const spec of info.external)
                    assert.ok(
                        spec === selected ||
                            spec.startsWith(selected + "/") ||
                            (selected === "react" && /^react-dom(?:\/|$)/.test(spec)),
                        "Unselected UI/environment: " + spec,
                    );
            if (selected === "node")
                assert.ok(
                    !info.external.some((spec) => /vite|dotenv|react|vue|svelte/.test(spec)),
                    "Production Node graph contains tooling/UI",
                );
            await import(pathToFileURL(path.join(dist, entry + ".mjs")).href);
        }
        let source = typeSource;
        if (["react", "vue", "svelte"].includes(selected))
            source += `\nimport * as browserRenderer from '@finesoft/front/renderers/${selected}/browser';\nimport * as serverRenderer from '@finesoft/front/renderers/${selected}/server';\nvoid [browserRenderer,serverRenderer];`;
        if (selected === "node")
            source +=
                "\nimport { startNodeHandler } from '@finesoft/front/node'; void startNodeHandler;";
        if (selected === "tooling")
            source +=
                "\nimport { finesoftFrontViteConfig, staticAdapter } from '@finesoft/front/vite'; void [finesoftFrontViteConfig,staticAdapter];";
        await fs.writeFile(cwd + "/consumer.ts", source);
        typecheck(cwd + "/consumer.ts", selected);
        await fs.copyFile(cwd + "/consumer.ts", evidence + "/consumer-" + selected + ".ts.txt");
        await fs.copyFile(cwd + "/package.json", evidence + "/package-" + selected + ".json");
        if (selected === "portable") {
            const { defineApp, defineOperation, createRuntime } = await import(
                pathToFileURL(dist + "/index.mjs")
            );
            const { defineEndpoint, createHttpHandler } = await import(
                pathToFileURL(dist + "/http.mjs")
            );
            const { createWorkerHandler } = await import(pathToFileURL(dist + "/worker.mjs"));
            const operation = defineOperation({
                id: "double",
                kind: "query",
                handler: (n) => n * 2,
            });
            const runtime = createRuntime({
                app: defineApp({ id: "packed", operations: [operation] }),
            });
            const endpoints = [
                defineEndpoint({
                    method: "POST",
                    path: "/double",
                    operation,
                    decode: (r) => r.json(),
                    encode: (value) => Response.json({ value }),
                }),
            ];
            try {
                assert.equal(await runtime.execute(operation, 3), 6);
                for (const handler of [
                    createHttpHandler({ runtime, endpoints }),
                    createWorkerHandler({ runtime, endpoints }).fetch,
                ])
                    assert.deepEqual(
                        await (
                            await handler(
                                new Request("https://packed.test/double", {
                                    method: "POST",
                                    body: "3",
                                }),
                            )
                        ).json(),
                        { value: 6 },
                    );
            } finally {
                await runtime.dispose();
            }
        }
        result.consumers.push({
            selected,
            entries,
            absentPeers,
            installedAt: cwd,
            declarations: "strict, no skipLibCheck; positive and negative assertions passed",
            imports: "passed",
        });
        console.log(
            "packed " + selected + ": isolated imports, graph and declaration checks passed",
        );
    }
    // Build-only entry may import tooling; it must stay absent from every production graph above.
    await fs.writeFile(evidence + "/result.json", JSON.stringify(result, null, 2));
} finally {
    await fs.rm(scratch, { recursive: true, force: true });
}
console.log("Packed consumer matrix passed; manifests restored and temporary installs removed.");
