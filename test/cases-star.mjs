// test/cases-star.mjs —— 设置页**标题行**：标题 + 版本号 + Star 指引（静态守卫）
//
// ── 这文件守什么（2026-10-28 改写）──
// 原来它守的是「页面**底部**单独一行 Star 指引」（那一行已经删掉，相关位置断言一并删除）。
// 用户 2026-10-28 要求把这行挪到设置页标题**同一行**，并在这行加插件版本号：
//     二游日历   v0.12.6   ⭐ Star
// 于是本文件改为守三件事：
//
//   ① **版本号不许漂**（最重要的那条）：设置页显示的版本号来自**构建期注入**的 `PLUGIN_VERSION`
//      （src/client/05-version.js 的占位符 ← build.mjs 用根 package.json 的 version 替换）。
//      它坏掉时**不会报任何错**，只会让用户看到一个错的版本号：
//        · 改了 package.json 的 version 却忘了 `node build.mjs` ⇒ 产物里还是旧号；
//        · 某人图省事在 JSX 里手写 "v0.12.6" ⇒ 下次升版永远停在 0.12.6（测试也测不出来，除非钉死它）。
//      所以这里双向钉：产物的 PLUGIN_VERSION **必须等于** package.json 的 version；设置页必须用
//      `"v" + PLUGIN_VERSION` 拼，**不许**出现手写的 vX.Y.Z 字面量。
//   ② 布局：标题行是一个 **flex 行**（display:flex + alignItems:center + gap 8~10px），
//      children 恰好三项，顺序 = 标题 → 版本号 → Star（用户要的"右侧依次"）。
//   ③ Star 链接本身没被改坏：<a>（不是 button）+ 正字 href + target="_blank" + rel 两个值 + 文案。
//
// ⚠️ 另外守住"别再飘回页面底部"：Star 链接必须在**游戏列表之前**，而「数据来源」说明才是
//    children 数组的最后一项（其后不许再有 jsx 子元素）—— 否则又回到"滚到最后才能点 Star"。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SRC = path.join(REPO, "src", "client");

// 用户要的形态（2026-10-28）：标题行右侧 = 版本号 + 「⭐ Star」。文案一字不差，不加句末标点。
const STAR_TEXT = "⭐ Star";
const REPO_URL = "https://github.com/EastMG/dsh-gacha-calendar";
// 旧的底部文案：必须彻底消失（src 与产物都不许再有）
const OLD_TEXT = "觉得好用";

// JSX 子元素调用（`(0, react_jsx_runtime.jsx)("div"` / `.jsxs)` 两种都算）
const JSX_CALL = /\(0, react_jsx_runtime\.jsx[st]?\)\("/g;
const countJsx = (text) => (text.match(JSX_CALL) || []).length;

// 只剥**整行注释**（`// …` / `* …` / `/* …`）：注释里会引用 `"v0.12.6"`、`<a>` 这类示例，
// 不剥会误判（本文件自己的注释就这么写）。
// ⚠️ 刻意**不**在行内找 `//`：href 是 `https://…`，行内剥离会把 URL 截断，后面的链接断言就假红。
const stripLineComments = (text) => text
	.split("\n")
	.filter((l) => {
		const t = l.trim();
		return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
	})
	.join("\n");

export default async function run() {
	section("设置页标题行（标题 + 版本号 + Star 指引）");

	const comp = readFileSync(path.join(SRC, "80-components.js"), "utf8");
	const verSrc = readFileSync(path.join(SRC, "05-version.js"), "utf8");
	const css = readFileSync(path.join(SRC, "70-styles.js"), "utf8");
	const lib = readFileSync(path.join(REPO, "lib", "client.js"), "utf8");
	const core = readFileSync(path.join(REPO, "packages", "core", "core.mjs"), "utf8");
	const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));

	// ── ① 定位设置页渲染区域（守卫自身不许瞎）──────────────────────────────
	const start = comp.indexOf("function CalendarSettingsPage(");
	const end = comp.indexOf("//#endregion", start);
	const region = start >= 0 && end > start ? comp.slice(start, end) : "";
	check("能定位 CalendarSettingsPage 的函数体（守卫自身没瞎）", start >= 0 && end > start, `start=${start} end=${end}`);
	check("该函数体里确认是 720px 宽的那层设置页容器（定位到的是对的那段）",
		/maxWidth: 720/.test(region));

	// ── ② 版本号来源：唯一真源是 package.json（防漂移）──────────────────────
	// 这一组就是"改了 package.json 但没重新 build"的守卫：产物里的字面量必须**等于** package.json。
	const libVer = /const PLUGIN_VERSION = "([^"]*)";/.exec(lib);
	check("能抓到 lib/client.js 里的 PLUGIN_VERSION（守卫自身没瞎）", !!libVer, "没匹配到 const PLUGIN_VERSION = \"…\";");
	check("客户端产物的版本号 == package.json 的 version（防漂移；不一致就是忘了 node build.mjs）",
		!!libVer && libVer[1] === pkg.version, `产物=${libVer && libVer[1]} package.json=${pkg.version}`);
	const coreVer = /const PLUGIN_VERSION = "([^"]*)";/.exec(core);
	check("core 产物与插件产物同版本（两处注入同一条路径，漂了就是 build.mjs 漏改）",
		!!coreVer && coreVer[1] === pkg.version, `core=${coreVer && coreVer[1]} package.json=${pkg.version}`);
	check("产物里没有残留的占位符 __PLUGIN_VERSION__（注入真的跑了，不是把占位符发给用户）",
		!lib.includes("__PLUGIN_VERSION__") && !core.includes("__PLUGIN_VERSION__"));
	check("src/client/05-version.js 仍只写占位符（版本号只许在 package.json 里改一处）",
		/const PLUGIN_VERSION = "__PLUGIN_VERSION__";/.test(verSrc) && !/const PLUGIN_VERSION = "\d/.test(verSrc),
		"见 src/client/05-version.js");
	check("版本号是 x.y.z 形态（设置页显示成 v0.12.6 这种）", /^\d+\.\d+\.\d+/.test(String(pkg.version)), String(pkg.version));

	// ── ③ 标题行 = flex 行，含 标题 + 版本号 + Star 三项 ────────────────────
	const titleClsAt = region.indexOf('className: "gacha-cal-settings-title"');
	const titleAt = titleClsAt >= 0
		? region.lastIndexOf('(0, react_jsx_runtime.jsxs)("div", {', titleClsAt)
		: -1;
	// 切到下一个兄弟（saveError 那一项）为止：这一块就是整行，不会把下面的卡片算进来。
	const nextSiblingAt = titleAt >= 0 ? region.indexOf("saveError ?", titleAt) : -1;
	const titleRow = titleAt >= 0 && nextSiblingAt > titleAt ? stripLineComments(region.slice(titleAt, nextSiblingAt)) : "";
	check("设置页里找到了标题行容器（>0 才继续；否则后面的断言全是假绿）", titleAt >= 0 && titleRow !== "", `titleAt=${titleAt}`);

	check("标题行是 flex 行：display:flex + alignItems:center（三者垂直居中）",
		/display: "flex"/.test(titleRow) && /alignItems: "center"/.test(titleRow), titleRow.slice(0, 160).replace(/\n/g, " "));
	const gap = /gap: (\d+)/.exec(titleRow);
	check("三者间距 8~10px", !!gap && Number(gap[1]) >= 8 && Number(gap[1]) <= 10, gap && gap[0]);

	// children 是数组：切掉容器开头（它自己也是一次 jsx 调用），只数这一行的子元素。
	const rowChildrenAt = titleRow.indexOf("children: [");
	const rowChildren = rowChildrenAt >= 0 ? titleRow.slice(rowChildrenAt) : "";
	check("标题行用 children 数组（jsxs）而不是把三项拼成一串", rowChildrenAt >= 0);
	check("标题行里恰好三个子元素：标题 + 版本号 + Star（不多不少）",
		countJsx(rowChildren) === 3, `childCount=${countJsx(rowChildren)}`);

	// 标题本体：字号/字重与原来完全一致（用户明确要求"保持不变"）
	check("标题仍是 SETTINGS_SECTION_LABEL，fontSize 16 / fontWeight 600 不变",
		/style: \{ fontSize: 16, fontWeight: 600 \}, children: SETTINGS_SECTION_LABEL/.test(titleRow));

	// 版本号：必须是 `"v" + PLUGIN_VERSION`（构建期注入的常量），不许手写
	const verAt = titleRow.indexOf('className: "gacha-cal-version"');
	check("标题行里有一个 .gacha-cal-version（版本号那一项）", verAt > 0);
	check('版本号文本是 "v" + PLUGIN_VERSION（不是手写字面量）',
		/children: "v" \+ PLUGIN_VERSION/.test(titleRow));
	check("标题行里没有手写的版本号字面量（如 v0.12.6 —— 手写就永远停在那一版）",
		!/children: "v\d/.test(titleRow) && !/"v\d+\.\d+\.\d+"/.test(titleRow));

	// 顺序：标题 → 版本 → Star
	const iTitle = titleRow.indexOf("children: SETTINGS_SECTION_LABEL");
	const iStarCls = titleRow.indexOf('className: "gacha-cal-star-link"');
	check("顺序 = 标题 → 版本号 → Star（版本号紧跟标题右侧，Star 在最右）",
		iTitle > 0 && verAt > iTitle && iStarCls > verAt,
		`title=${iTitle} ver=${verAt} star=${iStarCls}`);

	// ── ④ Star 链接的契约（挪了位置，但 href / target / rel / 文案不许变）────
	// 锚点：以 href 那一行为基准切出**这个 <a> 的整块**。
	// ⚠️ 不能从 href 那行开始切：`(0, …jsx)("a", {` 与 `className:` 都在它**前面**，
	//    那样切会让「是 <a> 不是 button」「用了 .gacha-cal-star-link」两条断言假红。
	const anchorAt = titleRow.indexOf('href: "' + REPO_URL + '"');
	const elAt = anchorAt >= 0 ? titleRow.lastIndexOf('(0, react_jsx_runtime.jsx)("a", {', anchorAt) : -1;
	const elEnd = elAt >= 0 ? titleRow.indexOf("}", elAt) : -1;
	const anchorBlock = elAt >= 0 && elEnd > elAt ? titleRow.slice(elAt, elEnd + 1) : "";
	check("标题行里找到了 Star 链接（>0 才继续）", anchorAt > 0, `anchorAt=${anchorAt}`);
	check("全仓只剩这一处仓库链接（写了两处就要两边一起维护，迟早分叉）",
		(comp.match(/https:\/\/github\.com\/EastMG\/dsh-gacha-calendar/g) || []).length === 1,
		String((comp.match(/github\.com\/EastMG/g) || []).length));
	check("锚点是 <a>，不是 <button>（一行可点的文字，不是控件）",
		/\(0, react_jsx_runtime\.jsx\)\("a", \{/.test(anchorBlock)
		&& !/\(0, react_jsx_runtime\.jsx[st]?\)\("button", \{/.test(anchorBlock));
	check('href 没变（仍是插件仓库）', anchorBlock.includes('href: "' + REPO_URL + '"'));
	check('target="_blank"（点开不把设置页顶掉）', /target: "_blank"/.test(anchorBlock));
	check('rel 两个值都在："noreferrer noopener"（新窗口拿不到 opener）',
		/rel: "noreferrer noopener"/.test(anchorBlock));
	check("文案就是「⭐ Star」（标题行里放不下原来那句长文案）",
		anchorBlock.includes('children: "' + STAR_TEXT + '"'), anchorBlock.slice(0, 240).replace(/\n/g, " "));

	// ── ⑤ 位置：在标题行里（游戏列表之前），页面底部那行已经删掉 ─────────────
	const listAt = region.indexOf('children: "游戏列表"');
	const sortedAt = region.indexOf("sorted.map((");
	const noteAt = region.indexOf("数据来自各游戏官方公告");
	check("几个位置锚点都定位到了（游戏列表 / 逐行渲染 / 数据来源说明）",
		listAt > 0 && sortedAt > 0 && noteAt > 0, `list=${listAt} sorted=${sortedAt} note=${noteAt}`);
	check("Star 链接在游戏列表**之前**（在标题行里，不再需要滚到页面底部）",
		titleAt >= 0 && listAt > titleAt);
	// 最末一项：从「数据来源」那个 div 的开头切到函数末尾，**不许再出现任何别的 jsx 子元素**
	// （锚点要从元素开头算：`(0, …jsx)("div", {` 在 `children: "数据来自…"` 之前）。
	const noteElAt = noteAt > 0 ? region.lastIndexOf('(0, react_jsx_runtime.jsx)("div", {', noteAt) : -1;
	const tailJsx = noteElAt > 0 ? countJsx(region.slice(noteElAt)) : -1;
	check("「数据来源」说明是 children 数组的最末一项（底部不再挂着 Star 行）",
		noteElAt > 0 && tailJsx === 1, `tailJsx=${tailJsx}`);
	check("旧的底部文案已从组件里删除（不再有「" + OLD_TEXT + "」）", !comp.includes(OLD_TEXT));

	// ── ⑥ 外观：低调的一行字（11~12px / 三级字色 / 无底块 / 不带 margin、align-self）──
	const rule = /\.gacha-cal-star-link\{([^}]*)\}/.exec(css);
	const ruleBody = rule ? rule[1] : "";
	check("样式挂在 .gacha-cal-star-link 上，且标题行里那一项确实用这个类",
		!!rule && /className: "gacha-cal-star-link"/.test(titleRow));
	const fs = /font-size:(\d+)px/.exec(ruleBody);
	check("字号 11~12px（低调，不跟标题抢）", !!fs && Number(fs[1]) >= 11 && Number(fs[1]) <= 12, ruleBody);
	check("字色沿用现有三级字色 var(--dsw-alias-label-tertiary)（不改主题）",
		/color:var\(--dsw-alias-label-tertiary(?:,[^)]*)?\)/.test(ruleBody), ruleBody);
	check("没有底色 / 背景块（只是文字，不是卡片或按钮）",
		!!rule && !/background(?:-color)?:/.test(ruleBody) && !/border(?:-radius)?:/.test(ruleBody));
	check("默认没有下划线（低调）；hover 才出下划线并升到次级字色",
		/text-decoration:none/.test(ruleBody)
		&& /\.gacha-cal-star-link:hover\{[^}]*text-decoration:underline[^}]*\}/.test(css)
		&& /\.gacha-cal-star-link:hover\{[^}]*var\(--dsw-alias-label-secondary/.test(css));
	check("hover 只改文字、不加底色块", !/\.gacha-cal-star-link:hover\{[^}]*background/.test(css));
	// 这一条是搬位置带出来的新约束：它们原来是"贴着页面底部"才有的（margin-top / align-self），
	// 留在标题行里会把 Star 顶出中线，三者就不垂直居中了。
	check("Star 链接不带 align-self / margin（否则会被顶出标题行的中线）",
		!/align-self/.test(ruleBody) && !/margin/.test(ruleBody), ruleBody);

	const verRule = /\.gacha-cal-version\{([^}]*)\}/.exec(css);
	const verBody = verRule ? verRule[1] : "";
	check("版本号有独立样式 .gacha-cal-version（与 Star 同级的低调小字）", !!verRule);
	const vfs = /font-size:(\d+)px/.exec(verBody);
	check("版本号字号 11~12px", !!vfs && Number(vfs[1]) >= 11 && Number(vfs[1]) <= 12, verBody);
	check("版本号字色是三级字色 var(--dsw-alias-label-tertiary)",
		/color:var\(--dsw-alias-label-tertiary(?:,[^)]*)?\)/.test(verBody), verBody);
	check("版本号不带 align-self / margin（同样为了垂直居中）",
		!/align-self/.test(verBody) && !/margin/.test(verBody), verBody);

	// ── ⑦ 产物：src/ 改了必须 build（否则用户看到的是旧产物）────────────────
	check("lib/client.js 里有标题行与 Star 链接（改了 src/ 忘了 node build.mjs 会红）",
		lib.includes("gacha-cal-settings-title") && lib.includes("gacha-cal-star-link") && lib.includes(STAR_TEXT));
	check("产物的版本号是 package.json 那个字面量（注入 + build 都真的跑过）",
		lib.includes('const PLUGIN_VERSION = "' + pkg.version + '";') && lib.includes('"v" + PLUGIN_VERSION'));
	check("产物的样式表里也有这两条规则（70-styles.js 的类没被漏掉）",
		lib.includes(".gacha-cal-version{") && lib.includes(".gacha-cal-star-link{"));
	check("产物里不再有旧的底部文案", !lib.includes(OLD_TEXT));
}
