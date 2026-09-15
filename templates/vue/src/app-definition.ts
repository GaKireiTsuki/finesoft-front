import { definePage, defineWebApp, int } from "@finesoft/front/web";
import { AboutController } from "./lib/controllers/about";
import { HomeController } from "./lib/controllers/home";
import { ProductDetailController } from "./lib/controllers/product-detail";
import { SearchController } from "./lib/controllers/search";
import { authGuard } from "./lib/guards/auth";
import { seoGuard } from "./lib/guards/seo";
import { getErrorPage } from "./lib/controllers/error";
export const homePage = definePage({ id: "home", create: () => new HomeController() });
export const productDetailPage = definePage({
    id: "product-detail",
    create: () => new ProductDetailController(),
});
export const searchPage = definePage({ id: "search", create: () => new SearchController() });
export const aboutPage = definePage({ id: "about", create: () => new AboutController() });
export const app = defineWebApp({
    id: "vue",
    controllers: [homePage, productDetailPage, searchPage, aboutPage],
    routes: [
        // SSR routes (default)
        homePage.route("/"),
        productDetailPage.route("/products/:id", {
            params: { id: int() },
        }),
        searchPage.route("/search"),

        // CSR-only route
        aboutPage.route("/about", { renderMode: "csr" }),

        // Guarded route — requires auth cookie
        homePage.route("/admin", { beforeLoad: [authGuard] }),
    ],
    getErrorPage: getErrorPage,
    afterLoad: [seoGuard],
});
