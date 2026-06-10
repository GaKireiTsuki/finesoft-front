import { BaseController, type BasePage } from "@finesoft/front";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface StaticFileParams extends Record<string, string | undefined> {
    file?: string;
}

const PUBLIC_DIR = resolve(process.cwd(), "public");

export class StaticFileController extends BaseController<StaticFileParams, BasePage> {
    readonly intentId = "static-file";

    execute(params: StaticFileParams): BasePage {
        const filename = params.file ?? "welcome.txt";

        // Reject path separators, NUL, and absolute paths up front so a
        // hostile filename can never escape PUBLIC_DIR via join/resolve.
        if (
            filename.includes("\0") ||
            filename.includes("/") ||
            filename.includes("\\") ||
            filename.startsWith(".") ||
            filename.length > 128
        ) {
            return {
                id: "static-file",
                pageType: "static",
                title: "Static",
                description: "Invalid filename.",
            };
        }

        const fullPath = join(PUBLIC_DIR, filename);
        // Re-resolve and require the result to live under PUBLIC_DIR.
        const resolved = resolve(fullPath);
        if (!resolved.startsWith(PUBLIC_DIR + "/") && resolved !== PUBLIC_DIR) {
            return {
                id: "static-file",
                pageType: "static",
                title: "Static",
                description: "Invalid filename.",
            };
        }

        let content: string;
        try {
            content = readFileSync(resolved, "utf-8");
        } catch {
            // Don't leak absolute path or errno text.
            content = `Could not read ${filename}.`;
        }
        return {
            id: "static-file",
            pageType: "static",
            title: `Static: ${filename}`,
            description: content,
        };
    }
}
