import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

test.each(["react", "react-minimal", "vue", "vue-minimal", "svelte", "svelte-minimal"])(
    "%s scaffold uses one definition and registry with native standard owners",
    (name) => {
        const root = fileURLToPath(new URL(`../../../templates/${name}/`, import.meta.url));
        const read = (path: string) => readFileSync(root + path, "utf8");
        const ui = name.split("-")[0];
        const main = read("src/main.ts");
        expect(main).toContain("createBrowserApp(");
        expect(main).toContain("target");
        expect(main).toContain("app-definition");
        expect(main).toContain("./App");
        expect(
            read("src/App." + (ui === "react" ? "tsx" : ui === "vue" ? "vue" : "svelte")),
        ).toContain(`selectOutlet("${ui}")`);
        const ssr = read("src/ssr.ts");
        expect(ssr).toContain("app-definition");
        expect(ssr).toContain("./App");
        expect(ssr).toContain("createSSRRender");
        expect(read("src/app-definition.ts")).toContain("defineWebApp(");
        expect(existsSync(root + "src/bootstrap.ts")).toBe(false);
        expect(main + ssr).not.toMatch(
            /mountEntry|updatePage|createAppHandle|startBrowserApp|create\w+Renderer/,
        );
        expect(read("index.html")).toMatch(/<div id="app">[\s\S]*<!--ssr-data-->[\s\S]*<\/div>/);
    },
);

const templates = fileURLToPath(new URL("../../../templates/", import.meta.url));
const frameworks = ["react", "vue", "svelte"];

function sourceFiles(root: string, prefix = ""): string[] {
    return readdirSync(root + prefix, { withFileTypes: true })
        .flatMap((entry) => {
            const path = prefix + entry.name;
            return entry.isDirectory() ? sourceFiles(root, path + "/") : [path];
        })
        .sort();
}

// These files differ only at the selected native adapter, never in application behavior.
function normalizeAdapter(source: string) {
    return source
        .replaceAll(/\.(?:vue|svelte)(?=["'])/g, "")
        .replaceAll(/react|vue|svelte/gi, "UI")
        .replaceAll("@UIjs/vite-plugin-UI", "@vitejs/plugin-UI")
        .replaceAll("import { UI }", "import UI");
}

test.each(["", "-minimal"])("%s tier has one portable application contract", (suffix) => {
    const roots = frameworks.map((framework) => templates + framework + suffix + "/");
    const sources = roots.map((root) => sourceFiles(root + "src/"));
    const neutral = (files: string[]) => files.filter((file) => !/\.(tsx|vue|svelte)$/.test(file));
    expect(neutral(sources[1])).toEqual(neutral(sources[0]));
    expect(neutral(sources[2])).toEqual(neutral(sources[0]));

    for (const file of neutral(sources[0])) {
        if (file === "config.ts") continue; // Per-application persistence identity is deliberately distinct.
        const values = roots.map((root) => readFileSync(root + "src/" + file, "utf8"));
        if (!["main.ts", "ssr.ts", "views.ts", "app-definition.ts"].includes(file)) {
            const normalized = values.map(normalizeAdapter);
            expect(normalized[1], file).toBe(normalized[0]);
            expect(normalized[2], file).toBe(normalized[0]);
        }
    }
    const nativeInventory = (files: string[]) =>
        files
            .filter((file) => /\.(tsx|vue|svelte)$/.test(file))
            .map((file) => file.replace(/\.(tsx|vue|svelte)$/, ".view"));
    expect(nativeInventory(sources[1])).toEqual(nativeInventory(sources[0]));
    expect(nativeInventory(sources[2])).toEqual(nativeInventory(sources[0]));
    for (const file of ["index.html", "README.md"]) {
        const contents = roots.map((root) => readFileSync(root + file, "utf8"));
        expect(contents[1], file).toBe(contents[0]);
        expect(contents[2], file).toBe(contents[0]);
    }
    const configs = roots.map((root) =>
        normalizeAdapter(readFileSync(root + "vite.config.ts", "utf8")),
    );
    expect(configs[1]).toBe(configs[0]);
    expect(configs[2]).toBe(configs[0]);
});

test.each(frameworks.flatMap((framework) => [framework, framework + "-minimal"]))(
    "%s has standalone boundaries",
    (name) => {
        const root = templates + name + "/";
        const config = JSON.parse(readFileSync(root + "tsconfig.json", "utf8"));
        expect(config.extends).toBeUndefined();
        expect(Object.keys(config.compilerOptions.paths)).toEqual(["@finesoft/front"]);
        expect(config.compilerOptions.paths["@finesoft/front"]).toEqual(["./.finesoft/front.d.ts"]);
        for (const file of sourceFiles(root + "src/")) {
            const source = readFileSync(root + "src/" + file, "utf8");
            expect(source, file).not.toMatch(
                /from ["']@finesoft\/(?:core|web|browser|ssr|server)["']/,
            );
            if (
                file.startsWith("lib/controllers/") ||
                file.startsWith("lib/models/") ||
                file === "app-definition.ts"
            ) {
                expect(source, file).not.toMatch(/from ["']@finesoft\/front\//);
                expect(source, file).not.toMatch(/from ["'](?:react|vue|svelte)["']/);
            }
        }
    },
);
