import type { Action } from "@finesoft/front/web";
import Navigation from "./Navigation";

interface LayoutProps {
    children: React.ReactNode;
    currentPath?: string;
    onAction?: (action: Action) => void;
}

/** 公共布局 — 顶部导航栏 + 内容区 */
export function Layout({ children, currentPath = "/", onAction }: LayoutProps) {
    return (
        <div className="app-shell">
            <Navigation currentPath={currentPath} onAction={onAction} />
            <main className="app-main">{children}</main>
        </div>
    );
}
