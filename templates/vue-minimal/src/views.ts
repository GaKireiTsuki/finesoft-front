import App from "./App.vue";
import { detailPage, homePage, notesPage } from "./app-definition";
import Home from "./pages/Home.vue";
import Detail from "./pages/Detail.vue";
import Notes from "./pages/Notes.vue";
import NotFound from "./pages/NotFound.vue";

export const views = {
    mode: "entries" as const,
    chrome: App,
    views: {
        ...homePage.bindView("home", Home),
        ...detailPage.bindView("detail", Detail),
        ...notesPage.bindView("notes", Notes),
        error: NotFound,
    },
};
