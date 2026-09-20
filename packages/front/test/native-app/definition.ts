import {
    definePage,
    defineWebApp,
    leaf,
    stack,
    tabs,
    split,
    type BeforeLoadGuard,
} from "@finesoft/front/web";
type ProbeState = { pageType: string; beforeLoad?: BeforeLoadGuard };
export function definition(
    locale = "en",
    label = "first",
    state: ProbeState = { pageType: "probe" },
    structured = false,
) {
    let version = 0;
    return defineWebApp({
        id: "probe",
        navigation: structured
            ? () =>
                  tabs({
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
        configuration: { locale },
        loadMessages: () => ({ greeting: label }),
        beforeLoad: [(context) => state.beforeLoad?.(context) ?? { kind: "next" }],
        pages: [
            definePage({
                id: "probe",
                routes: [
                    "/",
                    "/redirect",
                    { path: "/csr", renderMode: "csr" },
                    { path: "/static", renderMode: "prerender", cache: "public" },
                ],
                handler: () => ({
                    id: "probe",
                    pageType: state.pageType,
                    title: label + " " + ++version,
                }),
            }),
            definePage({
                id: "slow",
                routes: ["/slow"],
                handler: async () => {
                    await (globalThis as any).nativeGate;
                    return { id: "slow", pageType: "probe", title: "Slow target" };
                },
            }),
            definePage({
                id: "other",
                routes: ["/other"],
                handler: () => ({ id: "other", pageType: "other", title: "Other" }),
            }),
        ],
        getErrorPage: (status, message) => ({
            id: "error",
            pageType: "probe",
            title: status + message,
        }),
    });
}
