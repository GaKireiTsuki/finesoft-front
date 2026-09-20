import { loadMessages } from "virtual:finesoft-front/i18n-loader";
import { appId } from "./config";
import { getErrorPage } from "./lib/controllers/error";
import {
    definePage,
    defineWebApp,
    stack,
    tabs,
    type LeafNode,
    type RouteMatch,
} from "@finesoft/front/web";
import { DetailController } from "./lib/controllers/detail";
import { HomeController } from "./lib/controllers/home";
import { NotesController } from "./lib/controllers/notes";
export const homePage = definePage({
    id: "home",
    create: () => new HomeController(),
    routes: ["/"],
});
export const detailPage = definePage({
    id: "detail",
    create: () => new DetailController(),
    routes: ["/item/:id"],
});
export const notesPage = definePage({
    id: "notes",
    create: () => new NotesController(),
    routes: ["/notes"],
});
export function createNavigation({ match, target }: { match?: RouteMatch; target?: LeafNode }) {
    if (!match || !target) return undefined;
    const home =
        match.intent.id === "detail" ? stack([homePage.leaf(), target]) : stack(homePage.leaf());
    return tabs({
        active: match.intent.id === "notes" ? "notes" : "home",
        branches: { home, notes: stack(match.intent.id === "notes" ? target : notesPage.leaf()) },
    });
}

export const app = defineWebApp({
    id: appId,
    loadMessages,
    configuration: { locale: "zh-Hans" },
    pages: [homePage, detailPage, notesPage],
    getErrorPage,

    navigation: createNavigation,
});
