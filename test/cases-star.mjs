// test/cases-star.mjs —— 设置页**标题行**：左「标题 + 版本号」/ 右「Star 指引 + 关闭 ✕」
//
// ── 这文件守什么（2026-10-28 二次改写）──
// 最早它守「页面**底部**单独一行 Star 指引」；后来那行挪进标题行；现在用户要求：
//
//     二游日历   v0.12.6                         ⭐ 觉得好用？去 GitHub 点个 Star  ✕
//
//   · 左侧 = 标题 + 版本号；右侧 = Star 链接 + 关闭叉（用 marginLeft:"auto" 把这一组推到最右）；
//   · 点 ✕ ⇒ 写 `starHintDismissed: true`，整块**当拍**消失，且**永不再显示**（持久化，重启也在）。
// 于是本文件守五件事：
//
//   ① **版本号不许漂**（最重要的那条）：设置页显示的版本号来自**构建期注入**的 `PLUGIN_VERSION`
//      （src/client/05-version.js 的占位符 ← build.mjs 用根 package.json 的 version 替换）。
//      它坏掉时**不会报任何错**，只会让用户看到一个错的版本号：
//        · 改了 package.json 的 version 却忘了 `node build.mjs` ⇒ 产物里还是旧号；
//        · 某人图省事在 JSX 里手写 "v0.12.6" ⇒ 下次升版永远停在 0.12.6（测试也测不出来，除非钉死它）。
//      所以这里双向钉：产物的 PLUGIN_VERSION **必须等于** package.json 的 version；设置页必须用
//      `"v" + PLUGIN_VERSION` 拼，**不许**出现手写的 vX.Y.Z 字面量。
//   ② 布局：标题行是 **flex 行**（display:flex + alignItems:center + flexWrap:wrap + gap 8~10px），
//      children 顶层恰好三项 = 标题 → 版本号 → Star 组；Star 组再用 `marginLeft:"auto"` 靠右。
//   ③ Star 链接本身没被改坏：<a>（不是 button）+ 正字 href + target="_blank" + rel 两个值 + 用户要的文案。
//   ④ 关闭 ✕：小 button（type="button" + aria-label="不再显示" + title），点击 = 先当拍隐藏、
//      再 `commit("starHintDismissed", true)`；样式 12~13px / 三级字色 / 无底色无边框 / hover 加深 / ≥16×16。
//   ⑤ 配置键 `starHintDismissed` **三处齐**（10-config.js / engine-head.js / src/index.js 的 .volatile()），
//      默认 false；读取必须经 `configValueOf` 解包（volatile 字段是引用对象），纯函数 `starHintShownOf`
//      覆盖 true / false / 脏值 / 引用对象。
//
// ⚠️ 另外守住"别再飘回页面底部"：Star 链接必须在**游戏列表之前**，而「数据来源」说明才是
//    children 数组的最后一项（其后不许再有 jsx 子元素）—— 否则又回到"滚到最后才能点 Star"。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { T, readStylesSource, readComponentsSource } from "./load.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SRC = path.join(REPO, "src", "client");

// 用户要的形态（2026-10-28 二次定稿）：标题行右侧 = 「⭐ 觉得好用？去 GitHub 点个 Star」+ ✕。
// 文案一字不差，不加句末标点。
const STAR_TEXT = "⭐ 觉得好用？去 GitHub 点个 Star";
const REPO_URL = "https://github.com/EastMG/dsh-gacha-calendar";

// JSX 子元素调用（`(0, react_jsx_runtime.jsx)("div"` / `.jsxs)` 两种都算）
const JSX_CALL = /\(0, react_jsx_runtime\.jsx[st]?\)\("/g;
const countJsx = (text) => (text.match(JSX_CALL) || []).length;

// 只剥**整行注释**（`// …` / `* …` / `/* …`）：注释里会引用 `"v0.12.6"`、Star 文案这类示例，
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
	section("设置页标题行（标题/版本靠左 + Star 指引/关闭 ✕ 靠右）");

	const { starHintShownOf, DEFAULT_SETTINGS } = T;
	const comp = readComponentsSource();
	const helpers = readFileSync(path.join(SRC, "60-helpers.js"), "utf8");
	const cfgSrc = readFileSync(path.join(SRC, "10-config.js"), "utf8");
	const ehSrc = readFileSync(path.join(SRC, "engine-head.js"), "utf8");
	const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
	const verSrc = readFileSync(path.join(SRC, "05-version.js"), "utf8");
	const css = readStylesSource();
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

	// ── ③ 标题行 = flex 行，顶层三项：标题 + 版本号 + Star 组 ────────────────
	const titleClsAt = region.indexOf('className: "gacha-cal-settings-title"');
	const titleAt = titleClsAt >= 0
		? region.lastIndexOf('(0, react_jsx_runtime.jsxs)("div", {', titleClsAt)
		: -1;
	// 切到下一个兄弟（saveError 那一项）为止：这一块就是整行，不会把下面的卡片算进来。
	const nextSiblingAt = titleAt >= 0 ? region.indexOf("saveError ?", titleAt) : -1;
	const titleRow = titleAt >= 0 && nextSiblingAt > titleAt ? stripLineComments(region.slice(titleAt, nextSiblingAt)) : "";
	check("设置页里找到了标题行容器（>0 才继续；否则后面的断言全是假绿）", titleAt >= 0 && titleRow !== "", `titleAt=${titleAt}`);

	check("标题行是 flex 行：display:flex + alignItems:center + flexWrap:wrap",
		/display: "flex"/.test(titleRow) && /alignItems: "center"/.test(titleRow) && /flexWrap: "wrap"/.test(titleRow),
		titleRow.slice(0, 200).replace(/\n/g, " "));
	const gap = /gap: (\d+)/.exec(titleRow);
	check("标题行内间距 8~10px", !!gap && Number(gap[1]) >= 8 && Number(gap[1]) <= 10, gap && gap[0]);

	// children 是数组：切掉容器开头（它自己也是一次 jsx 调用），只数这一行的子元素。
	const rowChildrenAt = titleRow.indexOf("children: [");
	const rowChildren = rowChildrenAt >= 0 ? titleRow.slice(rowChildrenAt) : "";
	check("标题行用 children 数组（jsxs）而不是把各项拼成一串", rowChildrenAt >= 0);
	// 顶层 = 标题 + 版本号 + Star 组；Star 组内部 = 链接 + ✕ ⇒ 整行共 5 次 jsx 调用。
	check("标题行共 5 个 jsx 元素：标题 + 版本号 + Star 组（链接 + 关闭 ✕）",
		countJsx(rowChildren) === 5, `jsxCount=${countJsx(rowChildren)}`);

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

	// Star 组（2026-10-28 二次改）：链接 + ✕ 打包成一个 flex 项，marginLeft:"auto" 推到最右。
	const groupAt = titleRow.indexOf('marginLeft: "auto"');
	check("Star 组用 marginLeft:\"auto\" 靠右（整组推到标题行最右）", groupAt > 0, `groupAt=${groupAt}`);
	check("Star 组自身是 flex 行（链接与 ✕ 垂直居中、间距 4）",
		/style: \{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flex: "none" \}/.test(titleRow),
		titleRow.slice(Math.max(0, groupAt - 60), groupAt + 120).replace(/\n/g, " "));

	// 顺序：标题 → 版本 → Star 组 → Star 链接
	const iTitle = titleRow.indexOf("children: SETTINGS_SECTION_LABEL");
	const iStarCls = titleRow.indexOf('className: "gacha-cal-star-link"');
	check("顺序 = 标题 → 版本号 → Star 组 → Star 链接（版本号紧跟标题，Star 组在最右）",
		iTitle > 0 && verAt > iTitle && groupAt > verAt && iStarCls > groupAt,
		`title=${iTitle} ver=${verAt} group=${groupAt} star=${iStarCls}`);

	// ── ④ Star 链接的契约（挪了位置，但 href / target / rel / 文案按新事实）────
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
	check("文案恢复成用户要的原句「" + STAR_TEXT + "」（一字不差、不加句末标点）",
		anchorBlock.includes('children: "' + STAR_TEXT + '"'), anchorBlock.slice(0, 260).replace(/\n/g, " "));

	// ── ⑤ 关闭 ✕：小 button、点击写 starHintDismissed、当拍消失 ─────────────
	const closeAt = titleRow.indexOf('"aria-label": "不再显示"');
	check("Star 组里有带 aria-label=\"不再显示\" 的关闭叉", closeAt > 0, `closeAt=${closeAt}`);
	const btnAt = closeAt >= 0 ? titleRow.lastIndexOf('(0, react_jsx_runtime.jsx)("button", {', closeAt) : -1;
	const btnEnd = btnAt >= 0 ? titleRow.indexOf("}", btnAt) : -1;
	const closeBlock = btnAt >= 0 && btnEnd > btnAt ? titleRow.slice(btnAt, btnEnd + 1) : "";
	check("关闭叉在 Star 链接**右边**（同一个组里、排在链接之后）", btnAt > anchorAt, `link=${anchorAt} close=${btnAt}`);
	check("关闭叉是真正的 <button>（键盘可达），不是装饰性 span", /\(0, react_jsx_runtime\.jsx\)\("button", \{/.test(closeBlock));
	check('关闭叉 type="button"（不当作表单提交）', /type: "button"/.test(closeBlock));
	check('关闭叉 aria-label="不再显示"（读屏能说清这个叉是干什么的）', /"aria-label": "不再显示"/.test(closeBlock));
	check("关闭叉有 title 提示（鼠标悬停也有说明）", /title: "[^"]+"/.test(closeBlock));
	check("关闭叉的类名是 .gacha-cal-star-close", /className: "gacha-cal-star-close"/.test(closeBlock));
	check("关闭叉的字形是「✕」", /children: "✕"/.test(closeBlock));
	check("关闭叉点击走 dismissStarHint", /onClick: dismissStarHint/.test(closeBlock));

	// 点击处理：**先**当拍隐藏（同一个渲染周期里整块消失），**再**落盘。
	const handlerAt = comp.indexOf("const dismissStarHint = () => {");
	const handlerEnd = handlerAt >= 0 ? comp.indexOf("};", handlerAt) : -1;
	const handler = handlerAt >= 0 && handlerEnd > handlerAt ? comp.slice(handlerAt, handlerEnd + 2) : "";
	check("能定位 dismissStarHint 的处理函数（守卫自身没瞎）", handlerAt > 0 && handler !== "");
	check('点击写入 starHintDismissed: true（走现有 commit 链路）', /commit\("starHintDismissed", true\)/.test(handler), handler.replace(/\n/g, " "));
	check("点击先隐藏后写入：setStarHintDismissedDraft(true) 出现在 commit 之前（当拍消失，不等宿主往返）",
		handler.indexOf("setStarHintDismissedDraft(true)") >= 0
		&& handler.indexOf("setStarHintDismissedDraft(true)") < handler.indexOf('commit("starHintDismissed", true)'),
		handler.replace(/\n/g, " "));
	check("显示判定走 starHintShownOf(s.starHintDismissed)（不直接比裸值）",
		/starHintShownOf\(s\.starHintDismissed\)/.test(region)
		&& !/s\.starHintDismissed\s*===/.test(region)
		&& !/!!s\.starHintDismissed/.test(region));
	check("关闭后整块（链接 + ✕）一起消失：Star 组由 starHintShown 条件渲染",
		/starHintShown \? \(0, react_jsx_runtime\.jsxs\)\("div", \{/.test(titleRow)
		&& /\}\) : null/.test(titleRow));

	// ── ⑥ 配置键 starHintDismissed：三处齐 + 默认 false + 读取解包 ───────────
	{
		const i = cfgSrc.indexOf("const DEFAULT_SETTINGS = {");
		const defBlock = i >= 0 ? cfgSrc.slice(i, cfgSrc.indexOf("};", i)) : "";
		check("DEFAULT_SETTINGS 里有 starHintDismissed: false（默认显示）",
			/^\t{3}starHintDismissed: false$/m.test(defBlock), defBlock.slice(-220).replace(/\n/g, " "));
		check("DEFAULT_SETTINGS.starHintDismissed 解出来就是 false",
			DEFAULT_SETTINGS.starHintDismissed === false, String(DEFAULT_SETTINGS.starHintDismissed));

		const j = ehSrc.indexOf("const CONFIG_KEYS = [");
		const cfgBlock = j >= 0 ? ehSrc.slice(j, ehSrc.indexOf("];", j)) : "";
		const cfgKeys = [...cfgBlock.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]);
		check("引擎 CONFIG_KEYS 含 starHintDismissed（漏了 = 设置页写了、引擎读不到）",
			cfgKeys.includes("starHintDismissed"), cfgKeys.join(","));

		check("宿主 schema 有 starHintDismissed: z.boolean().default(false).volatile()",
			/starHintDismissed: z\.boolean\(\)\.default\(false\)\.volatile\(\),/.test(hostSrc),
			(hostSrc.match(/starHintDismissed:[^\n]*/) || [])[0] || "没匹配到");

		// 读取口径：必须经过 configValueOf 解包（volatile 字段是引用对象，裸读恒 truthy）。
		check("60-helpers.js 里有 configValueOf 解包（客户端镜像宿主的同名函数）",
			/function configValueOf\(raw\)/.test(helpers)
			&& /Symbol\.for\("cosmokit\.volatile\.write"\)/.test(helpers)
			&& /raw\.get\(\)/.test(helpers));
		check("starHintShownOf 经 configValueOf 解包，且只认明确 true",
			/function starHintShownOf\(raw\) \{[\s\S]*?return configValueOf\(raw\) !== true;[\s\S]*?\}/.test(helpers),
			"见 src/client/60-helpers.js");

		// 行为：纯函数覆盖 true / false / 脏值 / volatile 引用对象（含 get() 抛错）。
		const REF = Symbol.for("cosmokit.volatile.write");
		const refTrue = { get: () => true, [REF]: () => {} };
		const refFalse = { get: () => false, [REF]: () => {} };
		const refThrows = { get: () => { throw new Error("boom"); }, [REF]: () => {} };
		check("starHintShownOf(true) === false（明确关掉 ⇒ 隐藏）", starHintShownOf(true) === false);
		check("starHintShownOf(false) === true（默认显示）", starHintShownOf(false) === true);
		check("缺失 / null / 脏值（\"false\" / \"true\" / 0 / 1 / \"\" / {} / []）一律显示",
			[void 0, null, "false", "true", 0, 1, "", {}, []].every((v) => starHintShownOf(v) === true),
			[void 0, null, "false", "true", 0, 1, "", {}, []].map((v) => starHintShownOf(v)).join(","));
		check("volatile 引用对象解包后判定（get()=true ⇒ 隐藏）", starHintShownOf(refTrue) === false);
		check("volatile 引用对象解包后判定（get()=false ⇒ 显示）", starHintShownOf(refFalse) === true);
		check("引用对象 get() 抛错 ⇒ 按缺失处理（显示，不把设置页炸掉）", starHintShownOf(refThrows) === true);
	}

	// ── ⑦ 位置：在标题行里（游戏列表之前），页面底部那行没有复活 ─────────────
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
	check("Star 文案在生产代码里只出现一次（底部那行确实没了，不是又挂了一处）",
		(stripLineComments(comp).split(STAR_TEXT).length - 1) === 1,
		String(stripLineComments(comp).split(STAR_TEXT).length - 1));

	// ── ⑧ Star 链接外观：低调的一行字（12px / 三级字色 / 无底块 / 不带 margin、align-self）──
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
	// 右推挂在 Star 组容器上（marginLeft:"auto"），子项自己不许带 margin / align-self，
	// 否则会被顶出标题行的中线。
	check("Star 链接不带 align-self / margin（右推在组容器上，子项保持垂直居中）",
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

	// ── ⑨ 关闭 ✕ 外观：12~13px / 三级字色 / 无底色无边框 / hover 加深 / ≥16×16 ──
	const closeRule = /\.gacha-cal-star-close\{([^}]*)\}/.exec(css);
	const closeBody = closeRule ? closeRule[1] : "";
	check("样式挂在 .gacha-cal-star-close 上", !!closeRule, "没找到 .gacha-cal-star-close 规则");
	const cfs = /font-size:(\d+)px/.exec(closeBody);
	check("关闭叉字号 12~13px（小、低调）", !!cfs && Number(cfs[1]) >= 12 && Number(cfs[1]) <= 13, closeBody);
	check("关闭叉默认三级字色 var(--dsw-alias-label-tertiary)",
		/color:var\(--dsw-alias-label-tertiary(?:,[^)]*)?\)/.test(closeBody), closeBody);
	check("关闭叉无背景、无边框（不是按钮块，只是一枚小字）",
		/background:none/.test(closeBody) && /border:none/.test(closeBody), closeBody);
	check("关闭叉 hover 才加深到次级字色",
		/\.gacha-cal-star-close:hover\{[^}]*var\(--dsw-alias-label-secondary/.test(css));
	const cw = /width:(\d+)px/.exec(closeBody);
	const ch = /height:(\d+)px/.exec(closeBody);
	check("关闭叉点击区至少 16×16（字只有 12px，太小点不中）",
		!!cw && !!ch && Number(cw[1]) >= 16 && Number(ch[1]) >= 16,
		`${cw && cw[0]} / ${ch && ch[0]}`);
	check("关闭叉有 focus-visible 轮廓（键盘可达）",
		/\.gacha-cal-star-close:focus-visible\{[^}]*outline:/.test(css));

	// ── ⑩ 产物：src/ 改了必须 build（否则用户看到的是旧产物）────────────────
	check("lib/client.js 里有标题行 / Star 链接 / 关闭叉（改了 src/ 忘了 node build.mjs 会红）",
		lib.includes("gacha-cal-settings-title") && lib.includes("gacha-cal-star-link")
		&& lib.includes("gacha-cal-star-close") && lib.includes(STAR_TEXT));
	check("产物里带着 starHintDismissed 的读取与写入（配置链路真的进了包）",
		lib.includes("starHintDismissed") && lib.includes("starHintShownOf") && lib.includes("configValueOf"));
	check("core 产物里也有 starHintDismissed（DEFAULT_SETTINGS 与纯函数同源进 core）",
		core.includes("starHintDismissed") && core.includes("starHintShownOf"));
	check("产物的版本号是 package.json 那个字面量（注入 + build 都真的跑过）",
		lib.includes('const PLUGIN_VERSION = "' + pkg.version + '";') && lib.includes('"v" + PLUGIN_VERSION'));
	check("产物的样式表里也有这三条规则（styles/settings-header.css 的类没被漏掉）",
		lib.includes(".gacha-cal-version{") && lib.includes(".gacha-cal-star-link{") && lib.includes(".gacha-cal-star-close{"));
}
