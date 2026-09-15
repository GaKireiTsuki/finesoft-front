import { expect, test, vi } from "vite-plus/test";
import { createSSRHost } from "../src/ssr-host";
import { createSSRHandler } from "../src/ssr-handler";
import { startNodeHandler } from "../src/node";
import { request as nodeRequest } from "node:http";
test("explicit SSR host drains disconnected rendering before disposing every loaded renderer once", async () => {
    let release!: () => void, begin!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
        begun = new Promise<void>((r) => (begin = r));
    const order: string[] = [];
    const render = Object.assign(
        async () => {
            begin();
            await gate;
            order.push("rendered");
            return { html: "ok", head: "", css: "", serverData: [] };
        },
        {
            dispose: vi.fn(async () => {
                order.push("disposed");
            }),
        },
    );
    const host = createSSRHost({
        template: "<!--ssr-body-->",
        loadModule: () => ({ render, serializeServerData: () => "" }),
    });
    const node = await startNodeHandler({
        port: 0,
        hostname: "127.0.0.1",
        handler: (request, bindings) => host.handle(request, bindings),
        disposeApp: () => host.dispose(),
    });
    const address = node.server.address();
    if (!address || typeof address === "string") throw Error("no address");
    const request = nodeRequest("http://127.0.0.1:" + address.port);
    request.on("error", () => {});
    request.end();
    try {
        await begun;
        request.destroy();
        const closing = node.dispose();
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual([]);
        release();
        await closing;
        await host.dispose();
        expect(order).toEqual(["rendered", "disposed"]);
        expect(render.dispose).toHaveBeenCalledTimes(1);
        expect((await host.handle(new Request("http://localhost"))).status).toBe(503);
    } finally {
        release();
        await node.dispose();
    }
});
test("host owns each HMR renderer identity, ordinary assembly does not take external ownership", async () => {
    const make = () =>
        Object.assign(async () => ({ html: "", head: "", css: "", serverData: [] }), {
            dispose: vi.fn(async () => {}),
        });
    const a = make(),
        b = make();
    let render = a;
    const host = createSSRHost({
        template: "",
        loadModule: () => ({ render, serializeServerData: () => "" }),
    });
    await host.handle(new Request("http://localhost"));
    render = b;
    await host.handle(new Request("http://localhost"));
    await host.handle(new Request("http://localhost"));
    await host.dispose();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
    const external = make();
    await createSSRHandler({ render: external, serializeServerData: () => "", template: "" })(
        new Request("http://localhost"),
    );
    expect(external.dispose).not.toHaveBeenCalled();
    const unused = make();
    const unusedHost = createSSRHost({
        render: unused,
        serializeServerData: () => "",
        template: "",
    });
    await unusedHost.dispose();
    expect(unused.dispose).toHaveBeenCalledTimes(1);
});
