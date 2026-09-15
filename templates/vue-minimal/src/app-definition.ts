import { loadMessages } from "virtual:finesoft-front/i18n-loader";
import { appId } from "./config";
import { getErrorPage } from "./lib/controllers/error";
import { definePage, defineWebApp, stack, tabs } from "@finesoft/front/web";
import { DetailController } from "./lib/controllers/detail";
import { HomeController } from "./lib/controllers/home";
import { NotesController } from "./lib/controllers/notes";
export const homePage = definePage({ id: "home", create: () => new HomeController() });
export const detailPage = definePage({ id: "detail", create: () => new DetailController() });
export const notesPage = definePage({ id: "notes", create: () => new NotesController() });
export function createNavigation(url: string) {
    const path = url.split("?")[0].split("#")[0];
    const detail = /^\/item\/([^/]+)$/.exec(path);
    if (path !== "/" && path !== "/notes" && !detail) return undefined;
    const home = detail
        ? stack([homePage.leaf(), detailPage.leaf({ id: detail[1] })])
        : stack(homePage.leaf());
    return tabs({
        active: path === "/notes" ? "notes" : "home",
        branches: { home, notes: stack(notesPage.leaf()) },
    });
}

export const app = defineWebApp({
    id: appId,
    loadMessages,
    frameworkConfig: { locale: "zh-Hans" },
    controllers: [homePage, detailPage, notesPage],
    routes: [homePage.route("/"), detailPage.route("/item/:id"), notesPage.route("/notes")],
    getErrorPage,

    navigation: createNavigation,
});
