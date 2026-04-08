import type { Action } from "@finesoft/front";
import type { KeepAliveViewEntry } from "@finesoft/front/react";
import { Layout } from "./components/Layout";
import { Loading } from "./components/Loading";
import { PageRenderer } from "./components/PageRenderer";
import type { AppPage } from "./lib/models/product";

interface AppProps {
    page?: AppPage | null;
    pages?: readonly KeepAliveViewEntry<AppPage>[];
    loading?: boolean;
    currentPath?: string;
    onAction?: (action: Action) => void;
    onCacheable?: (cacheKey: string, page: AppPage) => void;
}

export default function App({
    page = null,
    pages = [],
    loading = false,
    currentPath = "/",
    onAction,
    onCacheable,
}: AppProps) {
    const resolvedPages =
        pages.length > 0
            ? pages
            : page
              ? [
                    {
                        key: page.url ?? page.id,
                        page,
                        active: true,
                        cacheable: false,
                    },
                ]
              : [];

    return (
        <Layout currentPath={resolvedPages[0]?.page.url ?? currentPath} onAction={onAction}>
            {loading && <Loading />}
            <PageRenderer pages={resolvedPages} onAction={onAction} onCacheable={onCacheable} />
        </Layout>
    );
}
