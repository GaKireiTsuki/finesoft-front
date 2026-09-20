import { PRODUCTS } from "../data/products";
import { BaseController } from "@finesoft/front";
import { markPublic } from "@finesoft/front/web";
import type { SearchPage } from "../models/product";
import type { SearchControllerInput as Input } from "../../../.finesoft/controller-types";

export class SearchController extends BaseController<Input, SearchPage> {
    execute({ query }: Input): SearchPage {
        const term = query.q;
        const results = term
            ? PRODUCTS.filter((p) => p.name.toLowerCase().includes(term.toLowerCase()))
            : PRODUCTS;

        return markPublic(
            {
                id: "search",
                pageType: "search",
                title: term ? `Search: ${term}` : "All Products",
                description: `${results.length} result(s)`,
                url: "/search",
                query: term,
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
