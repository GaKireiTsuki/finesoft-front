import type { BasePage } from "@finesoft/front";
import { useState } from "react";
import Navigation from "./components/Navigation";
import About from "./pages/About";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";
import ProductDetail from "./pages/ProductDetail";
import Search from "./pages/Search";

const pageComponents: Record<string, React.ComponentType<{ page: any }>> = {
    home: Home,
    product: ProductDetail,
    search: Search,
    about: About,
};

export default function App() {
    const [page, setPage] = useState<BasePage | null>(null);

    (window as unknown as { __updateApp?: (page: BasePage) => void }).__updateApp = (
        newPage: BasePage,
    ) => {
        setPage(newPage);
    };

    const PageComponent = page ? (pageComponents[page.pageType] ?? NotFound) : null;

    return (
        <>
            <Navigation />
            <main>{page && PageComponent && <PageComponent page={page} />}</main>
        </>
    );
}
