import { BaseController, type BasePage, safeErrorPage } from "@finesoft/front";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface SearchParams extends Record<string, string | undefined> {
    q?: string;
}

interface SearchPage extends BasePage {
    parsed?: unknown;
}

const QUERIES_DIR = resolve(process.cwd(), "data", "queries");

export class SearchController extends BaseController<SearchParams, SearchPage> {
    readonly intentId = "search";

    execute(params: SearchParams): SearchPage {
        const q = params.q ?? "default";
        const fixturePath = join(QUERIES_DIR, `${q}.json`);
        const raw = readFileSync(fixturePath, "utf-8");
        const parsed = JSON.parse(raw);
        return {
            id: "search",
            pageType: "search",
            title: "Search",
            description: `Parsed query: ${JSON.stringify(parsed)}`,
            parsed,
        };
    }

    fallback(_params: SearchParams, _error: Error): SearchPage {
        // Omit devError entirely — even in dev we don't want the stack reaching
        // the page. Real apps that need diagnostics should log the error to the
        // framework logger instead of putting it in the HTML.
        return safeErrorPage({
            status: 500,
            publicMessage: "Could not load query.",
        }) as SearchPage;
    }
}
