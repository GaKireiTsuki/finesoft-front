import type { BaseItem, BasePage, BaseShelf } from "@finesoft/front";

export interface ProductItem extends BaseItem {
    itemType: "product";
    name: string;
    price: number;
    imageUrl: string;
}

export interface ProductShelf extends BaseShelf {
    shelfType: "products";
    items: ProductItem[];
}

export interface HomePage extends BasePage {
    pageType: "home";
    shelves: ProductShelf[];
}

export interface ProductPage extends BasePage {
    pageType: "product";
    product: {
        id: string;
        name: string;
        price: number;
        description: string;
        imageUrl: string;
    };
}

export interface SearchPage extends BasePage {
    pageType: "search";
    query: string;
    results: ProductItem[];
}

export interface AboutPage extends BasePage {
    pageType: "about";
    content: string;
}

export interface ErrorPage extends BasePage {
    pageType: "error";
    status: number;
}

/** 所有页面类型联合 */
export type AppPage = HomePage | ProductPage | SearchPage | AboutPage | ErrorPage;
