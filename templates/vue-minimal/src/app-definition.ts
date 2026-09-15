import { definePage, defineWebApp, stack, tabs } from "@finesoft/front/web";
import { DetailController } from "./lib/controllers/detail";
import { HomeController } from "./lib/controllers/home";
import { NotesController } from "./lib/controllers/notes";
export const homePage = definePage({ id: "home", create: () => new HomeController() });
export const detailPage = definePage({ id: "detail", create: () => new DetailController() });
export const notesPage = definePage({ id: "notes", create: () => new NotesController() });
export const app = defineWebApp({
    id: "vue-minimal",
    controllers: [homePage, detailPage, notesPage],
    routes: [homePage.route("/"), detailPage.route("/item/:id"), notesPage.route("/notes")],
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
            ? stack([homePage.leaf(), detailPage.leaf({ id: detail[1] })])
            : stack(homePage.leaf());
        return tabs({
            active: path === "/notes" ? "notes" : "home",
            branches: { home, notes: stack(notesPage.leaf()) },
        });
    },
});
