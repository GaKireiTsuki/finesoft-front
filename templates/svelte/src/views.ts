import About from "./pages/About.svelte";
import Home from "./pages/Home.svelte";
import NotFound from "./pages/NotFound.svelte";
import ProductDetail from "./pages/ProductDetail.svelte";
import Search from "./pages/Search.svelte";
export const views = {
    home: Home,
    product: ProductDetail,
    search: Search,
    about: About,
    error: NotFound,
};
