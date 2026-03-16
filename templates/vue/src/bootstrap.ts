import { type Framework, defineRoutes } from "@finesoft/front";
import { AboutController } from "./lib/controllers/about";
import { HomeController } from "./lib/controllers/home";
import { ProductDetailController } from "./lib/controllers/product-detail";
import { SearchController } from "./lib/controllers/search";
import { authGuard } from "./lib/guards/auth";
import { seoGuard } from "./lib/guards/seo";

export function bootstrap(framework: Framework): void {
    // Global afterLoad guard — SEO URL normalization
    framework.afterLoad(seoGuard);

    defineRoutes(framework, [
        // SSR routes (default)
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

        // CSR-only route
        {
            path: "/about",
            intentId: "about",
            controller: new AboutController(),
            renderMode: "csr",
        },

        // Guarded route — requires auth cookie
        {
            path: "/admin",
            intentId: "home",
            beforeLoad: [authGuard],
        },
    ]);
}
