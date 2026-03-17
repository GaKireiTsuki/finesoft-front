import type { Action } from "@finesoft/front";
import { Layout } from "./components/Layout";
import { Loading } from "./components/Loading";
import { PageRenderer } from "./components/PageRenderer";
import type { AppPage } from "./lib/models/product";

interface AppProps {
    page?: AppPage | null;
    loading?: boolean;
    onAction?: (action: Action) => void;
}

export default function App({ page, loading = false, onAction }: AppProps) {
    return (
        <Layout currentPath={page?.url ?? "/"} onAction={onAction}>
            {loading && <Loading />}
            {page && <PageRenderer page={page} onAction={onAction} />}
        </Layout>
    );
}
