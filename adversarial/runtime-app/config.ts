/** One configuration supplies both harness values and fixture binding types. */
export const fixtureConfig = {
    compatibilityDate: "2026-09-15",
    bindings: { TENANT: "tenant-a" },
};
export type FixtureBindings = typeof fixtureConfig.bindings;
