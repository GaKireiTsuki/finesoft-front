import type { Action } from "@finesoft/front/web";
import { NAV_LINKS } from "../actions";

interface NavigationProps {
    currentPath?: string;
    onAction?: (action: Action) => void;
}

export default function Navigation({ currentPath = "/", onAction }: NavigationProps) {
    const handleNav = (action: Action) => (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (
            !onAction ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }
        event.preventDefault();
        onAction(action);
    };

    return (
        <nav className="navigation">
            {NAV_LINKS.map((link) => (
                <a
                    key={link.label}
                    href={link.path ?? link.action.url}
                    className={`navigation-link${link.path !== null && currentPath === link.path ? " active" : ""}`}
                    onClick={handleNav(link.action)}
                >
                    {link.label}
                </a>
            ))}
        </nav>
    );
}
