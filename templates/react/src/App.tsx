import { Outlet, useSnapshot, type WebAppView } from "@finesoft/front/react";
import { Layout } from "./components/Layout";
import { views } from "./views";
export default function App({ app }: { readonly app: WebAppView }) {
    const snapshot = useSnapshot(app);
    return (
        <Layout currentPath={snapshot.entries.find((entry) => entry.visible)?.page.url ?? "/"}>
            <Outlet app={app} views={views} />
        </Layout>
    );
}
