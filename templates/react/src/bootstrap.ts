import { type Framework, defineRoutes } from "@finesoft/front";
import { AboutController } from "./lib/controllers/about";
import { HomeController } from "./lib/controllers/home";
import { ProductDetailController } from "./lib/controllers/product-detail";
import { SearchController } from "./lib/controllers/search";
import { authGuard } from "./lib/guards/auth";
import { seoGuard } from "./lib/guards/seo";

export function bootstrap(framework: Framework): void {
    framework.afterLoad(seoGuard);

    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
        {
            path: "/products/:id",
            intentId: "product-detail",
            controller: new ProductDetailController(),
        },
        {
            path: "/search",
            intentId: "search",
            controller: new SearchController(),
        },
        {
            path: "/about",
            intentId: "about",
            controller: new AboutController(),
            renderMode: "csr",
        },
        {
            path: "/admin",
            intentId: "home",
            beforeLoad: [authGuard],
        },
    ]);
}
