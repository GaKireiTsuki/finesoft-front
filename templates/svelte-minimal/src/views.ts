import App from "./App.svelte";
import { detailPage, homePage, notesPage } from "./app-definition";
import Home from "./pages/Home.svelte";
import Detail from "./pages/Detail.svelte";
import Notes from "./pages/Notes.svelte";
import NotFound from "./pages/NotFound.svelte";

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
