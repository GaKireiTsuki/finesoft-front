import type { Action } from "@finesoft/front";
import type { AppPage } from "../lib/models/product";
import About from "../pages/About";
import Home from "../pages/Home";
import NotFound from "../pages/NotFound";
import ProductDetail from "../pages/ProductDetail";
import Search from "../pages/Search";

interface PageRendererProps {
    page: AppPage;
    onAction?: (action: Action) => void;
}

/** 根据 pageType 分发渲染对应组件 */
export function PageRenderer({ page, onAction }: PageRendererProps) {
    switch (page.pageType) {
        case "home":
            return <Home page={page} onAction={onAction} />;
        case "product":
            return <ProductDetail page={page} onAction={onAction} />;
        case "search":
            return <Search page={page} onAction={onAction} />;
        case "about":
            return <About page={page} onAction={onAction} />;
        case "error":
            return <NotFound page={page} onAction={onAction} />;
        default:
            return (
                <NotFound
                    page={{
                        id: "unknown",
                        pageType: "error",
                        title: "Unknown Page",
                        description: "Page not found",
                        status: 404,
                    }}
                    onAction={onAction}
                />
            );
    }
}
