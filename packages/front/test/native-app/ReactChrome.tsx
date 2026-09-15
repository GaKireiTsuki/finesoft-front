import type { NavigationSnapshot } from "@finesoft/front/web";
type ViewProps = { initialSnapshot: NavigationSnapshot };
export default function Chrome({ initialSnapshot }: ViewProps) {
    return (
        <output data-chrome>{initialSnapshot.destinations.at(-1)?.page.title ?? "empty"}</output>
    );
}
