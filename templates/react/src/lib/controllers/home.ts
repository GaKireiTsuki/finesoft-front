import { PRODUCTS } from "../data/products";
import { BaseController } from "@finesoft/front";
import { markPublic, makeFlowAction } from "@finesoft/front/web";
import type { HomePage, ProductShelf } from "../models/product";

export class HomeController extends BaseController<Record<string, string>, HomePage> {
    execute(): HomePage {
        const shelf: ProductShelf = {
            id: "featured",
            shelfType: "products",
            title: "Featured Products",
            isHorizontal: true,
            seeAllAction: makeFlowAction("/search"),
            items: PRODUCTS.slice(0, 3),
        };

        return markPublic(
            {
                id: "home",
                pageType: "home",
                title: "Home",
                description: "Welcome to Finesoft Front Demo",
                url: "/",
                shelves: [shelf],
            },
            {
                shelves: {
                    id: true,
                    shelfType: true,
                    title: true,
                    isHorizontal: true,
                    seeAllAction: { kind: true, url: true },
                    items: {
                        id: true,
                        itemType: true,
                        name: true,
                        price: true,
                        imageUrl: true,
                        clickAction: { kind: true, url: true },
                    },
                },
            },
        );
    }
}
