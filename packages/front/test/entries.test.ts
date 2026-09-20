import { expect, test } from "vite-plus/test";
import * as root from "../src/index";
import * as web from "../src/web";
import * as react from "../src/react";
import * as vue from "../src/vue";

test("root owns portable execution; Web declarations are explicit", () => {
    expect(typeof root.createRuntime).toBe("function");
    expect("Framework" in root).toBe(false);
    expect("startBrowserApp" in root).toBe(false);
    expect("createServer" in root).toBe(false);
    expect("finesoftFrontViteConfig" in root).toBe(false);
    expect(typeof web.defineWebApp).toBe("function");
    expect(typeof web.definePage).toBe("function");
    expect(web.createRuntime).toBe(root.createRuntime);
    expect(typeof react.Outlet).toBe("function");
    expect(typeof react.useSnapshot).toBe("function");
    expect(typeof vue.Outlet).toBe("object");
    expect(typeof vue.useSnapshot).toBe("function");
});
