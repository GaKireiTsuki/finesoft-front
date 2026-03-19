import { defineBootstrap, defineRoutes } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";

export const bootstrap = defineBootstrap(
    {
        frameworkConfig: {
            // Change this to "zh-Hans" to load src/locales/zh-Hans.json instead.
            locale: "zh-Hans",
        },
    },
    (framework) => {
        defineRoutes(framework, [
            { path: "/", intentId: "home", controller: new HomeController() },
        ]);
    },
);
