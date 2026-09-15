import { definePage, defineWebApp } from "@finesoft/front/web";
import { HomeController } from "./lib/controllers/home";
import { loadMessages } from "virtual:finesoft-front/i18n-loader";
export const homePage = definePage({ id: "home", create: () => new HomeController() });
export const app = defineWebApp({
    id: "svelte-minimal",
    controllers: [homePage],
    routes: [homePage.route("/")],
    getErrorPage: (status, message) => ({
        id: "error",
        pageType: "error",
        title: "Error " + status,
        description: message,
    }),

    loadMessages,
    frameworkConfig: { locale: "zh-Hans" },
});
