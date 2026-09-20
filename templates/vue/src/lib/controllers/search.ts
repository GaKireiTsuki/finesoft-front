import { PRODUCTS } from "../data/products";
import { BaseController } from "@finesoft/front";
import { markPublic } from "@finesoft/front/web";
import type { SearchPage } from "../models/product";

export class SearchController extends BaseController<{ q?: string }, SearchPage> {
    execute(params: { q?: string }): SearchPage {
        const query = params.q ?? "";
        const results = query
            ? PRODUCTS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
            : PRODUCTS;

        return markPublic(
            {
                id: "search",
                pageType: "search",
                title: query ? `Search: ${query}` : "All Products",
                description: `${results.length} result(s)`,
                url: "/search",
                query,
                results,
            },
            {
                query: true,
                results: {
                    id: true,
                    itemType: true,
                    name: true,
                    price: true,
                    imageUrl: true,
                    clickAction: { kind: true, url: true },
                },
            },
        );
    }
}
