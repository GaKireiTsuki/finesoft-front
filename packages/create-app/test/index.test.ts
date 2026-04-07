import { describe, expect, test } from "vite-plus/test";
import { getProjectNameFromArgs, resolveTemplateDir, validateProjectName } from "../src/index";

describe("create-app CLI helpers", () => {
    test("reads the first positional project name from argv", () => {
        expect(getProjectNameFromArgs(["my-app"])).toBe("my-app");
        expect(getProjectNameFromArgs([])).toBeUndefined();
    });

    test("validates project names consistently", () => {
        expect(validateProjectName("")).toBe("Project name is required");
        expect(validateProjectName("bad name")).toBe("Invalid project name");
        expect(validateProjectName("my-app")).toBeUndefined();
    });

    test("resolves templates relative to the package directory", () => {
        expect(resolveTemplateDir("react").replaceAll("\\", "/")).toContain(
            "/packages/create-app/templates/react",
        );
    });
});
