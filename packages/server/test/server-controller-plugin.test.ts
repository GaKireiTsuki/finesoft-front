import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { createLogger, createServer } from "vite-plus";
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
