// test/cases-hover-lint.mjs —— 悬停规则静态守卫（方案 A）
//
// ── 为什么需要它 ──
// 2026-10-03 的方案 A（悬停统一走 hoverPool/hoverEvent、元信息彻底删掉）只审计了**主源**，
// 结果 6 个**备选源**（uma-jp-umapyoi / bandori-bestdori-gacha / uma-cn-bwiki / kedr-kaxi /
// uma-jp-bwiki / stellasora-bwiki）的悬停一直不合规却没被发现 —— 用户看到的正是「同一个插件里
// 悬停样式不一致」。教训是：**规则只靠人工审计守不住**，得让机器天天查。
//
// 本守卫做两件事（都是静态的，不需要网络）：
//   ① 扫 `src/client/42-parsers-*.js` 的**字符串/模板字面量**（跳过注释，免得解释性注释误报），
//      命中已知的元信息写法就失败；
//   ② 扫是否又出现了"本地自制悬停排版"（`buildPoolHover` / `buildEventHover` / `permanentLine`
//      这类函数名）—— 排版只允许有 hoverPool / hoverEvent 一处实现。
//
// ⚠️ 只扫**字面量**很关键：源码注释里会大量引用被禁的写法来解释历史（那是好事）。

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "src", "client");

// 去掉注释后，抽出所有字符串 / 模板字面量的**内容**。
// ⚠️ 必须**正确识别正则字面量**：`/["']/` 这类写法里的引号会让朴素扫描器错位，
//    把后面的代码当成字符串（本守卫第一版就这样误报了 2 处）。
//    判据用经典启发式：`/` 前面是"值"（标识符/数字/`)`/`]`）时是除法，否则是正则；
//    再补上 `return` / `typeof` / `case` / `in` / `of` / `new` 这几个关键字后的正则。
const REGEX_AFTER_WORD = /^(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;
function stringLiterals(src) {
	const out = [];
	let i = 0, prev = "";
	const n = src.length;
	while (i < n) {
		const c = src[i], c2 = src[i + 1];
		if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") i++; prev = "\n"; continue; }
		if (c === "/" && c2 === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
		if (c === "/") {
			// 往回取一个"词"，判断这个 `/` 是正则还是除号
			let j = i - 1;
			while (j >= 0 && /\s/.test(src[j])) j--;
			let k = j;
			while (k >= 0 && /[\w$]/.test(src[k])) k--;
			const word = src.slice(k + 1, j + 1);
			const valueLike = j >= 0 && /[\w$)\]]/.test(src[j]) && !REGEX_AFTER_WORD.test(word);
			if (!valueLike) {
				i++;                                  // 跳过正则字面量
				let inClass = false;
				while (i < n) {
					if (src[i] === "\\") { i += 2; continue; }
					if (src[i] === "[") inClass = true;
					else if (src[i] === "]") inClass = false;
					else if (src[i] === "/" && !inClass) { i++; break; }
					else if (src[i] === "\n") break;
					i++;
				}
				prev = "/";
				continue;
			}
		}
		if (c === '"' || c === "'" || c === "`") {
			const q = c; let buf = ""; i++;
			while (i < n) {
				if (src[i] === "\\") { buf += src[i + 1] || ""; i += 2; continue; }
				if (src[i] === q) { i++; break; }
				buf += src[i]; i++;
			}
			out.push(buf);
			prev = '"';
			continue;
		}
		if (!/\s/.test(c)) prev = c;
		i++;
	}
	return out;
}

// 禁止出现在**悬停文本**里的元信息写法。
// 注意：这些词允许出现在**插件其它地方**（如设置页文案、来源标签），所以只查解析器文件。
const FORBIDDEN = [
	[/end_date\s*=|start_date\s*=/, "源站字段名（如 end_date=2147483647）"],
	[/\bclosedAt\s*=|\bpublishedAt\s*=/, "源站字段名"],
	[/哨兵/, "实现细节（哨兵值）"],
	[/未列出|未计入/, "抓取统计（另有 N 个未列出）"],
	[/非官方时刻表|按日服时差推算/, "来源/推算说明"],
	[/源站为|源站只有|无卡池名/, "来源说明"],
	[/^\s*——\s|\s——\s*$/, "分隔线装饰"],
	[/（id[ 　]/, "内部 id"],
	[/以及常驻活动\s*\$\{/, "常驻计数行（应走共用 hoverEvent 的 permanentCount）"],
	// ↓ 2026-10-03 扩：第一次只列了上面几条，漏掉下面这类"可信度/时区说明"，
	//   结果 kedr / ddlezj 的元信息行逃过了守卫（靠人工看测试断言才发现）。
	[/社区页|非官方源|非官方|社区维护|社区推算|社区数据库/, "来源可信度说明"],
	[/推测|推断|估算/, "时区/时刻推定说明"],
	[/tz\s*=|UTC[+-]\d|时区/, "时区说明（应在来源声明的 tz 字段里，不进悬停）"],
	[/自标|源站正文/, "源站字段/正文说明"],
];

export default async function run() {
	section("悬停规则静态守卫（方案 A：只有名称与档期，元信息一律不许进）");
	const files = readdirSync(SRC).filter((f) => /^42-parsers-.*\.js$/.test(f)).sort();
	check("解析器文件齐备（17 个）", files.length === 17, String(files.length));

	const hit = [];
	for (const f of files) {
		const lits = stringLiterals(readFileSync(path.join(SRC, f), "utf8"));
		for (const s of lits) {
			for (const [re, why] of FORBIDDEN) {
				if (re.test(s)) hit.push(`${f}: ${why}  ← ${JSON.stringify(s.slice(0, 70))}`);
			}
		}
	}
	check("字符串里没有已知的悬停元信息写法", hit.length === 0, hit.slice(0, 6).join(" / "));

	// 排版只允许一处实现：不许再出现本地自制的 buildPoolHover / buildEventHover / permanentLine
	const LOCAL = /(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=(]/g;
	const localHover = [];
	for (const f of files) {
		const code = readFileSync(path.join(SRC, f), "utf8")
			.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
		for (const m of code.matchAll(LOCAL)) {
			const name = m[1].replace(/^ns_[a-z0-9_]+?_/i, "");
			if (/^(buildPoolHover|buildEventHover|permanentLine|hoverPool|hoverEvent)$/.test(name)) {
				localHover.push(`${f}: ${m[1]}`);
			}
		}
	}
	check("没有本地自制的悬停排版实现（只允许共用 hoverPool / hoverEvent）", localHover.length === 0, localHover.join(" / "));

	// 反证：共用工具必须真的在（否则上面的守卫会因为"没实现"而假通过）
	const shared = readFileSync(path.join(SRC, "41-sources-shared.js"), "utf8");
	check("共用工具 hoverPool / hoverEvent 存在", /function hoverPool\(/.test(shared) && /function hoverEvent\(/.test(shared));
	check("长期/常驻阈值只有一处（本体 LONG_TERM_MAX_WINDOW_DAYS）",
		["30-parsers.js", "41-sources-shared.js", "42-parsers-bestdori.js", "42-parsers-sekai.js"]
			.every((f) => {
				const t = readFileSync(path.join(SRC, f), "utf8");
				if (f === "30-parsers.js") return /const LONG_TERM_MAX_WINDOW_DAYS = \d+;/.test(t);
				if (f === "41-sources-shared.js") return /isLongTermWindow/.test(t) && !/HOVER_MAX_WINDOW_DAYS/.test(t.replace(/\/\/.*$/gm, ""));
				return /LONG_TERM_MAX_WINDOW_DAYS \* 864e5/.test(t) && !/=\s*(?:120|400)\s*\*\s*86400e3/.test(t);
			}));
}
