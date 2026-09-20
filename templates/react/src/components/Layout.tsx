import Navigation from "./Navigation";

interface LayoutProps {
    children: React.ReactNode;
    currentPath?: string;
}

/** 公共布局 — 顶部导航栏 + 内容区 */
export function Layout({ children, currentPath = "/" }: LayoutProps) {
    return (
        <div className="app-shell">
            <Navigation currentPath={currentPath} />
            <main className="app-main">{children}</main>
        </div>
    );
}
