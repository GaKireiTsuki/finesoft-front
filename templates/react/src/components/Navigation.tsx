import { makeExternalUrlAction, makeFlowAction } from "@finesoft/front";

const links = [
    { label: "Home", action: makeFlowAction("/") },
    { label: "Search", action: makeFlowAction("/search") },
    { label: "About", action: makeFlowAction("/about") },
    { label: "GitHub", action: makeExternalUrlAction("https://github.com") },
];

export default function Navigation() {
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
                    style={{ textDecoration: "none", color: "#333" }}
                >
                    {link.label}
                </a>
            ))}
        </nav>
    );
}
