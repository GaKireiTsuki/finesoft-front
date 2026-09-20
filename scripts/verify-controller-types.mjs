/** Actual public Vite entry, native vp check, and live source watcher. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite-plus";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const evidence = path.resolve(
    workspace,
    process.env.FINESOFT_VERIFY_REPORT_DIR ?? "reports/controller-type-generation",
);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "front-controller-watch-")));
const controller = path.join(root, "src/controller.ts");
const routes = path.join(root, "src/routes.ts");
const output = path.join(root, ".finesoft/controller-types.d.ts");
let server;
const check = (name, expected = 0) => {
    let status = 0;
    let log;
    try {
        log = execFileSync("vp", ["check", "--no-fmt", "--no-lint", "src", "vite.config.ts"], {
            cwd: root,
            encoding: "utf8",
            stdio: "pipe",
            maxBuffer: 8 * 1024 * 1024,
        });
    } catch (error) {
        status = error.status;
        log = String(error.stdout) + String(error.stderr);
    }
    fs.writeFileSync(path.join(evidence, name + ".log"), log);
    assert.equal(status, expected, log);
    return log;
};
try {
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n.finesoft/\n");
    fs.symlinkSync(
        path.join(workspace, "templates/react/node_modules"),
        path.join(root, "node_modules"),
        "dir",
    );
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "controller-types-probe",
            type: "module",
            packageManager: "pnpm@11.20.0",
        }),
    );
    fs.writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                noEmit: true,
                skipLibCheck: true,
                module: "ESNext",
                target: "ESNext",
                moduleResolution: "bundler",
                types: ["node"],
            },
            include: ["src", "vite.config.ts"],
        }),
    );
    fs.writeFileSync(
        path.join(root, "vite.config.ts"),
        `import { defineConfig, lazyPlugins } from "vite-plus";
import { finesoftFrontViteConfig } from "@finesoft/front/vite";
const front = finesoftFrontViteConfig({controllerTypes:{root:import.meta.dirname}});
export default defineConfig({plugins:lazyPlugins(()=>[front]),lint:{options:{typeCheck:true,typeAware:true}}});\n`,
    );
    fs.writeFileSync(
        controller,
        `import {BaseController} from "@finesoft/front";
interface ItemPage {id:string;pageType:"item";title:string}
// @ts-expect-error BaseController accepts a complete input contract, not params alone.
export type RemovedParamsForm = BaseController<{id:number}, ItemPage>;
// @ts-expect-error Query is part of the input contract; the third generic was removed.
export type RemovedQueryForm = BaseController<import("@finesoft/front").ControllerInput<{id:number}>, ItemPage, {q:string}>;
export class ItemController extends BaseController {
    execute({params, query, context}): ItemPage {return {id:params.id.toFixed(),pageType:"item",title:query.q.toUpperCase()+String(context.signal.aborted)}}
    override fallback({params, query, context, error}): ItemPage {return {id:params.id.toFixed(),pageType:"item",title:query.q.toUpperCase()+error.message+String(context.signal.aborted)}}
}\n`,
    );
    fs.writeFileSync(
        routes,
        `import {definePage,int,str} from "@finesoft/front/web";
import {ItemController} from "./controller";
export const page=definePage({id:"item",routes:[{path:"/items/:id",params:{id:int()},query:{q:str()}}],create:()=>new ItemController()});\n`,
    );
    check("native-check-number");
    assert.match(fs.readFileSync(output, "utf8"), /id: number/);
    const initialController = fs.readFileSync(controller, "utf8");
    assert.match(initialController, /import type/);
    assert.match(initialController, /ItemControllerInput as Input/);
    assert.match(initialController, /ItemControllerFailure as Failure/);
    assert.match(initialController, /extends BaseController<Input, ItemPage>/);
    assert.ok(!initialController.includes("@finesoft/controller-types begin"));
    fs.writeFileSync(routes, fs.readFileSync(routes, "utf8").replace("q:str()", "q:int()"));
    assert.match(check("native-check-rejects-query-number", 1), /toUpperCase/);
    assert.equal(fs.readFileSync(controller, "utf8"), initialController);
    fs.writeFileSync(routes, fs.readFileSync(routes, "utf8").replace("q:int()", "q:str()"));
    fs.writeFileSync(routes, fs.readFileSync(routes, "utf8").replace("id:int()", "id:str()"));
    assert.match(check("native-check-rejects-string", 1), /toFixed/);
    assert.equal(fs.readFileSync(controller, "utf8"), initialController);
    fs.writeFileSync(controller, initialController.replaceAll("toFixed()", "toUpperCase()"));
    check("native-check-string");

    server = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
    await server.listen();
    const textRoutes = fs.readFileSync(routes, "utf8");
    const numericRoutes = textRoutes.replace("id:str()", "id:int()").replace("q:str()", "q:int()");
    const updateSamplesMs = [];
    for (let i = 0; i < 6; i++) {
        const numeric = i % 2 === 0;
        const start = performance.now();
        fs.writeFileSync(routes, numeric ? numericRoutes : textRoutes);
        const expected = numeric ? "number" : "string";
        while (
            !fs.readFileSync(output, "utf8").includes(`id: ${expected}`) ||
            !fs.readFileSync(output, "utf8").includes(`q: ${expected}`)
        ) {
            assert.ok(
                performance.now() - start < 10000,
                "Dev watcher did not update controller types",
            );
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        updateSamplesMs.push(Math.round((performance.now() - start) * 1000) / 1000);
    }
    const sorted = [...updateSamplesMs].sort((a, b) => a - b);
    const updateMs = (sorted[2] + sorted[3]) / 2;
    const stamp = fs.statSync(output).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(fs.statSync(output).mtimeMs, stamp, "Generation caused a write loop");
    fs.writeFileSync(
        path.join(evidence, "native-flow.json"),
        JSON.stringify(
            {
                nativeCheck:
                    "execute/fallback: numeric params and string query accepted; wrong methods rejected after changing either route codec; corrected methods accepted",
                sourceMaintenance:
                    "type imports and annotations; no footer block or rewrites on codec-only changes",
                devWatcher: "updated params and query declarations without a command or reload",
                updateMs,
                updateSamplesMs,
                pollIntervalMs: 1,
                repeatedWrites: false,
            },
            null,
            2,
        ),
    );
    console.log(`Native vp check and live dev watcher passed (${updateMs} ms update).`);
} finally {
    await server?.close();
    fs.rmSync(root, { recursive: true, force: true });
}
