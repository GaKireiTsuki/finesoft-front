import type { Action } from "@finesoft/front";
import { NAV_ACTIONS } from "../actions";

interface LayoutProps {
    children: React.ReactNode;
    currentPath?: string;
    onAction?: (action: Action) => void;
}

/** 公共布局 — 顶部导航栏 + 内容区 */
export function Layout({ children, currentPath = "/", onAction }: LayoutProps) {
    const handleNav = (action: Action) => (e: React.MouseEvent) => {
        e.preventDefault();
        onAction?.(action);
    };

    const navItems = [
        { label: "Home", action: NAV_ACTIONS.home, path: "/" },
        { label: "Search", action: NAV_ACTIONS.search, path: "/search" },
        { label: "About", action: NAV_ACTIONS.about, path: "/about" },
    ];

    return (
        <div>
            <nav
                style={{
                    display: "flex",
                    gap: "1rem",
                    padding: "1rem",
                    borderBottom: "1px solid #eee",
                    alignItems: "center",
                }}
            >
                {navItems.map((item) => (
                    <a
                        key={item.path}
                        href={item.path}
                        style={{
                            textDecoration: "none",
                            color: currentPath === item.path ? "#007bff" : "#333",
                            fontWeight: currentPath === item.path ? "bold" : "normal",
                        }}
                        onClick={handleNav(item.action)}
                    >
                        {item.label}
                    </a>
                ))}
                <a
                    href={NAV_ACTIONS.github.url}
                    style={{
                        marginLeft: "auto",
                        textDecoration: "none",
                        color: "#333",
                    }}
                    onClick={handleNav(NAV_ACTIONS.github)}
                >
                    GitHub ↗
                </a>
            </nav>
            <main style={{ padding: "1rem" }}>{children}</main>
        </div>
    );
}
