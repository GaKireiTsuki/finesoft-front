import { defineWebApp } from "@finesoft/front/browser";
import { traceUser } from "./middleware/trace-user";
import { HomeController } from "./controllers/home";
import { ImageProxyController } from "./controllers/image-proxy";
import { AdminSecretsController } from "./controllers/admin-secrets";
import { SearchController } from "./controllers/search";
import { ShareController } from "./controllers/share";
import { ProfileController } from "./controllers/profile";
import { StaticFileController } from "./controllers/static-file";
export const app = defineWebApp({
    id: "adversarial",
    routes: [
        { path: "/", intentId: "home" },
        {
            path: "/image-proxy",
            intentId: "image-proxy",
        },
        {
            path: "/admin/secrets",
            intentId: "admin-secrets",
        },
        { path: "/search", intentId: "search" },
        { path: "/share", intentId: "share" },
        {
            path: "/profile/:userId",
            intentId: "profile",
        },
        {
            path: "/static",
            intentId: "static-file",
        },
    ],
    controllers: [
        { id: "home", create: () => new HomeController() },
        { id: "image-proxy", create: () => new ImageProxyController() },
        { id: "admin-secrets", create: () => new AdminSecretsController() },
        { id: "search", create: () => new SearchController() },
        { id: "share", create: () => new ShareController() },
        { id: "profile", create: () => new ProfileController() },
        { id: "static-file", create: () => new StaticFileController() },
    ],
    beforeLoad: [traceUser],
    getErrorPage: (status, message) => ({
        id: "error",
        pageType: "error",
        title: String(status),
        description: message,
    }),
});
