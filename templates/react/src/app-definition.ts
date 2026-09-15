import { defineWebApp, int, route } from "@finesoft/front/web";
import { AboutController } from "./lib/controllers/about";
import { HomeController } from "./lib/controllers/home";
import { ProductDetailController } from "./lib/controllers/product-detail";
import { SearchController } from "./lib/controllers/search";
import { authGuard } from "./lib/guards/auth";
import { seoGuard } from "./lib/guards/seo";
import { getErrorPage } from "./lib/controllers/error";
export const app = defineWebApp({
    id: "react",
    controllers: [
        { id: "home", create: () => new HomeController() },
        { id: "product-detail", create: () => new ProductDetailController() },
        { id: "search", create: () => new SearchController() },
        { id: "about", create: () => new AboutController() },
    ],
    routes: [
        { path: "/", intentId: "home" },
        route("/products/:id", {
            intentId: "product-detail",
            params: { id: int() },
        }),
        {
            path: "/search",
            intentId: "search",
        },
        {
            path: "/about",
            intentId: "about",
            renderMode: "csr",
        },
        {
            path: "/admin",
            intentId: "home",
            beforeLoad: [authGuard],
        },
    ],
    getErrorPage: getErrorPage,
    afterLoad: [seoGuard],
});
