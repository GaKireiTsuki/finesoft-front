#!/usr/bin/env node
// 解析攻方报告里出现的所有 FLAG{...} 字符串，与内嵌真值比对，输出找到/漏掉。
// 注意：真值故意内嵌于此文件而不是放磁盘 JSON —— 防止 path-traversal 类漏洞让攻方
//       通过读取 truth-file 直接拿到答案，绕过实际攻击。
//
// 用法： node orchestrator/judge.mjs reports/round-1-attacker.md

import { readFileSync } from "node:fs";

const FLAG_TRUTH = {
    F1_ssrf: "FLAG{ssrf-9f3a1c2d}",
    F2_di_singleton: "FLAG{di-3e8b4c1a}",
    F3_stack_leak: "FLAG{stack-7b2d9e6c}",
    F4_ssr_fetch: "FLAG{redir-1f8e2a4b}",
    F5_prefetch_leak: "FLAG{prefetch-c2a9d8f1}",
};

const FLAG_RE = /FLAG\{[a-z0-9-]+\}/gi;

function main() {
    const reportPath = process.argv[2];
    if (!reportPath) {
        console.error("usage: judge.mjs <report-path>");
        process.exit(2);
    }
    const reportText = readFileSync(reportPath, "utf-8");

    const found = new Set();
    for (const match of reportText.matchAll(FLAG_RE)) {
        found.add(match[0]);
    }

    const byCategory = {};
    for (const [category, value] of Object.entries(FLAG_TRUTH)) {
        byCategory[category] = {
            expected: value,
            found: found.has(value),
        };
    }

    const captured = Object.values(byCategory).filter((x) => x.found).length;
    const total = Object.keys(byCategory).length;

    const output = {
        report: reportPath,
        score: `${captured}/${total}`,
        flags: byCategory,
        extras: [...found].filter((f) => !Object.values(FLAG_TRUTH).includes(f)),
    };

    console.log(JSON.stringify(output, null, 2));
    process.exit(captured === total ? 0 : 1);
}

main();
