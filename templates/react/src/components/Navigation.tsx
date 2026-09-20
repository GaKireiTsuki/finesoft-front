interface NavigationProps {
    currentPath?: string;
}
const links = [
    { label: "Home", href: "/" },
    { label: "Search", href: "/search" },
    { label: "About", href: "/about" },
    { label: "GitHub", href: "https://github.com/nicepkg/finesoft" },
] as const;
export default function Navigation({ currentPath = "/" }: NavigationProps) {
    return (
        <nav className="navigation">
            {links.map((link) => (
                <a
                    key={link.label}
                    href={link.href}
                    className={`navigation-link${currentPath === link.href ? " active" : ""}`}
                >
                    {link.label}
                </a>
            ))}
        </nav>
    );
}
