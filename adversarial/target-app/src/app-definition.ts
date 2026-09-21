import { definePage, defineWebApp } from "@finesoft/front";
import { HomeController } from "./controllers/home";
import { ImageProxyController } from "./controllers/image-proxy";
import { AdminSecretsController } from "./controllers/admin-secrets";
import { SearchController } from "./controllers/search";
import { ShareController } from "./controllers/share";
import { ProfileController } from "./controllers/profile";
import { StaticFileController } from "./controllers/static-file";
export const app = defineWebApp({
    id: "adversarial",
    pages: [
        definePage({ id: "home", create: () => new HomeController(), routes: ["/"] }),
        definePage({
            id: "image-proxy",
            create: () => new ImageProxyController(),
            routes: ["/image-proxy"],
        }),
        definePage({
            id: "admin-secrets",
            create: () => new AdminSecretsController(),
            routes: ["/admin/secrets"],
        }),
        definePage({ id: "search", create: () => new SearchController(), routes: ["/search"] }),
        definePage({ id: "share", create: () => new ShareController(), routes: ["/share"] }),
        definePage({
            id: "profile",
            create: () => new ProfileController(),
            routes: ["/profile/:userId"],
        }),
        definePage({
            id: "static-file",
            create: () => new StaticFileController(),
            routes: ["/static"],
        }),
    ],
    getErrorPage: (status, message) => ({
        id: "error",
        pageType: "error",
        title: String(status),
        description: message,
    }),
});
