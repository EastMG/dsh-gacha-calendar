// test/cases-star.mjs —— 设置页底部「去 GitHub 点个 Star」指引（静态守卫）
//
// ── 为什么需要它 ──
// 这是一行**纯展示**的推广文字，没有任何数据链路依赖它，所以它坏掉时不会有任何报错：
//   · href 写错（仓库改名 / 手滑漏字母）⇒ 点开 404，只有真人去点才会发现；
//   · 忘了 target="_blank" / rel ⇒ 在当前页打开（设置页被顶掉）或把 opener 交给目标站；
//   · 被挪到游戏列表**上面**或被做成按钮 ⇒ 抢设置页的视线，与"低调一行字"的原意相反；
//   · 改了 src/ 忘了 node build.mjs ⇒ 产物里根本没有这一行（用户看不到，测试也全绿）。
// 这些都不影响功能，靠人眼审计守不住，所以在这里静态钉死：
//   ① 位置：在 CalendarSettingsPage 的 render 内、游戏列表 / 自检 / 来源说明**之后**，
//      且是 children 数组的**最末一项**（其后不再有任何 jsx 子元素）；
//   ② 契约：<a> + 正字 href + target="_blank" + rel 两个值齐 + 文案一字不差；
//   ③ 外观：.gacha-cal-star-link = 11~12px + 三级字色 + 无底块 + 上方 8~12px 留白，
//      hover 只变文字（下划线 + 次级字色）；
//   ④ 产物：lib/client.js 里也要有（src/ 是唯一真源，build 是唯一出口）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SRC = path.join(REPO, "src", "client");

// 需求原文（用户 2026-10-28 指定）：一字不差，不要额外标点。
const STAR_TEXT = "⭐ 觉得好用？去 GitHub 点个 Star";
const REPO_URL = "https://github.com/EastMG/dsh-gacha-calendar";

export default async function run() {
	section("设置页底部 Star 指引（静态）");

	const comp = readFileSync(path.join(SRC, "80-components.js"), "utf8");
	const css = readFileSync(path.join(SRC, "70-styles.js"), "utf8");
	const lib = readFileSync(path.join(REPO, "lib", "client.js"), "utf8");

	// ── ① 定位设置页渲染区域（守卫自身不许瞎）──────────────────────────────
	const start = comp.indexOf("function CalendarSettingsPage(");
	const end = comp.indexOf("//#endregion", start);
	const region = start >= 0 && end > start ? comp.slice(start, end) : "";
	check("能定位 CalendarSettingsPage 的函数体（守卫自身没瞎）", start >= 0 && end > start, `start=${start} end=${end}`);
	check("该函数体里确认是 720px 宽的那层设置页容器（定位到的是对的那段）",
		/maxWidth: 720/.test(region));

	// 锚点：以 href 那一行为基准切出**这个 <a> 的整块**。
	// ⚠️ 不能从 href 那行开始切：`(0, …jsx)("a", {` 与 `className:` 都在它**前面**，
	//    那样切会让「是 <a> 不是 button」「用了 .gacha-cal-star-link」两条断言假红。
	const anchorAt = region.indexOf('href: "' + REPO_URL + '"');
	const elAt = region.lastIndexOf('(0, react_jsx_runtime.jsx)("a", {', anchorAt);
	const elEnd = elAt >= 0 ? region.indexOf("}", elAt) : -1;
	const anchorBlock = elAt >= 0 && elEnd > elAt ? region.slice(elAt, elEnd + 1) : "";
	check("设置页里找到了它（>0 才继续；否则后面的断言全是假绿）", anchorAt > 0, `anchorAt=${anchorAt}`);

	// ── ② 契约：<a> + href + target + rel ─────────────────────────────
	check("全仓只剩这一处仓库链接（写了两处就要两边一起维护，迟早分叉）",
		(comp.match(/https:\/\/github\.com\/EastMG\/dsh-gacha-calendar/g) || []).length === 1,
		String((comp.match(/github\.com\/EastMG/g) || []).length));
	check("锚点是 <a>，不是 <button>（一行可点的文字，不是控件）",
		/\(0, react_jsx_runtime\.jsx\)\("a", \{/.test(anchorBlock)
		&& !/\(0, react_jsx_runtime\.jsx\)\("button", \{/.test(anchorBlock));
	check('target="_blank"（点开不把设置页顶掉）', /target: "_blank"/.test(anchorBlock));
	check('rel 两个值都在："noreferrer noopener"（新窗口拿不到 opener）',
		/rel: "noreferrer noopener"/.test(anchorBlock));
	check("文案与需求原文一字不差（不带句末标点）", anchorBlock.includes('children: "' + STAR_TEXT + '"'), anchorBlock.slice(0, 200).replace(/\n/g, " "));
	check("文案没有堆感叹号 / 句号（低调，不喊口号）", !/点个 Star\s*[。！!]/.test(region));

	// ── ③ 位置：游戏列表之后，且是 children 数组的最末一项 ─────────────────
	// 用源码顺序断言：这几处都在设置页 render 内，索引关系就是屏幕上的上下关系。
	const listAt = region.indexOf('children: "游戏列表"');
	const sortedAt = region.indexOf("sorted.map((");
	const selfCheckAt = region.indexOf('children: "解析器自检"');
	const sourceNoteAt = region.indexOf("数据来自各游戏官方公告");
	check("几个位置锚点都定位到了（游戏列表 / 逐行渲染 / 自检 / 来源说明）",
		listAt > 0 && sortedAt > 0 && selfCheckAt > 0 && sourceNoteAt > 0,
		`list=${listAt} sorted=${sortedAt} self=${selfCheckAt} note=${sourceNoteAt}`);
	check("在游戏列表**之后**（含逐行渲染的 sorted.map）", anchorAt > listAt && anchorAt > sortedAt);
	check("在「解析器自检」与「数据来源」说明之后（真·页面底部，不是插在中间）",
		anchorAt > selfCheckAt && anchorAt > sourceNoteAt);

	// 最末一项：锚点之后到函数结束之间**不许再出现任何 jsx 子元素**
	const tail = anchorAt >= 0 ? region.slice(anchorAt) : "";
	const tailJsx = (tail.match(/\(0, react_jsx_runtime\.jsx[st]?\)\("/g) || []).length;
	check("是 children 数组的最末一项（其后没有任何别的 jsx 子元素）", anchorAt > 0 && tailJsx === 0, `tailJsx=${tailJsx}`);

	// ── ④ 外观：低调的一行字（11~12px / 三级字色 / 无底块 / 上方 8~12px）──────
	const rule = /\.gacha-cal-star-link\{([^}]*)\}/.exec(css);
	const ruleBody = rule ? rule[1] : "";
	check("样式挂在 .gacha-cal-star-link 上，且元素确实用这个类",
		!!rule && /className: "gacha-cal-star-link"/.test(anchorBlock));
	const fs = /font-size:(\d+)px/.exec(ruleBody);
	check("字号 11~12px（低调，不跟正文抢）", !!fs && Number(fs[1]) >= 11 && Number(fs[1]) <= 12, ruleBody);
	check("字色沿用现有三级字色 var(--dsw-alias-label-tertiary)（不改主题）",
		/color:var\(--dsw-alias-label-tertiary(?:,[^)]*)?\)/.test(ruleBody), ruleBody);
	check("没有底色 / 背景块（只是文字，不是卡片或按钮）",
		!!rule && !/background(?:-color)?:/.test(ruleBody) && !/border(?:-radius)?:/.test(ruleBody));
	check("默认没有下划线（低调）；hover 才出下划线并升到次级字色",
		/text-decoration:none/.test(ruleBody)
		&& /\.gacha-cal-star-link:hover\{[^}]*text-decoration:underline[^}]*\}/.test(css)
		&& /\.gacha-cal-star-link:hover\{[^}]*var\(--dsw-alias-label-secondary/.test(css));
	check("hover 只改文字、不加底色块", !/\.gacha-cal-star-link:hover\{[^}]*background/.test(css));
	const mt = /margin-top:(\d+)px/.exec(ruleBody);
	check("行上方留 8~12px 间距（不与游戏列表挤在一起）", !!mt && Number(mt[1]) >= 8 && Number(mt[1]) <= 12, ruleBody);

	// ── ⑤ 产物：src/ 改了必须 build（否则用户看到的是旧产物）────────────────
	check("lib/client.js 里有这一行（改了 src/ 忘了 node build.mjs 会红）",
		lib.includes(REPO_URL) && lib.includes(STAR_TEXT));
	check("产物的样式表里也有这条规则（70-styles.js 的类没被漏掉）",
		lib.includes(".gacha-cal-star-link{"));
}
