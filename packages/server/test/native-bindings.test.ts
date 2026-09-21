import { expect, test } from "vite-plus/test";
import { nativeBindings } from "../src/native-bindings";
import { fileURLToPath } from "node:url";

const bindings = () => nativeBindings(() => process.cwd());

test.each(["react", "vue", "svelte"])("selects only the %s native implementation", (renderer) => {
    const result = bindings().transform(
        `
import { Outlet as selectOutlet, useSnapshot, definePage } from "@finesoft/front";
const View = selectOutlet("${renderer}");
function App(app) { return useSnapshot("${renderer}", app); }
export { View, App, definePage };
`,
        `/example/App.${renderer === "react" ? "jsx" : renderer}`,
    )!;
    expect(result.code).toContain(`virtual:finesoft-front/native/${renderer}`);
    expect(result.code).toContain('import { definePage } from "@finesoft/front"');
    expect(result.code).not.toContain(`selectOutlet("${renderer}")`);
    expect(result.code).not.toContain(`useSnapshot("${renderer}"`);
    expect(result.map.sourcesContent?.[0]).toContain("selectOutlet");
});

test("respects lexical shadows while selecting namespaced and aliased imports", () => {
    const result = bindings().transform(
        `
import * as front from "@finesoft/front";
import { useSnapshot as useView } from "@finesoft/front";
const View = front.Outlet("vue");
const snapshot = useView("vue", app);
function local(useView, front) {
    return [useView("not-a-renderer"), front.Outlet("local")];
}
`,
        "/example/App.vue",
    )!;
    expect(result.code).toContain('useView("not-a-renderer")');
    expect(result.code).toContain('front.Outlet("local")');
    expect(result.code).toContain("virtual:finesoft-front/native/vue");
    expect(result.code).not.toContain("native/react");
});

test("rejects runtime renderer selection and escaping selector functions", () => {
    for (const call of [
        "Outlet(renderer)",
        "Outlet('unknown')",
        "const choose = Outlet",
        "Outlet()",
    ])
        expect(() =>
            bindings().transform(`import { Outlet } from "@finesoft/front"; ${call};`, "/app.js"),
        ).toThrow(/\[finesoft\]/);
});

test("ordinary root imports do not need transformation", () => {
    expect(
        bindings().transform('import { defineApp } from "@finesoft/front";', "/app.js"),
    ).toBeNull();
});

test.each(["vue", "svelte"])(
    "rewrites %s script blocks before the native compiler and import analysis",
    (renderer) => {
        const root = fileURLToPath(new URL(`../../../templates/${renderer}/`, import.meta.url));
        const script = `import {Outlet, useSnapshot, type WebAppView} from "@finesoft/front";
const View = Outlet("${renderer}");
const read = (app: WebAppView) => useSnapshot("${renderer}", app);`;
        const source = `<script ${renderer === "vue" ? "setup " : ""}lang="ts">${script}</script>\n${renderer === "vue" ? "<template><View /></template>" : "<View />"}`;
        const result = nativeBindings(() => root).transform(source, `/app/App.${renderer}`)!;
        expect(result.code).toContain(
            `<script ${renderer === "vue" ? "setup " : ""}lang="ts">import`,
        );
        expect(result.code).toContain(`virtual:finesoft-front/native/${renderer}`);
        expect(result.code).toContain("useFinesoftSnapshot");
        expect(result.code).not.toContain(`Outlet("${renderer}")`);
        expect(result.code).toContain("type WebAppView");
        expect(result.map.sourcesContent).toEqual([source]);
    },
);
