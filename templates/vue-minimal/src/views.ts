import { homePage, detailPage, notesPage } from "./app-definition";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import DetailView from "./views/DetailView.vue";
import NotesView from "./views/NotesView.vue";
export const views = {
    mode: "entries" as const,
    chrome: App,
    views: {
        ...homePage.bindView("home", HomeView),
        ...detailPage.bindView("detail", DetailView),
        ...notesPage.bindView("notes", NotesView),
    },
    props: ({
        initialSnapshot,
    }: {
        initialSnapshot: import("@finesoft/front/web").NavigationSnapshot;
    }) => ({ state: { name: "", snapshot: initialSnapshot } }),
};
