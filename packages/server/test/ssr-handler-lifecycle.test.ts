import { expect, test, vi } from "vite-plus/test";
import { createSSRHandler } from "../src/ssr-handler";
import { startNodeHandler } from "../src/node";
import { request as nodeRequest } from "node:http";
test("SSR handler drains disconnected rendering before disposing every loaded renderer once", async () => {
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
    const host = createSSRHandler({
        ownRenderers: true,
        template: "<!--ssr-body-->",
        loadModule: () => ({ render, serializeServerData: () => "" }),
    });
    const node = await startNodeHandler({
        port: 0,
        hostname: "127.0.0.1",
        handler: host,
        disposeApp: host.dispose,
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
        expect((await host.fetch(new Request("http://localhost"))).status).toBe(503);
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
    const host = createSSRHandler({
        ownRenderers: true,
        template: "",
        loadModule: () => ({ render, serializeServerData: () => "" }),
    });
    await host.fetch(new Request("http://localhost"));
    render = b;
    await host.fetch(new Request("http://localhost"));
    await host.fetch(new Request("http://localhost"));
    await host.dispose();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
    const external = make();
    const borrowed = createSSRHandler({
        render: external,
        serializeServerData: () => "",
        template: "",
    });
    await borrowed.fetch(new Request("http://localhost"));
    await borrowed.dispose();
    expect(external.dispose).not.toHaveBeenCalled();
    const unused = make();
    const unusedHost = createSSRHandler({
        ownRenderers: true,
        render: unused,
        serializeServerData: () => "",
        template: "",
    });
    await unusedHost.dispose();
    expect(unused.dispose).toHaveBeenCalledTimes(1);
});

test("closing waits for a pending module load and reports all owned cleanup failures", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const failures = [new Error("first"), new Error("second")];
    const renderers = failures.map((error) =>
        Object.assign(async () => ({ html: "ready", head: "", css: "", serverData: [] }), {
            dispose: vi.fn(async () => {
                throw error;
            }),
        }),
    );
    const handler = createSSRHandler({
        ownRenderers: true,
        template: "<!--ssr-body-->",
        loadModule: async (request) => {
            const first = new URL(request.url).pathname === "/first";
            if (!first) await gate;
            return { render: renderers[first ? 0 : 1], serializeServerData: () => "" };
        },
    });
    await handler.fetch(new Request("https://test/first"));
    const pending = handler.fetch(new Request("https://test/second"));
    const closing = handler.dispose();
    expect(handler.dispose()).toBe(closing);
    expect((await handler.fetch(new Request("https://test/late"))).status).toBe(503);
    expect(renderers[0].dispose).not.toHaveBeenCalled();
    release();
    expect(await (await pending).text()).toContain("ready");
    await expect(closing).rejects.toMatchObject({ errors: failures });
    for (const render of renderers) expect(render.dispose).toHaveBeenCalledTimes(1);
});
