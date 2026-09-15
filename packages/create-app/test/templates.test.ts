import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

test.each(["react", "react-minimal", "vue", "vue-minimal", "svelte", "svelte-minimal"])(
    "%s scaffold uses one definition and registry with native standard owners",
    (name) => {
        const root = fileURLToPath(new URL(`../../../templates/${name}/`, import.meta.url));
        const read = (path: string) => readFileSync(root + path, "utf8");
        const ui = name.split("-")[0];
        const main = read(`src/main.${ui === "react" ? "tsx" : "ts"}`);
        expect(main).toContain("startBrowserApp(");
        expect(main).toContain("target:");
        expect(main).toContain("app-definition");
        expect(main).toContain("./views");
        expect(main).toContain(`/renderers/${ui}/browser`);
        const ssr = read(`src/ssr.${ui === "react" ? "tsx" : "ts"}`);
        expect(ssr).toContain("app-definition");
        expect(ssr).toContain("./views");
        expect(ssr).toContain(`/renderers/${ui}/server`);
        expect(read("src/app-definition.ts")).toContain("defineWebApp(");
        expect(existsSync(root + "src/bootstrap.ts")).toBe(false);
        expect(main + ssr).not.toMatch(
            /hydrateRoot|createRoot|renderToString|mountEntry|updatePage|createAppHandle/,
        );
        expect(read("index.html")).toMatch(/<div id="app">[\s\S]*<!--ssr-data-->[\s\S]*<\/div>/);
    },
);
