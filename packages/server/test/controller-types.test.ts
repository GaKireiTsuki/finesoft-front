import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
    createControllerTypeWatcher,
    generateControllerTypes,
    releaseControllerTypes,
} from "../src/controller-types";
import { finesoftFrontViteConfig } from "../src/vite-plugin";

// These fixtures build real TypeScript programs. Cold compilation with coverage
// exceeds 15 seconds on hosted CI runners while other suites are running.
vi.setConfig({ testTimeout: 30_000 });

const roots: string[] = [];
const watchers: ReturnType<typeof createControllerTypeWatcher>[] = [];
afterEach(() => {
    for (const watcher of watchers.splice(0)) watcher.close();
    for (const root of roots.splice(0)) {
        releaseControllerTypes(root);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
function watch(root: string) {
    const watcher = createControllerTypeWatcher({ root });
    watchers.push(watcher);
    return watcher;
}
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "front-controller-types-")));
    roots.push(root);
    fs.mkdirSync(path.join(root, "src"));
    fs.symlinkSync(
        fileURLToPath(new URL("../../../templates/react/node_modules", import.meta.url)),
        path.join(root, "node_modules"),
        "dir",
    );
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                target: "ESNext",
                module: "ESNext",
                moduleResolution: "bundler",
                skipLibCheck: true,
                noEmit: true,
                types: [],
                paths: {
                    "@finesoft/front": [
                        fileURLToPath(new URL("../../front/src/portable.ts", import.meta.url)),
                    ],
                    "@finesoft/browser": [
                        fileURLToPath(new URL("../../browser/src/index.ts", import.meta.url)),
                    ],
                    "@finesoft/ssr": [
                        fileURLToPath(new URL("../../ssr/src/index.ts", import.meta.url)),
                    ],
                    "@finesoft/server/*": [
                        fileURLToPath(new URL("../../server/src/*", import.meta.url)),
                    ],
                    "@finesoft/ssr/inject": [
                        fileURLToPath(new URL("../../ssr/src/inject.ts", import.meta.url)),
                    ],
                    "@finesoft/core": [
                        fileURLToPath(new URL("../../core/src/index.ts", import.meta.url)),
                    ],
                    "@finesoft/web": [
                        fileURLToPath(new URL("../../web/src/index.ts", import.meta.url)),
                    ],
                },
            },
            include: ["src"],
        }),
    );
    const controller = path.join(root, "src/item.ts");
    fs.writeFileSync(
        controller,
        `import { BaseController } from "@finesoft/front";
interface ItemPage { id: string; pageType: "item"; title: string; }
export class ItemController extends BaseController {
    execute({params, context}): ItemPage {
        return {id: params.id.toFixed(), pageType: "item", title: String(context.signal.aborted)};
    }
    fallback({params, error}): ItemPage {
        return {id: params.id.toFixed(), pageType: "item", title: error.message};
    }
}
`,
    );
    const definition = path.join(root, "src/app.ts");
    fs.writeFileSync(
        definition,
        `import { definePage, int, optional, str } from "@finesoft/front";
import { ItemController } from "./item";
export const item = definePage({id: "item", routes: [{path: "/items/:id", params: {id: int()}, query: {tab: optional(str())}}], create: () => new ItemController()});
`,
    );
    return {
        root,
        controller,
        definition,
        output: path.join(root, ".finesoft/controller-types.d.ts"),
    };
}
function diagnostics(root: string) {
    const file = path.join(root, "tsconfig.json");
    const config = ts.readConfigFile(file, (file) => ts.sys.readFile(file));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    return ts
        .getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options))
        .map((error) => ({
            code: error.code,
            message: ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        }));
}

test("server controllers infer server request and cookie capabilities while shared controllers get page metadata", () => {
    const f = fixture();
    fs.writeFileSync(
        f.controller,
        fs
            .readFileSync(f.controller, "utf8")
            .replace(
                'import { BaseController } from "@finesoft/front";',
                'import { BaseServerController } from "@finesoft/front";',
            )
            .replace("extends BaseController", "extends BaseServerController")
            .replace(
                "String(context.signal.aborted)",
                'context.request.url + context.path + context.getCookie("session")',
            ),
    );
    generateControllerTypes({ root: f.root });
    expect(fs.readFileSync(f.output, "utf8")).toContain(
        'import("@finesoft/front").ServerControllerContext',
    );
    expect(diagnostics(f.root)).toEqual([]);
    fs.writeFileSync(
        f.controller,
        fs
            .readFileSync(f.controller, "utf8")
            .replace(
                'import { BaseServerController } from "@finesoft/front";',
                'import { BaseController } from "@finesoft/front";',
            )
            .replace("extends BaseServerController", "extends BaseController")
            .replace("context.request.url + context.path", "context.url + context.path"),
    );
    generateControllerTypes({ root: f.root });
    expect(fs.readFileSync(f.output, "utf8")).toContain(
        'import("@finesoft/front").ControllerContext',
    );
    expect(diagnostics(f.root)).toEqual([]);
});

test("independent class inputs derive from routes and generation is idempotent", () => {
    const app = fixture();
    expect(generateControllerTypes({ root: app.root }).controllers).toBe(1);
    const source = fs.readFileSync(app.controller, "utf8");
    expect(source).toContain("execute({params, context}: Input)");
    expect(source).toContain("fallback({params, error}: Failure)");
    expect(source).toContain("extends BaseController<Input, ItemPage>");
    expect(source).toContain("import type {");
    expect(source).toContain("ItemControllerInput as Input");
    expect(source).not.toContain("@finesoft/controller-types");
    expect(source).not.toContain("__Front");
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
    expect(fs.readFileSync(app.output, "utf8")).toMatch(/tab\?: (?:undefined \| )?string/);
    expect(diagnostics(app.root)).toEqual([]);
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
});

test("codec changes update generated types and expose invalid method usage", () => {
    const app = fixture();
    generateControllerTypes({ root: app.root });
    const source = fs.readFileSync(app.controller, "utf8");
    fs.writeFileSync(
        app.definition,
        fs.readFileSync(app.definition, "utf8").replace("id: int()", "id: str()"),
    );
    expect(generateControllerTypes({ root: app.root }).changed).toContain(app.output);
    expect(fs.readFileSync(app.controller, "utf8")).toBe(source);
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
    expect(diagnostics(app.root).filter((error) => error.message.includes("toFixed"))).toHaveLength(
        2,
    );
});

test("async controllers generate compact contracts with typed direct calls", () => {
    const app = fixture();
    fs.writeFileSync(
        app.controller,
        fs
            .readFileSync(app.controller, "utf8")
            .replace(
                "execute({params, context}): ItemPage",
                "async execute({params, context}): Promise<ItemPage>",
            ) +
            `\nimport type {ExecutionContext} from "@finesoft/front";
declare const context: ExecutionContext;
const controller = new ItemController();
const result: Promise<ItemPage> = controller.perform({id:42}, context, {tab:"details"});
// @ts-expect-error wrong params
controller.perform({id:"42"}, context);
// @ts-expect-error wrong query
controller.perform({id:42}, context, {tab:42});
// @ts-expect-error preserved return type
const wrong: Promise<string> = result;
`,
    );
    generateControllerTypes({ root: app.root });
    const source = fs.readFileSync(app.controller, "utf8");
    expect(source).toContain("extends BaseController<Input, ItemPage>");
    expect(source).not.toContain("__Front");
    expect(source).not.toContain("Awaited<Promise");
    expect(diagnostics(app.root)).toEqual([]);
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
});

test("short imports avoid business names and keep multiple controllers distinct", () => {
    const app = fixture();
    fs.appendFileSync(
        app.controller,
        `
export interface Input { value: string; }
export interface Failure { reason: string; }
export interface ItemControllerInput { custom: boolean; }
export class OtherController extends BaseController {
    execute({params}): ItemPage {return {id:params.name.toUpperCase(),pageType:"item",title:"Other"}}
}
`,
    );
    fs.appendFileSync(
        app.definition,
        '\nimport {OtherController} from "./item";\nexport const other = definePage({id:"other",routes:["/other/:name"],create:()=>new OtherController()});\n',
    );
    generateControllerTypes({ root: app.root });
    const source = fs.readFileSync(app.controller, "utf8");
    expect(source).toContain("ItemControllerInput as ItemControllerInput2");
    expect(source).toContain("extends BaseController<ItemControllerInput2, ItemPage>");
    expect(source).toContain("extends BaseController<OtherControllerInput, ItemPage>");
    expect(diagnostics(app.root)).toEqual([]);
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
    // Re-analysis must also preserve the chosen aliases, not just the unchanged-files fast path.
    fs.appendFileSync(app.definition, "\n// saved\n");
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
    expect(fs.readFileSync(app.controller, "utf8")).toBe(source);
});

test("adding a controller preserves existing aliases used by business helpers", () => {
    const app = fixture();
    generateControllerTypes({ root: app.root });
    fs.appendFileSync(
        app.controller,
        `
export const describeInput = (input: Input) => input.params.id.toFixed();
export class OtherController extends BaseController {
    execute({params}): ItemPage {return {id:params.name.toUpperCase(),pageType:"item",title:"Other"}}
}
`,
    );
    fs.appendFileSync(
        app.definition,
        '\nimport {OtherController} from "./item";\nexport const other = definePage({id:"other",routes:["/other/:name"],create:()=>new OtherController()});\n',
    );
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.controller, "utf8")).toContain("ItemControllerInput as Input");
    expect(diagnostics(app.root)).toEqual([]);
    fs.appendFileSync(app.definition, "\n// re-analyse\n");
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
});

test("manual generated-type imports are preserved alongside managed imports", () => {
    const app = fixture();
    fs.writeFileSync(
        path.join(app.root, "src/other.ts"),
        fs
            .readFileSync(app.controller, "utf8")
            .replaceAll("ItemController", "OtherController")
            .replaceAll("params.id.toFixed()", "params.slug.toUpperCase()"),
    );
    fs.appendFileSync(
        app.definition,
        '\nimport {OtherController} from "./other";\nexport const other = definePage({id:"other",routes:["/other/:slug"],create:()=>new OtherController()});\n',
    );
    generateControllerTypes({ root: app.root });
    fs.appendFileSync(
        app.controller,
        `
import type { OtherControllerInput as OtherInput, ItemControllerInput as MyInput } from "../.finesoft/controller-types";
export const otherId = (input: OtherInput) => input.params.slug.toUpperCase();
export const ownId = (input: MyInput) => input.params.id.toFixed();
`,
    );
    generateControllerTypes({ root: app.root });
    const source = fs.readFileSync(app.controller, "utf8");
    expect(source).toContain("OtherControllerInput as OtherInput");
    expect(source).toContain("ItemControllerInput as MyInput");
    expect(source).toContain("ItemControllerInput as Input");
    expect(diagnostics(app.root)).toEqual([]);
    fs.appendFileSync(app.definition, "\n// re-analyse\n");
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
});

test("retained analysis follows imported params and query schema edits", () => {
    const app = fixture();
    const schema = path.join(app.root, "src/schema.ts");
    fs.writeFileSync(
        schema,
        'import {int,str} from "@finesoft/front"; export const idSchema = int(); export const tabSchema = str();',
    );
    fs.writeFileSync(
        app.definition,
        'import {idSchema,tabSchema} from "./schema";\n' +
            fs
                .readFileSync(app.definition, "utf8")
                .replace("id: int()", "id: idSchema")
                .replace("optional(str())", "optional(tabSchema)"),
    );
    generateControllerTypes({ root: app.root });
    const controller = fs.readFileSync(app.controller, "utf8");
    fs.writeFileSync(
        schema,
        'import {int,str} from "@finesoft/front"; export const idSchema = str(); export const tabSchema = int();',
    );
    generateControllerTypes({ root: app.root });
    const result = fs.readFileSync(app.output, "utf8");
    expect(result).toContain("id: string");
    expect(result).toMatch(/tab\?: (?:undefined \| )?number/);
    expect(fs.readFileSync(app.controller, "utf8")).toBe(controller);
    expect(diagnostics(app.root).filter((error) => error.message.includes("toFixed"))).toHaveLength(
        2,
    );
});

test("retained analysis resolves changed config paths and newly added controllers", () => {
    const app = fixture();
    fs.writeFileSync(
        path.join(app.root, "src/number.ts"),
        'export {int as codec} from "@finesoft/front";',
    );
    fs.writeFileSync(
        path.join(app.root, "src/string.ts"),
        'export {str as codec} from "@finesoft/front";',
    );
    fs.writeFileSync(
        app.definition,
        'import {codec} from "schema-codec";\n' +
            fs.readFileSync(app.definition, "utf8").replace("id: int()", "id: codec()"),
    );
    const configFile = path.join(app.root, "tsconfig.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    config.compilerOptions.paths["schema-codec"] = ["./src/number.ts"];
    fs.writeFileSync(configFile, JSON.stringify(config));
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
    config.compilerOptions.paths["schema-codec"] = ["./src/string.ts"];
    fs.writeFileSync(configFile, JSON.stringify(config));
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
    fs.appendFileSync(
        app.definition,
        '\nimport {ExtraController} from "./extra"; export const extra = definePage({id:"extra",routes:["/extra/:name"],create:()=>new ExtraController()});\n',
    );
    generateControllerTypes({ root: app.root });
    fs.writeFileSync(
        path.join(app.root, "src/extra.ts"),
        'import {BaseController} from "@finesoft/front"; export class ExtraController extends BaseController { execute({params}): {id:string;pageType:"extra";title:string} {return {id:params.name.toUpperCase(),pageType:"extra",title:"Extra"}} }',
    );
    expect(generateControllerTypes({ root: app.root }).controllers).toBe(2);
    expect(fs.readFileSync(app.output, "utf8")).toContain("name: string");
});

test("resolution snapshots preserve import modes and refresh changed package exports", () => {
    const app = fixture();
    const dependency = path.join(app.root, "src/node_modules/schema-codec");
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(
        path.join(dependency, "number.d.mts"),
        'export {int as codec} from "@finesoft/front";',
    );
    fs.writeFileSync(
        path.join(dependency, "string.d.cts"),
        'export {str as codec} from "@finesoft/front";',
    );
    const manifest = path.join(dependency, "package.json");
    const metadata = {
        name: "schema-codec",
        version: "1.0.0",
        exports: { import: "./number.d.mts", require: "./string.d.cts" },
    };
    fs.writeFileSync(manifest, JSON.stringify(metadata));
    const configFile = path.join(app.root, "tsconfig.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    config.compilerOptions.module = "preserve";
    fs.writeFileSync(configFile, JSON.stringify(config));
    fs.writeFileSync(
        app.definition,
        'import {codec} from "schema-codec";\nimport required = require("schema-codec");\n' +
            fs
                .readFileSync(app.definition, "utf8")
                .replace("id: int()", "id: codec()")
                .replace("optional(str())", "required.codec()"),
    );
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
    expect(fs.readFileSync(app.output, "utf8")).toContain("tab: string");
    expect(diagnostics(app.root)).toEqual([]);

    metadata.exports.import = "./string.d.cts";
    metadata.exports.require = "./number.d.mts";
    fs.writeFileSync(manifest, JSON.stringify(metadata));
    expect(generateControllerTypes({ root: app.root }).changed).toContain(app.output);
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
    expect(fs.readFileSync(app.output, "utf8")).toContain("tab: number");
});

test("analysis recreates deleted declarations and resolves replacement schema files", () => {
    const app = fixture();
    const schema = path.join(app.root, "src/schema.ts");
    const declarations = path.join(app.root, "src/schema.d.ts");
    fs.writeFileSync(schema, 'export {int as codec} from "@finesoft/front";');
    fs.writeFileSync(
        app.definition,
        'import {codec} from "./schema";\n' +
            fs.readFileSync(app.definition, "utf8").replace("id: int()", "id: codec()"),
    );
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
    fs.rmSync(app.output);
    fs.rmSync(schema);
    fs.writeFileSync(declarations, 'export {str as codec} from "@finesoft/front";');
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
    expect(diagnostics(app.root).filter((error) => error.message.includes("toFixed"))).toHaveLength(
        2,
    );
});

test("syntax errors leave generated types intact and a corrected save refreshes them", () => {
    const app = fixture();
    generateControllerTypes({ root: app.root });
    const original = fs.readFileSync(app.definition, "utf8");
    const generated = fs.readFileSync(app.output, "utf8");
    fs.writeFileSync(app.definition, original + "\nconst unfinished = ;");
    expect(() => generateControllerTypes({ root: app.root })).toThrow("syntax");
    expect(fs.readFileSync(app.output, "utf8")).toBe(generated);
    fs.writeFileSync(app.definition, original.replace("id: int()", "id: str()"));
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
});

test("a save arriving during analysis is not hidden by the unchanged-input cache", () => {
    const app = fixture();
    generateControllerTypes({ root: app.root });
    const original = fs.readFileSync(app.definition, "utf8");
    fs.writeFileSync(app.definition, original.replace("id: int()", "id: str()"));
    const write = fs.writeFileSync;
    let saved = false;
    const intercepted = vi
        .spyOn(fs, "writeFileSync")
        .mockImplementation((...args: Parameters<typeof write>) => {
            write(...args);
            if (!saved && String(args[0]) === app.output) {
                saved = true;
                write(app.definition, original);
            }
        });
    try {
        generateControllerTypes({ root: app.root });
    } finally {
        intercepted.mockRestore();
    }
    expect(saved).toBe(true);
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
});

test("watch cache handles duplicate saves and reuses previously verified route versions", () => {
    const app = fixture();
    const watcher = watch(app.root);
    const original = fs.readFileSync(app.definition, "utf8");
    expect(watcher.update([app.definition], true)?.cache).toBe("unchanged");
    const before = fs.statSync(app.definition);
    fs.writeFileSync(app.definition, original.replace("id: int()", "id: str()"));
    fs.utimesSync(app.definition, before.atime, before.mtime);
    expect(watcher.update([app.definition], true)).toBeUndefined();
    expect(watcher.update([app.definition])?.cache).toBe("generated");
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
    fs.writeFileSync(app.definition, original);
    expect(watcher.update([app.definition], true)?.cache).toBe("reused");
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
    expect(diagnostics(app.root)).toEqual([]);
    fs.rmSync(app.output);
    expect(watcher.update([app.definition], true)).toBeUndefined();
    watcher.update([app.definition]);
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
});

test("watch cache invalidates imported schemas and accounts for every file in a save burst", () => {
    const app = fixture();
    const schema = path.join(app.root, "src/schema.ts");
    fs.writeFileSync(schema, 'export {int as codec} from "@finesoft/front";');
    fs.writeFileSync(
        app.definition,
        'import {codec} from "./schema";\n' +
            fs.readFileSync(app.definition, "utf8").replace("id: int()", "id: codec()"),
    );
    const watcher = watch(app.root);
    const original = fs.readFileSync(app.definition, "utf8");
    const changed = original.replace("optional(str())", "int()");
    fs.writeFileSync(app.definition, changed);
    watcher.update([app.definition]);
    fs.writeFileSync(app.definition, original);
    expect(watcher.update([app.definition], true)?.cache).toBe("reused");
    fs.writeFileSync(app.definition, changed);
    fs.writeFileSync(schema, 'export {str as codec} from "@finesoft/front";');
    expect(watcher.update([app.definition, schema], true)).toBeUndefined();
    watcher.update([app.definition, schema]);
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
    expect(fs.readFileSync(app.output, "utf8")).toContain("tab: number");
});

test("watch cache preserves the latest contract when a controller becomes unregistered", () => {
    const app = fixture();
    const watcher = watch(app.root);
    const original = fs.readFileSync(app.definition, "utf8");
    fs.writeFileSync(app.definition, "export {};\n");
    watcher.update([app.definition]);
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
    fs.writeFileSync(app.definition, original.replace("id: int()", "id: str()"));
    watcher.update([app.definition]);
    fs.writeFileSync(app.definition, "export {};\n");
    expect(watcher.update([app.definition], true)).toBeUndefined();
    watcher.update([app.definition]);
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
});

test("cached output cannot overwrite unowned declarations or follow a dangling output symlink", () => {
    const app = fixture();
    const sibling = fixture();
    const watcher = watch(app.root);
    const original = fs.readFileSync(app.definition, "utf8");
    fs.writeFileSync(app.definition, original.replace("id: int()", "id: str()"));
    watcher.update([app.definition]);
    fs.writeFileSync(app.definition, original);
    fs.writeFileSync(app.output, "");
    expect(() => watcher.update([app.definition])).toThrow("unowned");
    fs.rmSync(app.output);
    const outside = path.join(sibling.root, "outside.d.ts");
    fs.symlinkSync(outside, app.output);
    expect(() => watcher.update([app.definition])).toThrow("cannot edit outside");
    expect(fs.existsSync(outside)).toBe(false);
});

test("watch cache records analyzed inputs instead of a save arriving during output writing", () => {
    const app = fixture();
    const watcher = watch(app.root);
    const original = fs.readFileSync(app.definition, "utf8");
    fs.writeFileSync(app.definition, original.replace("id: int()", "id: str()"));
    const write = fs.writeFileSync;
    const intercepted = vi
        .spyOn(fs, "writeFileSync")
        .mockImplementation((...args: Parameters<typeof write>) => {
            write(...args);
            if (String(args[0]) === app.output) write(app.definition, original);
        });
    try {
        watcher.update([app.definition]);
    } finally {
        intercepted.mockRestore();
    }
    expect(watcher.update([app.definition], true)?.cache).toBe("reused");
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
});

test("native type watchers observe node_modules schemas and release their subscriptions", async () => {
    const app = fixture();
    const dependency = path.join(app.root, "src/node_modules/schema-codec");
    fs.mkdirSync(dependency, { recursive: true });
    const schema = path.join(dependency, "index.d.ts");
    fs.writeFileSync(schema, 'export {int as codec} from "@finesoft/front";');
    fs.writeFileSync(
        app.definition,
        'import {codec} from "schema-codec";\n' +
            fs.readFileSync(app.definition, "utf8").replace("id: int()", "id: codec()"),
    );
    const watcher = watch(app.root);
    const events: string[] = [];
    watcher.watch((file) => {
        events.push(file);
        watcher.update([file]);
    });
    fs.writeFileSync(schema, 'export {str as codec} from "@finesoft/front";');
    await vi.waitFor(() => expect(fs.readFileSync(app.output, "utf8")).toContain("id: string"), {
        timeout: 3000,
        interval: 10,
    });
    expect(events).toContain(schema);
    // A new source file takes precedence over the previously resolved declaration file.
    const replacement = path.join(dependency, "index.ts");
    fs.writeFileSync(replacement, 'export {int as codec} from "@finesoft/front";');
    await vi.waitFor(() => expect(fs.readFileSync(app.output, "utf8")).toContain("id: number"), {
        timeout: 3000,
        interval: 10,
    });
    expect(events).toContain(replacement);
    watcher.close();
    const generated = fs.readFileSync(app.output, "utf8");
    const count = events.length;
    fs.writeFileSync(replacement, 'export {str as codec} from "@finesoft/front";');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toHaveLength(count);
    expect(fs.readFileSync(app.output, "utf8")).toBe(generated);
});

test("dev watcher batches a save burst and cancels pending generation on close", async () => {
    const app = fixture();
    const listeners = new Set<(event: string, file: string) => void>();
    const errors: string[] = [];
    const server = {
        watcher: {
            on(_event: string, listener: (event: string, file: string) => void) {
                listeners.add(listener);
            },
            off(_event: string, listener: (event: string, file: string) => void) {
                listeners.delete(listener);
            },
        },
        config: { logger: { error: (message: string) => errors.push(message) } },
        close: async () => {},
    };
    const plugin = finesoftFrontViteConfig({ controllerTypes: { root: app.root } });
    plugin.configureServer(server);
    const original = fs.readFileSync(app.definition, "utf8");
    const saved = fs.readFileSync(app.output, "utf8");
    const change = (source: string) => {
        fs.writeFileSync(app.definition, source);
        for (const listener of listeners) listener("change", app.definition);
    };
    vi.useFakeTimers();
    try {
        change(original + "\nconst unfinished = ;");
        await vi.advanceTimersByTimeAsync(10);
        change(original.replace("id: int()", "id: str()"));
        await vi.advanceTimersByTimeAsync(20);
        expect(fs.readFileSync(app.output, "utf8")).toBe(saved);
        await vi.advanceTimersByTimeAsync(10);
        expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
        expect(errors).toEqual([]);
        change(original);
        // Previously verified types are restored immediately, without the debounce delay.
        expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
        const restored = fs.readFileSync(app.output, "utf8");
        change(original.replace("optional(str())", "int()"));
        await server.close();
        await vi.advanceTimersByTimeAsync(100);
        expect(fs.readFileSync(app.output, "utf8")).toBe(restored);
        expect(listeners.size).toBe(0);
    } finally {
        await server.close();
        vi.useRealTimers();
    }
});

test("dev type subscriptions stop before asynchronous server shutdown completes", async () => {
    const app = fixture();
    let finish!: () => void;
    let notify: ts.FileWatcherCallback | undefined;
    const watchFile = ts.sys.watchFile!.bind(ts.sys);
    const intercepted = vi
        .spyOn(ts.sys, "watchFile")
        .mockImplementation((file, callback, ...rest) => {
            if (file === app.definition) notify = callback;
            return watchFile(file, callback, ...rest);
        });
    const server = {
        watcher: { on() {}, off() {} },
        config: { logger: { error: vi.fn() } },
        close: () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    };
    const plugin = finesoftFrontViteConfig({ controllerTypes: { root: app.root } });
    try {
        plugin.configureServer(server);
    } finally {
        intercepted.mockRestore();
    }
    const generated = fs.readFileSync(app.output, "utf8");
    vi.useFakeTimers();
    const closing = server.close();
    try {
        fs.writeFileSync(
            app.definition,
            fs.readFileSync(app.definition, "utf8").replace("id: int()", "id: str()"),
        );
        expect(notify).toBeTypeOf("function");
        notify!(app.definition, ts.FileWatcherEventKind.Changed);
        await vi.advanceTimersByTimeAsync(100);
        expect(fs.readFileSync(app.output, "utf8")).toBe(generated);
    } finally {
        finish();
        await closing;
        vi.useRealTimers();
    }
});

test("controllers with identical class names in different files retain distinct imported types", () => {
    const app = fixture();
    const other = path.join(app.root, "src/other.ts");
    fs.writeFileSync(
        other,
        fs
            .readFileSync(app.controller, "utf8")
            .replaceAll("params.id.toFixed()", "params.slug.toUpperCase()"),
    );
    fs.appendFileSync(
        app.definition,
        '\nimport {ItemController as OtherController} from "./other";\nexport const other = definePage({id:"other",routes:["/other/:slug"],create:()=>new OtherController()});\n',
    );
    expect(generateControllerTypes({ root: app.root }).controllers).toBe(2);
    expect(diagnostics(app.root)).toEqual([]);
    expect(fs.readFileSync(app.controller, "utf8")).not.toContain("@finesoft/controller-types");
    expect(fs.readFileSync(other, "utf8")).not.toContain("@finesoft/controller-types");
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
});

test("query defaults and lists update both execute and fallback without source declarations", () => {
    const app = fixture();
    fs.writeFileSync(
        app.definition,
        fs
            .readFileSync(app.definition, "utf8")
            .replace("optional, str", "optional, str, list, withDefault")
            .replace(
                "tab: optional(str())",
                'tab: optional(str()), q: withDefault(str(), ""), ids: optional(list(int()))',
            ),
    );
    fs.writeFileSync(
        app.controller,
        fs
            .readFileSync(app.controller, "utf8")
            .replaceAll("{params, context}", "{params, query, context}")
            .replaceAll("{params, error}", "{params, query, error}")
            .replaceAll(
                "params.id.toFixed()",
                'query.q.toUpperCase() + (query.ids?.map(id => id.toFixed()).join(",") ?? "")',
            ),
    );
    generateControllerTypes({ root: app.root });
    expect(diagnostics(app.root)).toEqual([]);
    const source = fs.readFileSync(app.controller, "utf8");
    expect(source).not.toContain("@finesoft/controller-types");
    fs.writeFileSync(
        app.definition,
        fs.readFileSync(app.definition, "utf8").replace("list(int())", "list(str())"),
    );
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.controller, "utf8")).toBe(source);
    expect(diagnostics(app.root).filter((error) => error.message.includes("toFixed"))).toHaveLength(
        2,
    );
});

test("shared controllers receive all registered route inputs without executing modules", () => {
    const app = fixture();
    fs.appendFileSync(
        app.definition,
        '\nexport const alias = definePage({id:"alias",routes:["/alias/:name"],create:()=>new ItemController()});\nthrow new Error("Do not execute definitions");\n',
    );
    expect(generateControllerTypes({ root: app.root }).controllers).toBe(1);
    const output = fs.readFileSync(app.output, "utf8");
    expect(output).toContain("id: number");
    expect(output).toContain("name: string");
    expect(diagnostics(app.root).some((error) => error.code === 2339)).toBe(true);
});

test("explicit method annotations are preserved", () => {
    const app = fixture();
    const source = fs
        .readFileSync(app.controller, "utf8")
        .replace(
            "extends BaseController",
            'extends BaseController<import("@finesoft/front").ControllerInput<{id:number}>, ItemPage>',
        )
        .replace(
            "execute({params, context})",
            'execute({params, context}: import("@finesoft/front").ControllerInput<{id:number}>)',
        )
        .replace(
            "fallback({params, error})",
            'fallback({params, error}: import("@finesoft/front").ControllerFailure<{id:number}>)',
        );
    fs.writeFileSync(app.controller, source);
    expect(generateControllerTypes({ root: app.root }).controllers).toBe(0);
    expect(fs.readFileSync(app.controller, "utf8")).toBe(source);
    expect(fs.existsSync(app.output)).toBe(false);
});

test("editor completions follow route field names and compiler types", () => {
    const app = fixture();
    fs.writeFileSync(
        app.controller,
        fs
            .readFileSync(app.controller, "utf8")
            .replace("{params, context}", "{params, query, context}")
            .replace(
                "String(context.signal.aborted)",
                "String(context.signal.aborted) + query.tab",
            ),
    );
    generateControllerTypes({ root: app.root });
    const config = ts.readConfigFile(path.join(app.root, "tsconfig.json"), (file) =>
        ts.sys.readFile(file),
    );
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app.root);
    const service = ts.createLanguageService({
        ...ts.sys,
        useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
        getCompilationSettings: () => parsed.options,
        getScriptFileNames: () => parsed.fileNames,
        getScriptVersion: (file) => (fs.existsSync(file) ? String(fs.statSync(file).mtimeMs) : "0"),
        getScriptSnapshot: (file) => {
            const text = ts.sys.readFile(file);
            return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
        },
        getCurrentDirectory: () => app.root,
        getDefaultLibFileName: ts.getDefaultLibFilePath,
    });
    try {
        const position =
            fs.readFileSync(app.controller, "utf8").indexOf("params.id") + "params.".length;
        expect(
            service
                .getCompletionsAtPosition(app.controller, position, {})
                ?.entries.map((entry) => entry.name),
        ).toEqual(expect.arrayContaining(["id"]));
        expect(
            service
                .getCompletionsAtPosition(app.controller, position, {})
                ?.entries.map((entry) => entry.name),
        ).not.toContain("tab");
        const queryPosition =
            fs.readFileSync(app.controller, "utf8").indexOf("query.tab") + "query.".length;
        expect(
            service
                .getCompletionsAtPosition(app.controller, queryPosition, {})
                ?.entries.map((entry) => entry.name),
        ).toContain("tab");
        expect(
            ts.displayPartsToString(
                service.getQuickInfoAtPosition(app.controller, queryPosition)?.displayParts,
            ),
        ).toContain("string | undefined");
        expect(
            ts.displayPartsToString(
                service.getQuickInfoAtPosition(app.controller, position)?.displayParts,
            ),
        ).toContain("id: number");
        fs.writeFileSync(
            app.definition,
            fs
                .readFileSync(app.definition, "utf8")
                .replaceAll(":id", ":ids")
                .replace("id: int()", "ids: int()"),
        );
        generateControllerTypes({ root: app.root });
        const names = service
            .getCompletionsAtPosition(app.controller, position, {})
            ?.entries.map((entry) => entry.name);
        expect(names).toContain("ids");
        expect(names).not.toContain("id");
        expect(service.getSemanticDiagnostics(app.controller)).toHaveLength(2);
    } finally {
        service.dispose();
    }
});

test("formatted managed declarations are preserved across source updates", () => {
    const app = fixture();
    generateControllerTypes({ root: app.root });
    for (const file of [app.controller, app.output])
        fs.writeFileSync(
            file,
            fs
                .readFileSync(file, "utf8")
                .replaceAll(" = import(", " =\n    import(")
                .replace(
                    /import type \{ ([^}]+) \}/g,
                    (_, specifiers: string) =>
                        `import type {\n    ${specifiers.split(", ").join(",\n    ")},\n}`,
                )
                .replaceAll("    ", "  "),
        );
    fs.appendFileSync(app.definition, "\n// Re-evaluate after an unrelated edit.\n");
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
    releaseControllerTypes(app.root);
    expect(generateControllerTypes({ root: app.root }).changed).toEqual([]);
});

test("imported schema outputs keep same-named path and query fields separate", () => {
    const app = fixture();
    fs.writeFileSync(
        path.join(app.root, "src/schemas.ts"),
        `import { int, optional, str } from "@finesoft/front";
export const routes = [{path: "/items/:id", params:{id:int()}, query:{id:str(), tab:optional(str())}}] as const;`,
    );
    fs.writeFileSync(
        app.definition,
        `import { definePage } from "@finesoft/front";
import { routes } from "./schemas";
import { ItemController } from "./item";
export const page = definePage({id:"item", routes, create:()=>new ItemController()});`,
    );
    generateControllerTypes({ root: app.root });
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: string");
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
    expect(fs.readFileSync(app.output, "utf8")).toMatch(/tab\?: (?:undefined \| )?string/);
    expect(diagnostics(app.root)).toEqual([]);
});

test("unrelated definePage functions do not opt classes into generation", () => {
    const app = fixture();
    fs.writeFileSync(
        app.definition,
        fs.readFileSync(app.definition, "utf8").replace("definePage, int", "int") +
            "\nfunction definePage(value: unknown) {return value;}\n",
    );
    expect(generateControllerTypes({ root: app.root }).controllers).toBe(0);
    expect(fs.existsSync(app.output)).toBe(false);
});

test("named third-party schema outputs remain resolvable in generated declarations", () => {
    const app = fixture();
    fs.writeFileSync(
        path.join(app.root, "src/schema.ts"),
        `import type { StandardSchemaV1 } from "@finesoft/front";
export interface ProductId { readonly value: number; }
export const idSchema: StandardSchemaV1<string, ProductId> = {"~standard": {version:1, vendor:"fixture", validate: value => ({value: {value:Number(value)}})}};
`,
    );
    fs.writeFileSync(
        app.definition,
        'import {idSchema} from "./schema";\n' +
            fs.readFileSync(app.definition, "utf8").replace("id: int()", "id: idSchema"),
    );
    fs.writeFileSync(
        app.controller,
        fs
            .readFileSync(app.controller, "utf8")
            .replaceAll("params.id.toFixed()", "params.id.value.toFixed()"),
    );
    generateControllerTypes({ root: app.root });
    expect(diagnostics(app.root)).toEqual([]);
    expect(fs.readFileSync(app.output, "utf8")).toContain("idSchema");
});

test("unowned declarations and invalid source never cause partial source writes", () => {
    const app = fixture();
    const source = fs.readFileSync(app.controller, "utf8");
    fs.mkdirSync(path.dirname(app.output));
    fs.writeFileSync(app.output, "export interface Mine {}\n");
    expect(() => generateControllerTypes({ root: app.root })).toThrow("unowned");
    expect(fs.readFileSync(app.controller, "utf8")).toBe(source);
    fs.rmSync(app.output);
    fs.appendFileSync(app.definition, "\nconst broken = ;");
    expect(() => generateControllerTypes({ root: app.root })).toThrow("syntax");
    expect(fs.readFileSync(app.controller, "utf8")).toBe(source);
});

test("removing registrations retains the last contract of existing managed classes", () => {
    const app = fixture();
    fs.appendFileSync(
        app.controller,
        '\nexport class OtherController extends BaseController { execute({params}): ItemPage {return {id:params.name.toUpperCase(),pageType:"item",title:"Other"}}}\n',
    );
    fs.appendFileSync(
        app.definition,
        '\nimport {OtherController} from "./item";\nexport const other = definePage({id:"other",routes:["/other/:name"],create:()=>new OtherController()});\n',
    );
    generateControllerTypes({ root: app.root });
    expect(diagnostics(app.root)).toEqual([]);
    fs.writeFileSync(
        app.definition,
        fs.readFileSync(app.definition, "utf8").replace(/export const other =.*\n/, ""),
    );
    generateControllerTypes({ root: app.root });
    expect(diagnostics(app.root)).toEqual([]);
    fs.writeFileSync(app.definition, "export {};\n");
    generateControllerTypes({ root: app.root });
    expect(diagnostics(app.root)).toEqual([]);
});

test("private nominal schema outputs retain their identity through public schema references", () => {
    const app = fixture();
    fs.writeFileSync(
        path.join(app.root, "src/schema.ts"),
        `import type {StandardSchemaV1} from "@finesoft/front";
class PrivateId {private brand!: void; constructor(readonly value:number) {}}
export const idSchema: StandardSchemaV1<string,PrivateId> = {"~standard":{version:1,vendor:"fixture",validate: value=>({value:new PrivateId(Number(value))})}};
export function acceptId(value:PrivateId) {return value.value;}
`,
    );
    fs.writeFileSync(
        app.definition,
        'import {idSchema} from "./schema";\n' +
            fs.readFileSync(app.definition, "utf8").replace("id: int()", "id: idSchema"),
    );
    fs.writeFileSync(
        app.controller,
        'import {acceptId} from "./schema";\n' +
            fs
                .readFileSync(app.controller, "utf8")
                .replaceAll("params.id.toFixed()", "acceptId(params.id).toFixed()"),
    );
    generateControllerTypes({ root: app.root });
    expect(diagnostics(app.root)).toEqual([]);
});

test("solution tsconfig follows the referenced application project", () => {
    const app = fixture();
    fs.renameSync(path.join(app.root, "tsconfig.json"), path.join(app.root, "tsconfig.app.json"));
    fs.writeFileSync(
        path.join(app.root, "tsconfig.json"),
        JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
    );
    expect(generateControllerTypes({ root: app.root }).controllers).toBe(1);
    expect(fs.readFileSync(app.output, "utf8")).toContain("id: number");
});

test("shared configs do not pull unrelated applications into controller generation", () => {
    const app = fixture();
    const sibling = fixture();
    fs.appendFileSync(sibling.controller, "\nconst broken = ;\n");
    const configFile = path.join(app.root, "tsconfig.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    config.include.push(`${sibling.root}/src`);
    fs.writeFileSync(configFile, JSON.stringify(config));
    expect(generateControllerTypes({ root: app.root }).controllers).toBe(1);
    expect(fs.existsSync(sibling.output)).toBe(false);
    expect(fs.readFileSync(sibling.controller, "utf8")).toContain("const broken = ;");
});
