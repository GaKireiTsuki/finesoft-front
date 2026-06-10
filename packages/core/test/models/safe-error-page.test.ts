import { describe, expect, test } from "vite-plus/test";
import { safeErrorPage } from "../../src/models/safe-error-page";

describe("safeErrorPage", () => {
    test("only publicMessage is shown when isProduction=true", () => {
        const page = safeErrorPage({
            status: 500,
            publicMessage: "Something went wrong.",
            devError: new Error("ENOENT: /etc/secrets"),
            isProduction: true,
        });
        expect(page.title).toBe("Error 500");
        expect(page.description).toBe("Something went wrong.");
        expect(page.description).not.toContain("/etc/secrets");
    });

    test("devError stack is appended when isProduction=false", () => {
        const err = new Error("boom");
        const page = safeErrorPage({
            status: 500,
            publicMessage: "Internal error",
            devError: err,
            isProduction: false,
        });
        expect(page.description).toContain("Internal error");
        expect(page.description).toContain("[dev only]");
        expect(page.description).toContain("boom");
    });

    test("dropping devError silently in production avoids stack leak", () => {
        const page = safeErrorPage({
            status: 500,
            publicMessage: "Failed",
            isProduction: true,
        });
        expect(page.description).toBe("Failed");
    });

    test("uses NODE_ENV when isProduction is not provided", () => {
        const env = (
            globalThis as unknown as { process: { env: Record<string, string | undefined> } }
        ).process.env;
        const originalEnv = env.NODE_ENV;
        try {
            env.NODE_ENV = "production";
            const page = safeErrorPage({
                status: 404,
                publicMessage: "Not found",
                devError: new Error("internal-id=42"),
            });
            expect(page.description).toBe("Not found");
        } finally {
            env.NODE_ENV = originalEnv;
        }
    });

    test("non-Error devError values still render in dev mode", () => {
        const page = safeErrorPage({
            status: 400,
            publicMessage: "bad request",
            devError: { trace: "abc", line: 7 },
            isProduction: false,
        });
        expect(page.description).toContain('"trace":"abc"');
    });
});
