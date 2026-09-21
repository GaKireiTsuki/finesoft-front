import { appId } from "./config";
import { definePage, defineWebApp, int, str, withDefault } from "@finesoft/front";
import { AboutController } from "./lib/controllers/about";
import { HomeController } from "./lib/controllers/home";
import { ProductDetailController } from "./lib/controllers/product-detail";
import { SearchController } from "./lib/controllers/search";
import { authGuard } from "./lib/guards/auth";
import { seoGuard } from "./lib/guards/seo";
import { getErrorPage } from "./lib/controllers/error";
export const homePage = definePage({
    id: "home",
    create: () => new HomeController(),
    routes: ["/", { path: "/admin", beforeLoad: [authGuard] }],
});
export const productDetailPage = definePage({
    id: "product-detail",
    routes: [{ path: "/products/:id", params: { id: int() } }],
    create: () => new ProductDetailController(),
});
export const searchPage = definePage({
    id: "search",
    create: () => new SearchController(),
    routes: [{ path: "/search", query: { q: withDefault(str(), "") } }],
});
export const aboutPage = definePage({
    id: "about",
    create: () => new AboutController(),
    routes: [{ path: "/about", renderMode: "csr" }],
});
export const app = defineWebApp({
    id: appId,
    pages: [homePage, productDetailPage, searchPage, aboutPage],
    getErrorPage,
    afterLoad: [seoGuard],
});
