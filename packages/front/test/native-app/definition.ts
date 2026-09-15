import { defineWebApp, leaf, stack, tabs, split } from "@finesoft/front/web";
export function definition(
    locale = "en",
    label = "first",
    state = { pageType: "probe" },
    structured = false,
) {
    let version = 0;
    return defineWebApp({
        id: "probe",
        navigation: structured
            ? tabs({
                  active: "workspace",
                  branches: {
                      workspace: split([
                          { id: "left", content: stack(leaf("probe", {}, { url: "/" })) },
                          { id: "right", content: stack(leaf("probe", {}, { url: "/" })) },
                      ]),
                      notes: stack(leaf("other")),
                  },
              })
            : undefined,
        frameworkConfig: { locale },
        loadMessages: () => ({ greeting: label }),
        controllers: [
            {
                id: "probe",
                handler: () => ({
                    id: "probe",
                    pageType: state.pageType,
                    title: label + " " + ++version,
                }),
            },
            {
                id: "slow",
                handler: async () => {
                    await (globalThis as any).nativeGate;
                    return { id: "slow", pageType: "probe", title: "Slow target" };
                },
            },
            { id: "other", handler: () => ({ id: "other", pageType: "other", title: "Other" }) },
        ],
        routes: [
            { path: "/", intentId: "probe" },
            { path: "/redirect", intentId: "probe" },
            { path: "/slow", intentId: "slow" },
            { path: "/other", intentId: "other" },
            { path: "/csr", intentId: "probe", renderMode: "csr" },
            { path: "/static", intentId: "probe", renderMode: "prerender", cache: "public" },
        ],
        getErrorPage: (status, message) => ({
            id: "error",
            pageType: "probe",
            title: status + message,
        }),
    });
}
