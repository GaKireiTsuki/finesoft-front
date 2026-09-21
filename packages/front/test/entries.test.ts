import { expect, test } from "vite-plus/test";
import * as root from "../src/index";
import * as web from "../src/web";
import * as react from "../src/react";
import * as vue from "../src/vue";

test("one root exposes execution, Web, hosts, tooling and native selection", () => {
    expect(typeof root.createRuntime).toBe("function");
    expect("Framework" in root).toBe(false);
    expect("startBrowserApp" in root).toBe(false);
    expect("createServer" in root).toBe(false);
    for (const name of [
        "finesoftFrontViteConfig",
        "generateFrontTypes",
        "generateControllerTypes",
        "startNodeHandler",
        "createHttpHandler",
        "createSSRRender",
        "createBrowserApp",
        "BaseServerController",
        "Outlet",
        "useSnapshot",
    ] as const)
        expect(typeof root[name], name).toBe("function");
    expect(typeof web.defineWebApp).toBe("function");
    expect(typeof web.definePage).toBe("function");
    expect(web.createRuntime).toBe(root.createRuntime);
    expect(root.defineWebApp).toBe(web.defineWebApp);
    expect(root.Outlet("react")).toBe(root.Outlet("react"));
    expect(() => root.Outlet("../node" as "react")).toThrow("Unknown native renderer");
    expect(typeof react.Outlet).toBe("function");
    expect(typeof react.useSnapshot).toBe("function");
    expect(typeof vue.Outlet).toBe("object");
    expect(typeof vue.useSnapshot).toBe("function");
});
