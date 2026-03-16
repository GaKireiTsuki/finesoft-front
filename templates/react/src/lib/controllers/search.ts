import { BaseController, makeFlowAction } from "@finesoft/front";
import type { ProductItem, SearchPage } from "../models/product";

const ALL_PRODUCTS: ProductItem[] = [
    {
        id: "1",
        itemType: "product",
        name: "TypeScript Handbook",
        price: 29.99,
        imageUrl: "/img/ts.svg",
        clickAction: makeFlowAction("/products/1"),
    },
    {
        id: "2",
        itemType: "product",
        name: "Vite Starter Kit",
        price: 19.99,
        imageUrl: "/img/vite.svg",
        clickAction: makeFlowAction("/products/2"),
    },
    {
        id: "3",
        itemType: "product",
        name: "Hono Framework Guide",
        price: 24.99,
        imageUrl: "/img/hono.svg",
        clickAction: makeFlowAction("/products/3"),
    },
    {
        id: "4",
        itemType: "product",
        name: "SSR Deep Dive",
        price: 34.99,
        imageUrl: "/img/ssr.svg",
        clickAction: makeFlowAction("/products/4"),
    },
];

export class SearchController extends BaseController<{ q?: string }, SearchPage> {
    readonly intentId = "search";

    execute(params: { q?: string }): SearchPage {
        const query = params.q ?? "";
        const results = query
            ? ALL_PRODUCTS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
            : ALL_PRODUCTS;

        return {
            id: "search",
            pageType: "search",
            title: query ? `Search: ${query}` : "All Products",
            description: `${results.length} result(s)`,
            query,
            results,
        };
    }
}
