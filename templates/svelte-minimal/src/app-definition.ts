import { defineWebApp } from "@finesoft/front/web";
import { HomeController } from "./lib/controllers/home";
import { loadMessages } from "virtual:finesoft-front/i18n-loader";
export const app = defineWebApp({
    id: "svelte-minimal",
    controllers: [{ id: "home", create: () => new HomeController() }],
    routes: [{ path: "/", intentId: "home" }],
    getErrorPage: (status, message) => ({
        id: "error",
        pageType: "error",
        title: "Error " + status,
        description: message,
    }),

    loadMessages,
    frameworkConfig: { locale: "zh-Hans" },
});
