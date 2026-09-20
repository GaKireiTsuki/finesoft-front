vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { decodeWireEnvelope, leaf, markPublic, serializeNavigation, stack } from "@finesoft/web";
import { materializeServerData, serializeServerData } from "../src/server-data";

function hydration(data: unknown, entryId = "entry-1") {
    return {
        tree: serializeNavigation(stack([leaf("home", {}, { entryId })])),
        pages: [{ entryId, intent: { id: "home", params: {} }, data }],
    };
}

test("protocol/build mismatch requests fresh load, valid envelope retains identities", () => {
    const wire = JSON.parse(
        serializeServerData(
            hydration({ id: "home", pageType: "home", title: "Home", secret: "SECRET" }),
            { buildId: "build-a" },
        ),
    );
    expect(wire.payload.pages[0].data).toEqual({ id: "home", pageType: "home", title: "Home" });
    expect(wire.payload.tree).toEqual(expect.any(Object));
    expect(decodeWireEnvelope(wire, "build-a")).toMatchObject({ status: "ready" });
    expect(decodeWireEnvelope(wire, "build-b")).toEqual({
        status: "fresh-load",
        code: "build-mismatch",
    });
    expect(decodeWireEnvelope({ ...wire, protocolVersion: 999 }, "build-a")).toEqual({
        status: "fresh-load",
        code: "protocol-mismatch",
    });
    expect(
        decodeWireEnvelope(
            {
                ...wire,
                payload: { ...wire.payload, pages: [wire.payload.pages[0], wire.payload.pages[0]] },
            },
            "build-a",
        ),
    ).toMatchObject({ status: "fresh-load", code: "invalid-payload" });
    delete wire.payload.pages[0].entryId;
    expect(decodeWireEnvelope(wire, "build-a")).toMatchObject({ status: "fresh-load" });
});

test("nested values require explicit public projections and materialize before resources close", () => {
    let alive = true;
    const user = markPublic(
        {
            name: "Alice",
            secret: "NESTED_SECRET",
            get label() {
                if (!alive) throw Error("closed resource");
                return "</script>";
            },
        },
        ["name", "label"],
    );
    const page = markPublic(
        { id: "p", pageType: "p", title: "Page", user, unsafe: { secret: "UNMARKED_SECRET" } },
        ["user", "unsafe"],
    );
    const data = materializeServerData({
        pages: [{ entryId: "p", intent: { id: "p" }, data: page }],
    });
    alive = false;
    const output = serializeServerData(data);
    expect(output).toContain("Alice");
    expect(output).toContain("\\u003C");
    expect(output).not.toContain("SECRET");
    expect(output).not.toContain("</script>");
    expect(JSON.parse(output).payload.pages[0].data).toMatchObject({
        id: "p",
        title: "Page",
        user: { name: "Alice" },
        unsafe: {},
    });
});

test("bare true does not traverse unmarked objects; recursive projection and codecs are explicit", () => {
    const source = {
        name: "Alice",
        nested: { secret: "NESTED_SECRET" },
        list: [{ title: "One", secret: "LIST_SECRET" }],
    };
    const page = markPublic({ id: "p", title: "P", pageType: "p", ...source }, true);
    const bare = JSON.parse(
        serializeServerData({ pages: [{ entryId: "p", intent: { id: "home" }, data: page }] }),
    ).payload.pages[0].data;
    expect(bare.nested).toEqual({});
    expect(bare.list).toEqual([]);
    markPublic(page, {
        list: { title: true },
        nested: { kind: "codec", encode: () => ({ allowed: "yes" }) },
    });
    const explicit = JSON.parse(
        serializeServerData({ pages: [{ entryId: "p", intent: { id: "home" }, data: page }] }),
    ).payload.pages[0].data;
    expect(explicit.list).toEqual([{ title: "One" }]);
    expect(explicit.nested).toEqual({ allowed: "yes" });
});

test("codec failures reject serialization and arbitrary service instances are not emitted", () => {
    class Service {
        secret = "SERVICE_SECRET";
    }
    const page = markPublic({ id: "p", pageType: "p", title: "P", service: new Service() }, true);
    expect(
        serializeServerData({ pages: [{ entryId: "p", intent: { id: "home" }, data: page }] }),
    ).not.toContain("SERVICE_SECRET");
    markPublic(page, { service: { kind: "codec", encode: (value) => value } });
    expect(() =>
        serializeServerData({ pages: [{ entryId: "p", intent: { id: "home" }, data: page }] }),
    ).toThrow("public-materialization-failed");
    markPublic(page, {
        service: {
            kind: "codec",
            encode: () => {
                throw Error("codec-failed");
            },
        },
    });
    expect(() =>
        serializeServerData({ pages: [{ entryId: "p", intent: { id: "home" }, data: page }] }),
    ).toThrow("public-materialization-failed");
});
