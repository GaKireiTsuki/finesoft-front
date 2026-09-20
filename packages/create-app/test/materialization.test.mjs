import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import {
    generatedTemplates,
    syncTemplateSources,
} from "../../../scripts/sync-template-sources.mjs";

const workspaces = [];
afterEach(() => {
    for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "finesoft-template-sync-"));
    workspaces.push(root);
    const write = (file, value) => {
        const target = join(root, "templates", file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, value);
    };
    for (const name of ["react", "react-minimal"])
        write(`${name}/src/app-definition.ts`, `${name} portable source`);
    for (const name of generatedTemplates) write(`${name}/src/config.ts`, name);
    return {
        root,
        write,
        read: (file) => readFileSync(join(root, "templates", file), "utf8"),
    };
}

test("materializes both tiers, updates/deletes owned files and preserves native configuration", () => {
    const { root, write, read } = fixture();
    write("react/src/lib/controllers/old.ts", "old");
    syncTemplateSources(root);
    for (const name of generatedTemplates) {
        expect(read(`${name}/src/app-definition.ts`)).toBe(
            `${name.endsWith("-minimal") ? "react-minimal" : "react"} portable source`,
        );
        expect(read(`${name}/src/config.ts`)).toBe(name);
    }
    write("react/src/app-definition.ts", "changed");
    write("react/src/lib/controllers/new.ts", "new");
    rmSync(join(root, "templates/react/src/lib/controllers/old.ts"));
    syncTemplateSources(root);
    syncTemplateSources(root); // Repeated preparation remains safe.
    for (const name of ["vue", "svelte"]) {
        expect(read(`${name}/src/app-definition.ts`)).toBe("changed");
        expect(read(`${name}/src/lib/controllers/new.ts`)).toBe("new");
        expect(existsSync(join(root, `templates/${name}/src/lib/controllers/old.ts`))).toBe(false);
    }
});

test("preflights a template before replacing sources and refuses to remove a locally edited copy", () => {
    const { root, write, read } = fixture();
    write("react/src/lib/controllers/old.ts", "old");
    syncTemplateSources(root);
    write("react/src/app-definition.ts", "changed");
    write("vue/src/lib/controllers/old.ts", "local edit");
    rmSync(join(root, "templates/react/src/lib/controllers/old.ts"));
    expect(() => syncTemplateSources(root, ["vue"])).toThrow("Local changes");
    expect(read("vue/src/app-definition.ts")).toBe("react portable source");
    expect(read("vue/src/lib/controllers/old.ts")).toBe("local edit");
});

test("refuses conflicting files without a manifest and rejects names outside the generated inventory", () => {
    const { root, write, read } = fixture();
    write("vue/src/app-definition.ts", "existing work");
    expect(() => syncTemplateSources(root, ["vue"])).toThrow("Local changes");
    expect(read("vue/src/app-definition.ts")).toBe("existing work");
    expect(() => syncTemplateSources(root, ["../react"])).toThrow("Unknown generated template");
});
