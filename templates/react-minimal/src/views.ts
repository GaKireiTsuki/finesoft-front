import App from "./App";
import HomeView from "./views/HomeView";
import DetailView from "./views/DetailView";
import NotesView from "./views/NotesView";
export const views = {
    mode: "entries" as const,
    chrome: App,
    views: { home: HomeView, detail: DetailView, notes: NotesView },
};
