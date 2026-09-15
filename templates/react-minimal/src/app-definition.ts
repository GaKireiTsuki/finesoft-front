import { defineWebApp, leaf, stack, tabs } from "@finesoft/front/web";
import { DetailController } from "./lib/controllers/detail";
import { HomeController } from "./lib/controllers/home";
import { NotesController } from "./lib/controllers/notes";
export const app = defineWebApp({
    id: "react-minimal",
    controllers: [
        { id: "home", create: () => new HomeController() },
        { id: "detail", create: () => new DetailController() },
        { id: "notes", create: () => new NotesController() },
    ],
    routes: [
        { path: "/", intentId: "home" },
        { path: "/item/:id", intentId: "detail" },
        { path: "/notes", intentId: "notes" },
    ],
    getErrorPage: (status, message) => ({
        id: "error",
        pageType: "error",
        title: "Error " + status,
        description: message,
    }),

    navigation: (url) => {
        const path = url.split("?")[0].split("#")[0];
        const detail = /^\/item\/(.+)$/.exec(path);
        const home = detail
            ? stack([leaf("home"), leaf("detail", { id: detail[1] })])
            : stack(leaf("home"));
        return tabs({
            active: path === "/notes" ? "notes" : "home",
            branches: { home, notes: stack(leaf("notes")) },
        });
    },
});
