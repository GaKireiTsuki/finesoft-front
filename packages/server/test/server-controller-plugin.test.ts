import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { build, createLogger, createServer } from "vite-plus";
import { serverControllerModules } from "../src/server-controller-plugin";
import { finesoftFrontViteConfig } from "../src/vite-plugin";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "front-server-controller-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.symlinkSync(
        fileURLToPath(new URL("../../../templates/react/node_modules", import.meta.url)),
        path.join(root, "node_modules"),
        "dir",
    );
    for (const [name, code] of Object.entries(files)) fs.writeFileSync(path.join(root, name), code);
    const plugin = serverControllerModules(() => root);
    const context = {
        environment: { config: { consumer: "client" } },
        addWatchFile() {},
        async resolve(id: string, importer: string) {
            return id.startsWith(".")
                ? { id: path.resolve(path.dirname(importer), `${id}.ts`) }
                : null;
        },
    };
    return {
        root,
        plugin,
        context,
        load: (file = "account.ts", ssr = false) =>
            plugin.load(context, path.join(root, file), ssr),
    };
}

const controllerForms = [
    "export const Account = class extends Server { execute(){return secret;} };",
    "const Account = (class extends Server { execute(){return secret;} }); export {Account};",
    "export default (class extends Server { execute(){return secret;} });",
    "export class Account extends (Server) { execute(){return secret;} }",
    "export class Account extends (Server as typeof Server) { execute(){return secret;} }",
    "export class Account extends (Server satisfies typeof Server) { execute(){return secret;} }",
    "export class Account extends (Server!) { execute(){return secret;} }",
    "export default class extends (<typeof Server>Server) { execute(){return secret;} }",
    "const Local = class extends Server { execute(){return secret;} }; const Account = Local; export default (Account);",
];

test.each(controllerForms)(
    "equivalent server controller syntax stays private: %s",
    async (form) => {
        const f = fixture({
            "account.ts": `import {BaseServerController as Server} from "@finesoft/front"; import {secret} from "./private"; ${form}`,
            "private.ts": 'export const secret="SYNTAX_PRIVATE_SENTINEL";',
        });
        await expect(f.load("private.ts?raw")).rejects.toThrow("dependency cannot");
        await expect(f.load("account.ts?raw")).rejects.toThrow("cannot be loaded as an asset");
        const result = await f.load();
        expect(result?.code).toContain("ServerControllerProxy");
        expect(JSON.stringify(result)).not.toMatch(/SYNTAX_PRIVATE_SENTINEL|execute|\.\/private/);
        expect(result?.map.sourcesContent).toEqual([]);
        expect(await f.load("account.ts", true)).toBeNull();
    },
);

test.each([
    "export const Account = ((Base) => class extends Base { execute(){return secret;} })(Server);",
    "const Base = true ? Server : class {}; export class Account extends Base { execute(){return secret;} }",
    "export function create() { return new (class extends Server { execute(){return secret;} })(); }",
])("unsupported dynamic server forms fail closed with their dependencies: %s", async (form) => {
    const f = fixture({
        "account.ts": `import {BaseServerController as Server} from "@finesoft/front"; import {secret} from "./private"; ${form}`,
        "private.ts": 'export const secret="UNSUPPORTED_SECRET";',
    });
    await expect(f.load("private.ts?raw")).rejects.toThrow("dependency cannot");
    await expect(f.load()).rejects.toThrow("Unsupported server controller syntax");
    expect(await f.load("account.ts", true)).toBeNull();
});

test("class-expression bases resolve across exports while controller consumers and pure barrels remain shared", async () => {
    const f = fixture({
        "base.ts":
            'import {BaseServerController} from "@finesoft/front"; export const Parent=class extends BaseServerController {};',
        "barrel.ts": 'export {BaseServerController as Server} from "@finesoft/front";',
        "account.ts":
            'import {Parent} from "./base"; export class Account extends Parent { execute(){return "PRIVATE";} }',
        "consumer.ts": 'import {Account} from "./account"; export const create=()=>new Account();',
        "shared.ts":
            'import {BaseController} from "@finesoft/front"; export class Client extends BaseController {}',
    });
    expect((await f.load())?.code).toContain("Account extends __Proxy");
    expect(await f.load("consumer.ts")).toBeNull();
    expect(await f.load("barrel.ts")).toBeNull();
    expect(await f.load("shared.ts")).toBeNull();
});

test.each([
    "const {BaseServerController: Base} = Front;",
    'const Namespace = Front; const Base = Namespace["BaseServerController"];',
    "const {Front: {BaseServerController: Base}} = {Front};",
    "const [Base] = [Front.BaseServerController];",
    "const Namespace = {...Front}; const Base = Namespace.BaseServerController;",
])("namespace superclass aliases remain private: %s", async (alias) => {
    const f = fixture({
        "account.ts": `import * as Front from "@finesoft/front"; import {secret} from "./private"; ${alias} export class Account extends Base {execute(){return secret;}}`,
        "private.ts": 'export const secret="NAMESPACE_PRIVATE";',
    });
    await expect(f.load("private.ts?raw")).rejects.toThrow("dependency cannot");
    await expect(f.load("account.ts?raw")).rejects.toThrow("cannot be loaded as an asset");
    expect((await f.load())?.code).toContain("Account extends __Proxy");
});

test.each([
    'const key = "BaseServerController"; const Base = Front[key]; export class Account extends Base {execute(){return secret;}}',
    "export const Account = ((api) => class extends api.BaseServerController {execute(){return secret;}})(Front);",
])("opaque namespace use fails closed instead of retaining private code: %s", async (form) => {
    const f = fixture({
        "account.ts": `import * as Front from "@finesoft/front"; import {secret} from "./private"; ${form}`,
        "private.ts": 'export const secret="OPAQUE_NAMESPACE_PRIVATE";',
    });
    await expect(f.load("private.ts?raw")).rejects.toThrow("dependency cannot");
    await expect(f.load()).rejects.toThrow("Unsupported server controller syntax");
});

test.each([
    'import {Front} from "./barrel"; export class Account extends Front.BaseServerController {execute(){return secret;}}',
    'import * as Module from "./barrel"; export class Account extends Module.Front.BaseServerController {execute(){return secret;}}',
])("namespace re-exports cannot hide server inheritance: %s", async (form) => {
    const f = fixture({
        "barrel.ts": 'export * as Front from "@finesoft/front";',
        "account.ts": `import {secret} from "./private"; ${form}`,
        "private.ts": 'export const secret="BARREL_PRIVATE";',
    });
    await expect(f.load("private.ts?raw")).rejects.toThrow("dependency cannot");
    await expect(f.load("account.ts?raw")).rejects.toThrow("cannot be loaded as an asset");
    expect((await f.load())?.code).toContain("Account extends __Proxy");
});

test("browser build output and source maps exclude class-expression implementations and imports", async () => {
    const f = fixture({
        "index.html": '<script type="module" src="/main.ts"></script>',
        "main.ts": 'import {Account} from "./account"; globalThis.controller = new Account();',
        "ssr.ts":
            'export const render = async () => ({ html: "", head: "", css: "", serverData: {} }); export const serializeServerData = JSON.stringify;',
        "account.ts":
            'import {BaseServerController} from "@finesoft/front"; import {secret} from "./private"; export const Account = class extends (BaseServerController) { execute(){return secret;} };',
        "private.ts": 'export const secret="BUILD_PRIVATE_SENTINEL";',
    });
    const result = await build({
        configFile: false,
        root: f.root,
        logLevel: "silent",
        plugins: [finesoftFrontViteConfig({ controllerTypes: false, ssr: { entry: "ssr.ts" } })],
        build: { write: false, sourcemap: true, minify: false },
    });
    const output = JSON.stringify(result);
    expect(output).not.toContain("BUILD_PRIVATE_SENTINEL");
    expect(output).toContain("ServerControllerProxy");
});
test("compiler erases complete server implementation, dependency imports and original source maps", async () => {
    const f = fixture({
        "account.ts": `import { BaseServerController as Server } from "@finesoft/front";
import { secret } from "./private-service";
const password = "SERVER_ONLY_SENTINEL";
export type PublicResult = { title: string };
export class Account extends Server { execute() { return secret(password); } }`,
    });
    const client = await f.load();
    expect(client?.code).toContain("class Account extends __Proxy");
    expect(client?.code).toContain("export { Account }");
    expect(JSON.stringify(client)).not.toMatch(/SERVER_ONLY_SENTINEL|private-service|execute/);
    expect(client?.map.sourcesContent).toEqual([]);
    expect(await f.load("account.ts", true)).toBeNull();
    expect((await f.load("account.ts?t=123"))?.code).toBe(client?.code);
    expect(await f.plugin.load(f.context, "\0vite/modulepreload-polyfill.js")).toBeNull();
    await expect(f.load("account.ts?raw")).rejects.toThrow("cannot be loaded as an asset");
    expect(() => f.plugin.guard("@finesoft/front", false, f.context)).not.toThrow();
    expect(() => f.plugin.guard("@finesoft/ssr", false, f.context)).toThrow("server-only");
});
test("classification follows namespace imports, local aliases, re-exports and indirect inheritance", async () => {
    const f = fixture({
        "barrel.ts": `export { BaseServerController as Server } from "@finesoft/front";`,
        "base.ts": `import * as Framework from "./barrel"; export class Parent extends Framework.Server { execute(){ return "private-parent"; } }`,
        "account.ts": `import { Parent } from "./base"; const Alias = Parent; class Account extends Alias { execute(){ return "private-child"; } } export { Account as Renamed };`,
    });
    const client = await f.load();
    expect(client?.code).toContain("export { Account as Renamed }");
    expect(client?.code).not.toContain("private-child");
    const parent = await f.load("base.ts");
    expect(parent?.code).not.toContain("private-parent");
});
test("shared value exports in a server controller module fail instead of leaking or silently disappearing", async () => {
    const f = fixture({
        "account.ts": `import { BaseServerController } from "@finesoft/front"; export const secret = "SENSITIVE"; export class Account extends BaseServerController { execute() { return secret; } }`,
    });
    await expect(f.load()).rejects.toThrow("only export controllers and types");
});

test("server dependency source is blocked before any controller load and after edits", async () => {
    const f = fixture({
        "account.ts": `import {BaseServerController} from "@finesoft/front"; import {secret} from "./private"; export class Account extends BaseServerController { execute(){ return secret; } }`,
        "private.ts": `export const secret="SERVER_SECRET";`,
        "added.ts": `export const secret="ADDED_SECRET";`,
    });
    await expect(f.load("private.ts?raw")).rejects.toThrow("dependency cannot");
    expect(await f.load("private.ts", true)).toBeNull();
    fs.writeFileSync(path.join(f.root, "private.ts"), `export {secret} from "./added";`);
    f.plugin.invalidate(path.join(f.root, "private.ts"));
    await expect(f.load("added.ts")).rejects.toThrow("dependency cannot");
    fs.writeFileSync(path.join(f.root, "late-secret.ts"), `export const secret="LATE_SECRET";`);
    fs.writeFileSync(
        path.join(f.root, "late.ts"),
        `import {BaseServerController} from "@finesoft/front"; import {secret} from "./late-secret"; export class Late extends BaseServerController { execute(){return secret;} }`,
    );
    expect((await f.load("late.ts"))?.code).toContain("class Late extends __Proxy");
    await expect(f.load("late-secret.ts?raw")).rejects.toThrow("dependency cannot");
});

test("cold dependency discovery scans client dependencies without traversing server controllers", async () => {
    const f = fixture({
        "index.html": '<script type="module" src="/main.ts"></script>',
        "main.ts":
            'import {createElement} from "react"; import {Account} from "./account"; console.log(createElement, new Account());',
        "account.ts":
            'import {BaseServerController} from "@finesoft/front"; import {secret} from "./private"; export class Account extends BaseServerController { execute(){ return secret; } }',
        "private.ts":
            'import {readFileSync} from "node:fs"; export const secret=readFileSync("/server/private-file");',
    });
    const errors: string[] = [];
    const logger = createLogger("silent");
    logger.error = (message) => {
        errors.push(message);
    };
    const server = await createServer({
        configFile: false,
        root: f.root,
        cacheDir: path.join(f.root, ".vite"),
        customLogger: logger,
        plugins: [finesoftFrontViteConfig({ controllerTypes: false })],
        optimizeDeps: { force: true, entries: ["index.html"] },
        server: { host: "127.0.0.1", port: 0 },
    });
    try {
        await server.listen();
        const optimizer = server.environments.client!.depsOptimizer!;
        await optimizer.scanProcessing;
        expect(errors).toEqual([]);
        expect(
            Object.keys({ ...optimizer.metadata.optimized, ...optimizer.metadata.discovered }),
        ).toContain("react");
        const controller = await server.transformRequest("/account.ts");
        expect(controller?.code).toContain("ServerControllerProxy");
        expect(controller?.code).not.toContain("private-file");
        await expect(server.transformRequest("/private.ts?raw")).rejects.toThrow(
            "dependency cannot",
        );
    } finally {
        await server.close();
    }
});
