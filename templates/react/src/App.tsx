import { Outlet as selectOutlet, useSnapshot, type WebAppView } from "@finesoft/front";
import { Layout } from "./components/Layout";
import { views } from "./views";
const Outlet = selectOutlet("react");
export default function App({ app }: { readonly app: WebAppView }) {
    const snapshot = useSnapshot("react", app);
    return (
        <Layout currentPath={snapshot.entries.find((entry) => entry.visible)?.page.url ?? "/"}>
            <Outlet app={app} views={views} />
        </Layout>
    );
}
