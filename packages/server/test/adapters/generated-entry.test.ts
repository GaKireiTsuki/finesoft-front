import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { generateSSREntry } from "../../src/adapters/shared";

test("the exact generated deploy module parses without string repair", () => {
    const dir = mkdtempSync(join(tmpdir(), "finesoft-emitted-"));
    try {
        const code = generateSSREntry(
            {
                templateHtml:
                    "<html><!--ssr-head--><!--ssr-body--><!--ssr-extra--><!--ssr-data--></html>",
                ssrEntry: "ssr.mjs",
            } as never,
            { dnsPolicy: "hostname", platformImport: "", platformExport: "export default app;" },
        );
        const file = join(dir, "entry.mjs");
        writeFileSync(file, code);
        expect(() =>
            execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }),
        ).not.toThrow();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("the exact emitted module imports and responds through the published portable entry", () => {
    // Under front for package-name self resolution; the child process uses built JS, no source aliases.
    const dir = mkdtempSync(
        fileURLToPath(new URL("../../../front/.generated-entry-", import.meta.url)),
    );
    try {
        writeFileSync(
            join(dir, "ssr.mjs"),
            `
export async function render(url, context) {
  const base = {html:'hello',head:'<title>page</title>',css:'body{}',serverData:{public:true},slots:{extra:'custom-slot'},locale:{lang:'ar',dir:'rtl'}};
  if(url === '/redirect') return {...base,redirect:{url:'/login',status:307},headers:[['set-cookie','a=1'],['set-cookie','b=2']]};
  if(url === '/denied') return {...base,status:403};
  if(url === '/internal') return {...base,html:await (await context.fetch('/api')).text()};
  return base;
}
export const serializeServerData=JSON.stringify;
`,
        );
        writeFileSync(
            join(dir, "setup.mjs"),
            `export default app => {
                app.use('/proxy/*', async (c, next) => c.req.header('x-session') === 'allowed' ? next() : c.text('Unauthorized', 401));
                app.get('/api', c => c.text(String(c.env.tenant)));
            };`,
        );
        const code = generateSSREntry(
            {
                templateHtml:
                    "<html><!--ssr-head--><!--ssr-body--><!--ssr-extra--><!--ssr-data--></html>",
                ssrEntry: "ssr.mjs",
                setupPath: "setup.mjs",
                defaultLocale: "ar",
                renderModes: { "/shell/*": "csr" },
                proxies: [
                    {
                        prefix: "/proxy",
                        target: "https://upstream.example",
                        headers: { "x-config": 'a"b\\c' },
                        cache: "max-age=60",
                        auth: { type: "bearer", envKey: "GENERATED_PROXY_TOKEN" },
                    },
                ],
            } as never,
            { dnsPolicy: "hostname", platformImport: "", platformExport: "export default app;" },
        );
        const file = join(dir, "entry.mjs");
        writeFileSync(file, code);
        const probe = `
import assert from 'node:assert/strict';
import app from ${JSON.stringify(file)};
let response=await app.fetch(new Request('https://test/denied'),{tenant:'one'});
assert.equal(response.status,403); let html=await response.text(); assert.ok(html.includes('custom-slot'));assert.ok(html.includes('lang="ar" dir="rtl"'));
response=await app.fetch(new Request('https://test/redirect'));assert.equal(response.status,307);assert.equal(response.headers.get('location'),'/login');assert.deepEqual(response.headers.getSetCookie(),['a=1','b=2']);
response=await app.fetch(new Request('https://test/internal'),{tenant:'first'});assert.ok((await response.text()).includes('first'));
response=await app.fetch(new Request('https://test/internal'),{tenant:'second'});assert.ok((await response.text()).includes('second'));
response=await app.fetch(new Request('https://test/shell/path'));html=await response.text();assert.ok(html.includes('lang="ar" dir="rtl"'));assert.ok(!html.includes('hello'));
const originalFetch=globalThis.fetch;
const binary=new Uint8Array([0x89,0x50,0xff,0xfe]);
const requests=[];
globalThis.fetch=async (url,init)=>{requests.push({url,init});return new Response(binary,{headers:{'content-type':'image/png'}});};
try {
  process.env.GENERATED_PROXY_TOKEN='runtime-secret';
  response=await app.fetch(new Request('https://test/proxy/image?v=2'));
  assert.equal(response.status,401);assert.equal(requests.length,0);
  const authorized={headers:{'x-session':'allowed'}};
  response=await app.fetch(new Request('https://test/proxy/image?v=2',authorized));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),binary);
  assert.equal(response.headers.get('cache-control'),'max-age=60');
  assert.equal(requests[0].url,'https://upstream.example/image?v=2');
  assert.equal(requests[0].init.headers.Authorization,'Bearer runtime-secret');
  assert.equal(requests[0].init.headers['x-config'],${JSON.stringify('a"b\\c')});
  response=await app.fetch(new Request('https://test/proxy/%2Fprivate',authorized));
  assert.equal(response.status,400);assert.equal(requests.length,1);
  const nodeProcess=globalThis.process;
  try { globalThis.process=undefined; response=await app.fetch(new Request('https://test/proxy/edge',authorized)); }
  finally { globalThis.process=nodeProcess; }
  assert.equal(response.status,200);assert.equal(requests[1].init.headers.Authorization,undefined);
} finally { globalThis.fetch=originalFetch;delete process.env.GENERATED_PROXY_TOKEN; }
console.log('exact emitted module: imported and response contract passed');
`;
        expect(
            execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
                encoding: "utf8",
            }),
        ).toContain("response contract passed");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
