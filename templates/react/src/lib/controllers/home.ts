import { BaseController, makeFlowAction } from "@finesoft/front";
import type { HomePage, ProductItem, ProductShelf } from "../models/product";

const MOCK_PRODUCTS: ProductItem[] = [
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
];

export class HomeController extends BaseController<Record<string, string>, HomePage> {
    readonly intentId = "home";

    execute(): HomePage {
        const shelf: ProductShelf = {
            id: "featured",
            shelfType: "products",
            title: "Featured Products",
            isHorizontal: true,
            seeAllAction: makeFlowAction("/search"),
            items: MOCK_PRODUCTS,
        };

        return {
            id: "home",
            pageType: "home",
            title: "Home",
            description: "Welcome to Finesoft Front Demo",
            url: "/",
            shelves: [shelf],
        };
    }
}
