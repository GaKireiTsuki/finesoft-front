import { productDetailAction } from "../../actions";
import type { ProductItem } from "../models/product";

export const PRODUCTS: ProductItem[] = [
    {
        id: "1",
        itemType: "product",
        name: "TypeScript Handbook",
        price: 29.99,
        imageUrl: "/img/ts.svg",
        clickAction: productDetailAction("1"),
    },
    {
        id: "2",
        itemType: "product",
        name: "Vite Starter Kit",
        price: 19.99,
        imageUrl: "/img/vite.svg",
        clickAction: productDetailAction("2"),
    },
    {
        id: "3",
        itemType: "product",
        name: "Hono Framework Guide",
        price: 24.99,
        imageUrl: "/img/hono.svg",
        clickAction: productDetailAction("3"),
    },
    {
        id: "4",
        itemType: "product",
        name: "SSR Deep Dive",
        price: 34.99,
        imageUrl: "/img/ssr.svg",
        clickAction: productDetailAction("4"),
    },
];
