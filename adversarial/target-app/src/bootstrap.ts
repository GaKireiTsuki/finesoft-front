import { type Framework, defineRoutes } from "@finesoft/front";
import { traceUser } from "./middleware/trace-user";
import { HomeController } from "./controllers/home";
import { ImageProxyController } from "./controllers/image-proxy";
import { AdminSecretsController } from "./controllers/admin-secrets";
import { SearchController } from "./controllers/search";
import { ShareController } from "./controllers/share";
import { ProfileController } from "./controllers/profile";
import { StaticFileController } from "./controllers/static-file";

export function bootstrap(framework: Framework): void {
    framework.beforeLoad(traceUser);

    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
        {
            path: "/image-proxy",
            intentId: "image-proxy",
            controller: new ImageProxyController(),
        },
        {
            path: "/admin/secrets",
            intentId: "admin-secrets",
            controller: new AdminSecretsController(),
        },
        { path: "/search", intentId: "search", controller: new SearchController() },
        { path: "/share", intentId: "share", controller: new ShareController() },
        {
            path: "/profile/:userId",
            intentId: "profile",
            controller: new ProfileController(),
        },
        {
            path: "/static",
            intentId: "static-file",
            controller: new StaticFileController(),
        },
    ]);
}
