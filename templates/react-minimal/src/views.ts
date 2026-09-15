import App from "./App";
import { detailPage, homePage, notesPage } from "./app-definition";
import Home from "./pages/Home";
import Detail from "./pages/Detail";
import Notes from "./pages/Notes";
import NotFound from "./pages/NotFound";

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
