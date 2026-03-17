import type { Action } from "@finesoft/front";
import { makeExternalUrlAction, makeFlowAction } from "@finesoft/front";

const links = [
    { label: "Home", action: makeFlowAction("/"), path: "/" },
    { label: "Search", action: makeFlowAction("/search"), path: "/search" },
    { label: "About", action: makeFlowAction("/about"), path: "/about" },
    {
        label: "GitHub",
        action: makeExternalUrlAction("https://github.com/nicepkg/finesoft"),
        path: null,
    },
];

interface NavigationProps {
    currentPath?: string;
    onAction?: (action: Action) => void;
}

export default function Navigation({ currentPath = "/", onAction }: NavigationProps) {
    const handleNav = (action: Action) => (e: React.MouseEvent) => {
        e.preventDefault();
        onAction?.(action);
    };

    return (
        <nav
            style={{
                display: "flex",
                gap: "1rem",
                padding: "1rem",
                borderBottom: "1px solid #eee",
            }}
        >
            {links.map((link) => (
                <a
                    key={link.label}
                    href={link.action.url}
                    style={{
                        textDecoration: "none",
                        color: link.path === currentPath ? "#007bff" : "#333",
                        fontWeight: link.path === currentPath ? "bold" : "normal",
                    }}
                    onClick={handleNav(link.action)}
                >
                    {link.label}
                </a>
            ))}
        </nav>
    );
}
