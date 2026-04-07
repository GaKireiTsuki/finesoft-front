import { describe, expect, test } from "vite-plus/test";
import { SSR_PLACEHOLDERS, injectCSRShell, injectSSRContent } from "../src/inject";

describe("SSR injection helpers", () => {
    test("injects SSR placeholders, custom slots, CSS, and locale attributes", () => {
        const template = [
            '<html lang="en" dir="ltr">',
            "<head><!--ssr-head--><!--ssr-extra--></head>",
            `<body>${SSR_PLACEHOLDERS.BODY}${SSR_PLACEHOLDERS.DATA}</body>`,
            "</html>",
        ].join("");

        const result = injectSSRContent({
            template,
            head: '<meta charset="utf-8">',
            css: ".app{color:red}",
            html: "<main>Hello</main>",
            serializedData: '{"ok":true}',
            slots: { extra: '<link rel="preload">' },
            locale: { lang: "ja-JP", dir: "ltr" },
        });

        expect(result).toContain('<html lang="ja-JP" dir="ltr">');
        expect(result).toContain('<meta charset="utf-8">');
        expect(result).toContain("<style>.app{color:red}</style>");
        expect(result).toContain("<main>Hello</main>");
        expect(result).toContain('<link rel="preload">');
        expect(result).toContain(
            '<script id="serialized-server-data" type="application/json">{"ok":true}</script>',
        );
    });

    test("strips placeholders for CSR shell rendering", () => {
        const template =
            "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--><!--ssr-extra--></body></html>";

        expect(injectCSRShell(template, { lang: "fr-FR", dir: "ltr" })).toBe(
            '<html lang="fr-FR" dir="ltr"><head></head><body></body></html>',
        );
    });
});
