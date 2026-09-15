import { homePage, detailPage, notesPage } from "./app-definition";
import App from "./App";
import HomeView from "./views/HomeView";
import DetailView from "./views/DetailView";
import NotesView from "./views/NotesView";
export const views = {
    mode: "entries" as const,
    chrome: App,
    views: {
        ...homePage.bindView("home", HomeView),
        ...detailPage.bindView("detail", DetailView),
        ...notesPage.bindView("notes", NotesView),
    },
};
