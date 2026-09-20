import About from "./pages/About.vue";
import Home from "./pages/Home.vue";
import NotFound from "./pages/NotFound.vue";
import ProductDetail from "./pages/ProductDetail.vue";
import Search from "./pages/Search.vue";
export const views = {
    home: Home,
    product: ProductDetail,
    search: Search,
    about: About,
    error: NotFound,
};
