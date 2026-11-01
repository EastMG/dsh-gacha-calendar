// test/cases-filter.mjs —— 搜索与筛选（待办第 4 项）
//
// 需求原文（README_Dev.md 第 4 项）：
//   设置页来源列表加"搜游戏名" + 分组（国服/日服/国际服）+ 只看已启用；
//   面板内加按卡池/角色名搜索（现在的 28 个来源只能靠"展示"开关逐条关）。
//
// 本段只钉**能被机器判定**的部分：
//   ① 归一（searchNorm）：全半角（NFKC）/ 大小写 / 前后空白 / 连续空白；
//   ② 分词（searchTokens）：空格分隔、空查询 ⇒ 空数组（= 不过滤）；
//   ③ 命中（searchHit）：空查询 / 大小写 / 中英混合 / 全半角 / 前后空格 / 无匹配 / AND 语义；
//   ④ 设置页过滤（settingsGamesFilter）：搜游戏名 ∩ 只看已启用（**组合生效**）、不改入参；
//   ⑤ 面板过滤（panelEntryHit / panelGamesFilter）：游戏名·卡池名·角色名·活动名任一命中、
//      空查询原样返回（同一数组引用）；
//   ⑥ 接线（静态）：两个搜索框都真的绑了状态、空结果文案在、**搜索不落盘**；
//      轮播 memo 仍读**未过滤**的 games（过滤只影响显示）；
//      两个搜索框的放大镜（2026-11-01：底栏 + 设置页，**同一套** 16 viewBox / 1.5 / 12×12 规格；
//      设置页那行原本没有包裹层 ⇒ 新包一层，行高逐像素不变）;
//   ⑦ 数据事实：`SOURCES` 里没有可靠的地区字段 ⇒ 本次**跳过分组**（加字段时要回来补这一条）。
//
// ⚠️ 「分组（国服/日服/国际服）」刻意**没做**：`registerSource` 的字段只有
//    id / name / tz / icon / url / source / eventUrl / eventSource / altSources / eventAltSources /
//    defaultHidden / parserVersion（+ 颜色由 SOURCE_COLORS 下发），**没有任何地区字段**；
//    `tz` 是**源站时区**不是地区（反例：ournotes-global 是国际服但 tz=Asia/Shanghai），
//    名字里也只有 11 条带「·国服/·日服/·国际服」后缀 ⇒ 按名字/时区硬推会把 17 条归错。
//    按任务书"数据里没有可靠的地区字段就不要硬造"⇒ 跳过，等有字段再补。

import { readFileSync } from "node:fs";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { T, REPO, readStylesSource, readComponentsSource } from "./load.mjs";

const {
	searchNorm, searchTokens, searchHit,
	settingsGamesFilter, panelEntryHit, panelGamesFilter,
	SOURCES
} = T;

const readSrc = (rel) => readFileSync(path.join(REPO, rel), "utf8");
const stripLineComments = (s) => s.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

export default function runFilter() {
	section("搜索与筛选（设置页搜游戏名/只看已启用 + 面板按卡池·角色名过滤）");

	// ── ① 归一：全半角 / 大小写 / 空白 ─────────────────────────────────────────
	{
		check("searchNorm 存在（60-helpers.js 的纯函数）", typeof searchNorm === "function");
		check("全角字母/数字 → 半角（NFKC）：\"Ｆａｔｅ／Ｇｒａｎｄ\" ⇒ \"fate/grand\"",
			searchNorm("Ｆａｔｅ／Ｇｒａｎｄ") === "fate/grand", searchNorm("Ｆａｔｅ／Ｇｒａｎｄ"));
		check("大小写不敏感：\"BANG DREAM\" ⇒ \"bang dream\"",
			searchNorm("BANG DREAM") === "bang dream", searchNorm("BANG DREAM"));
		check("前后空白去掉（半角空格 / Tab / 全角空格 U+3000 一起算）",
			searchNorm("  \tBanG\u3000Dream  ") === "bang dream", JSON.stringify(searchNorm("  \tBanG\u3000Dream  ")));
		check("连续空白压成一个空格：\"a   b\" ⇒ \"a b\"", searchNorm("a   b") === "a b", searchNorm("a   b"));
		check("中文原样保留：\"蔚蓝档案·日服\" 不变",
			searchNorm("蔚蓝档案·日服") === "蔚蓝档案·日服", searchNorm("蔚蓝档案·日服"));
		check("全角括号 → 半角：\"桔梗（泳装）\" ⇒ \"桔梗(泳装)\"",
			searchNorm("桔梗（泳装）") === "桔梗(泳装)", searchNorm("桔梗（泳装）"));
		check("null / undefined / 数字都安全（空串，不抛）",
			searchNorm(null) === "" && searchNorm(void 0) === "" && searchNorm(123) === "123");
	}

	// ── ② 分词：空格分隔 + 空查询 ──────────────────────────────────────────────
	{
		check("空查询 / 纯空白 ⇒ []（= 不过滤）",
			searchTokens("").length === 0 && searchTokens("   ").length === 0 && searchTokens("\u3000\t").length === 0);
		check("多个关键词按空格切开（\"fgo 日服\" ⇒ 两个）",
			searchTokens("fgo 日服").join("|") === "fgo|日服", searchTokens("fgo 日服").join("|"));
		check("全半角/前后空格在分词前就归一（\"  ＦＧＯ   泳装 \" ⇒ fgo|泳装）",
			searchTokens("  ＦＧＯ   泳装 ").join("|") === "fgo|泳装", searchTokens("  ＦＧＯ   泳装 ").join("|"));
		check("null / undefined ⇒ []", searchTokens(null).length === 0 && searchTokens(void 0).length === 0);
	}

	// ── ③ 命中：任务书点名的六种情况 ───────────────────────────────────────────
	{
		check("空查询 ⇒ 命中（清空即恢复全部，调用方不必另写分支）",
			searchHit("原神", "") === true && searchHit("原神", "   ") === true);
		check("大小写不敏感：haystack=\"Fate/Grand Order\"，query=\"fate\"/\"FATE\" 都命中",
			searchHit("Fate/Grand Order", "fate") === true && searchHit("Fate/Grand Order", "FATE") === true);
		check("中英混合：haystack 数组 [\"蔚蓝档案\",\"Blue Archive\"]，query=\"档案 blue\" 命中",
			searchHit(["蔚蓝档案", "Blue Archive"], "档案 blue") === true);
		check("中英混合反向：query 全角 \"ＢＬＵＥ 档案\" 也命中（NFKC 两边都过）",
			searchHit(["蔚蓝档案", "Blue Archive"], "ＢＬＵＥ 档案") === true);
		check("全半角：haystack 全角 \"Ｆａｔｅ／Ｇｒａｎｄ Ｏｒｄｅｒ\"，query 半角 \"fate/grand order\" 命中",
			searchHit("Ｆａｔｅ／Ｇｒａｎｄ Ｏｒｄｅｒ", "fate/grand order") === true);
		check("前后空格：query=\"  fate  \" 命中",
			searchHit("Fate/Grand Order", "  fate  ") === true);
		check("无匹配 ⇒ false（\"原神\" 里没有 \"星穹\"）",
			searchHit("原神", "星穹") === false);
		check("AND 语义：两个词都得出现（\"fate 日服\" 在 \"Fate/Grand Order\" 上不命中）",
			searchHit("Fate/Grand Order", "fate 日服") === false
			&& searchHit("BanG Dream！OurNotes·日服", "dream 日服") === true);
		check("空 haystack：空查询命中、非空查询不命中（不抛）",
			searchHit("", "") === true && searchHit("", "x") === false
			&& searchHit(void 0, "") === true && searchHit(void 0, "x") === false);
		check("haystack 数组里的空值被忽略（null / \"\" 不参与拼接）",
			searchHit([null, "", "原神"], "原神") === true);
	}

	// ── ④ 设置页过滤：搜游戏名 ∩ 只看已启用（组合生效）────────────────────────
	{
		const entries = [
			{ id: "fgo", name: "Fate/Grand Order", shown: true },
			{ id: "bandori", name: "BanG Dream！少女乐团派对·国服", shown: true },
			{ id: "ba-jp", name: "蔚蓝档案·日服", shown: false },
			{ id: "ournotes-global", name: "BanG Dream！OurNotes·国际服", shown: false }
		];
		const ids = (arr) => arr.map((x) => x.id).join(",");

		check("空查询 + 不看已启用 ⇒ 全部行（顺序不变）",
			ids(settingsGamesFilter(entries, { query: "", onlyShown: false })) === "fgo,bandori,ba-jp,ournotes-global");
		check("搜游戏名：\"档案\" ⇒ 只剩蔚蓝档案",
			ids(settingsGamesFilter(entries, { query: "档案" })) === "ba-jp");
		check("搜游戏名不认 id（口径是**游戏名**）：\"ba-jp\" ⇒ 无匹配",
			ids(settingsGamesFilter(entries, { query: "ba-jp" })) === "");
		check("大小写 / 全半角：\"ｂａｎｇ dream\" ⇒ 两条 BanG Dream 都命中",
			ids(settingsGamesFilter(entries, { query: "ｂａｎｇ dream" })) === "bandori,ournotes-global");
		check("中英混输：\"ournotes 国际\" ⇒ 只命中 OurNotes 国际服",
			ids(settingsGamesFilter(entries, { query: "ournotes 国际" })) === "ournotes-global");
		check("前后空格：\"  档案  \" 照常命中",
			ids(settingsGamesFilter(entries, { query: "  档案  " })) === "ba-jp");
		check("无匹配 ⇒ 空数组（渲染层据此显示「没有匹配的游戏」）",
			settingsGamesFilter(entries, { query: "不存在的游戏" }).length === 0);
		// 只看已启用：判定由调用方给（设置页传草稿优先的 shownNow）
		const isShown = (g) => g.shown === true;
		check("只看已启用（不看搜索）⇒ 只留 isShown 为真的两条",
			ids(settingsGamesFilter(entries, { onlyShown: true, isShown })) === "fgo,bandori");
		check("**组合生效**：\"dream\" ∩ 只看已启用 ⇒ bandori（ournotes-global 被筛掉）",
			ids(settingsGamesFilter(entries, { query: "dream", onlyShown: true, isShown })) === "bandori");
		check("组合后无交集 ⇒ 空数组（\"档案\" ∩ 只看已启用）",
			settingsGamesFilter(entries, { query: "档案", onlyShown: true, isShown }).length === 0);
		check("不传 isShown 时只看已启用 = 全都算展示中（默认谓词，不抛）",
			ids(settingsGamesFilter(entries, { onlyShown: true })) === "fgo,bandori,ba-jp,ournotes-global");
		check("不改入参（条目数与内容都不动）",
			entries.length === 4 && entries[2].id === "ba-jp" && entries[0].name === "Fate/Grand Order");
		check("返回新数组（不是入参本身），避免调用方误改",
			settingsGamesFilter(entries, {}) !== entries);
		check("entries 非数组 ⇒ []（坏值不炸设置页）",
			settingsGamesFilter(null, { query: "x" }).length === 0 && settingsGamesFilter(void 0, {}).length === 0);
	}

	// ── ⑤ 面板过滤：游戏名 / 卡池名 / 角色名 / 活动名 ──────────────────────────
	{
		const games = [
			{ id: "genshin", name: "原神", banner: "「月草的赐福」祈愿", roles: "菈乌玛、卡芙卡", event: "版本活动·荣花与炎日之途" },
			{ id: "hsr", name: "崩坏：星穹铁道", banner: "「流萤」跃迁", roles: "流萤", event: "「云帆归心」活动" },
			{ id: "fate", name: "Fate/Grand Order", banner: "巡灵祝祭", roles: "Saber", event: "咕哒咕哒活动" }
		];
		const ids = (arr) => arr.map((x) => x.id).join(",");
		check("角色名命中：\"卡芙卡\" ⇒ 原神那一行",
			ids(panelGamesFilter(games, "卡芙卡")) === "genshin");
		check("卡池名命中：\"月草\" ⇒ 原神那一行",
			ids(panelGamesFilter(games, "月草")) === "genshin");
		check("活动名命中：\"云帆\" ⇒ 星铁那一行",
			ids(panelGamesFilter(games, "云帆")) === "hsr");
		check("游戏名命中：\"星穹\" ⇒ 星铁那一行",
			ids(panelGamesFilter(games, "星穹")) === "hsr");
		check("大小写 / 全半角（\"ｆａｔｅ\" ⇒ Fate/Grand Order）",
			ids(panelGamesFilter(games, "ｆａｔｅ")) === "fate");
		check("多关键词 AND（\"星铁 流萤\" 无此字面 ⇒ 空；\"星穹 流萤\" ⇒ 星铁）",
			panelGamesFilter(games, "星铁 流萤").length === 0
			&& ids(panelGamesFilter(games, "星穹 流萤")) === "hsr");
		check("空查询 ⇒ **原样返回同一个数组**（上层 useMemo 不失效）",
			panelGamesFilter(games, "") === games && panelGamesFilter(games, "   ") === games);
		check("无匹配 ⇒ []", panelGamesFilter(games, "查无此名").length === 0);
		check("不改入参", games.length === 3 && games[0].roles === "菈乌玛、卡芙卡");
		check("单条命中判定：panelEntryHit 对 null 条目返回 false（不抛）",
			panelEntryHit(null, "x") === false && panelEntryHit(void 0, "") === false);
		check("games 非数组 ⇒ []（坏值不炸面板）",
			panelGamesFilter(null, "x").length === 0 && panelGamesFilter(void 0, "").length === 0);
	}

	// ── ⑥ 接线（静态）：UI 真的接上纯函数；搜索不落盘；轮播仍读未过滤的 games ──
	{
		const comp = readComponentsSource();
		const css = readStylesSource();
		const codes = stripLineComments(comp);
		const cfg = readSrc(path.join("src", "client", "10-config.js"));
		const head = readSrc(path.join("src", "client", "engine-head.js"));

		// 设置页：搜索框 + 只看已启用
		check("设置页有搜索框（value: gameQuery + onChange 写回 gameQuery）",
			comp.includes("value: gameQuery") && comp.includes("onChange: (e) => setGameQuery(e.target.value)"));
		check("搜索框有可见提示「搜游戏名」（不是只有一个裸输入框）",
			comp.includes('placeholder: "搜游戏名"'));
		check("设置页有「只看已启用」复选框（受控 onlyShown）",
			comp.includes("checked: onlyShown") && comp.includes("onChange: (e) => setOnlyShown(e.target.checked)"));
		check("设置页过滤**走纯函数** settingsGamesFilter（不在渲染层另写一套 includes）",
			/settingsGamesFilter\(ordered, \{/.test(comp)
			&& comp.includes("query: gameQuery")
			&& comp.includes("onlyShown,")
			&& comp.includes("isShown: (g) => shownNow(g)"));
		check("「展示中」用草稿优先的 shownNow 判定（勾/取消当拍筛选就对齐，不落后一次写入往返）",
			comp.includes("isShown: (g) => shownNow(g)"));
		check("空结果文案「没有匹配的游戏」在设置页里",
			comp.includes('children: "没有匹配的游戏"'));
		check("上移/下移的边界按**全量** ordered 算（过滤不改变真实排位）",
			comp.includes("disabled: i === 0,") && comp.includes("disabled: i === ordered.length - 1,")
			&& comp.includes("const i = ordered.indexOf(g);"));
		check("「游戏列表」标题原样保留（cases-star 的位置锚点）", comp.includes('children: "游戏列表"'));

		// 面板：搜索框 + 清空
		check("面板底栏有搜索框（value: findQuery + onChange 写回 findQuery）",
			comp.includes("value: findQuery") && comp.includes("onChange: (e) => setFindQuery(e.target.value)"));
		check("面板搜索框在**已有工具行**里（.gacha-cal-sched-foot 内），不新起一行",
			/className: "gacha-cal-sched-foot", children: \[[\s\S]{0,600}?className: "gacha-cal-sched-find"/.test(comp));
		check("面板过滤**走纯函数** panelGamesFilter",
			comp.includes("useMemo)(() => panelGamesFilter(games, findQuery)"));
		check("面板搜索可清空恢复：× 按钮 / Esc 都写回空串",
			(comp.match(/setFindQuery\(""\)/g) || []).length >= 2
			&& comp.includes('"aria-label": "清空搜索"'));
		check("面板空结果说明「清空搜索可恢复全部」（不会被当成「游戏都没了」）",
			comp.includes("没有匹配的游戏 · 清空搜索可恢复全部"));
		check("面板搜索框样式类在 CSS 里（不是死代码）",
			css.includes(".gacha-cal-sched-find{") && css.includes(".gacha-cal-sched-find-x{"));

		// ── 搜索框前面的放大镜（2026-11-01 用户：「给搜索框前面加个图标」）─────────────────
		// 实现选的是**方案①**（position:relative 容器 + 绝对定位图标）：.gacha-cal-sched-find
		// 本来就是 position:relative，所以**连容器都不用新增**，图标绝对定位在输入框内左侧
		// ⇒ 不参与底栏 flex、底栏高度不变。方案②（flex 兄弟排成一体）要么额外包一层，要么
		// 让图标变成 flex item —— 两者都会挤掉输入框宽度或改底栏布局，所以不选。
		// 截出「find 容器开标签 → input 开标签」这段：图标只能出现在这里（= 输入框**前面**）。
		const iFind = comp.indexOf('className: "gacha-cal-sched-find"');
		const iFindInput = comp.indexOf('(0, react_jsx_runtime.jsx)("input", {', iFind);
		const findHead = iFind >= 0 && iFindInput > iFind ? comp.slice(iFind, iFindInput) : "";
		check("面板：能截出「find 容器 → input」这段（守卫自身没瞎）", findHead.length > 0);
		check("面板：搜索框前面有放大镜图标（在 .gacha-cal-sched-find 内、input **之前**）",
			/className: "gacha-cal-sched-find-ic"/.test(findHead));
		check("面板：搜索图标规格 = 16 viewBox / strokeWidth 1.5 / stroke 圆头圆角 / fill none",
			/width: "12", height: "12", viewBox: "0 0 16 16", fill: "none"/.test(findHead)
			&& /stroke: "currentColor", strokeWidth: "1\.5", strokeLinecap: "round", strokeLinejoin: "round"/.test(findHead));
		check("面板：搜索图标渲染 12×12（比刷新/齿轮的 14 小一档，装饰性量级）",
			/width: "12", height: "12"/.test(findHead) && !/width: "14"|width: "16"/.test(findHead));
		check("面板：搜索图标是**装饰**（aria-hidden + focusable=false，不重复朗读）",
			/"aria-hidden": "true"/.test(findHead) && /focusable: "false"/.test(findHead));
		check("面板：搜索图标绝对定位在输入框内左侧（不新增容器、不占底栏高度）",
			/\.gacha-cal-sched-find-ic\{[^}]*position:absolute[^}]*left:6px/.test(css)
			&& /\.gacha-cal-sched-find-ic\{[^}]*width:12px[^}]*height:12px/.test(css));
		check("面板：搜索图标用弱化色 var(--dsw-alias-label-tertiary, #9aa1ab)",
			/\.gacha-cal-sched-find-ic\{[^}]*color:var\(--dsw-alias-label-tertiary,#9aa1ab\)/.test(css));
		// 点图标能聚焦输入框：图标 pointer-events:none ⇒ 指针**穿过**图标落到下面的 input 上
		// （原生聚焦）。改成 onClick 聚焦的话这条要一起改成断言接线，别只删这一行。
		check("面板：点图标能聚焦输入框（图标 pointer-events:none，指针穿透到 input）",
			/\.gacha-cal-sched-find-ic\{[^}]*pointer-events:none/.test(css));
		// padding-left 必须把图标让过去：图标占 x∈[6,18]，文字从 1(border)+20=21 起 ⇒ 3px 间隙。
		check("面板：搜索框 padding-left = 20px（> 图标右沿 18px，文字不被图标压住）",
			/\.gacha-cal-sched-find input\{[^}]*padding:1px 18px 1px 20px/.test(css));
		// 加宽 8px 是为了不被 padding-left 吃掉占位文字的空间：
		// 「搜卡池/角色/活动」11px 字号实测 85.6px，134−2(边框)−20−18 = 94 ⇒ 余量 9.1px。
		check("面板：搜索框宽 134px（内容宽 94px > 占位文字 85.6px，占位文字不会被切）",
			/\.gacha-cal-sched-find input\{[^}]*width:134px/.test(css));

		// ── 设置页「游戏列表」搜索框的放大镜（2026-11-01，与底栏那颗**同一套**）───────────
		// 与底栏那次的差别只在**容器**：底栏的 .gacha-cal-sched-find 早就在（position:relative），
		// 设置页这一行原本**没有包裹层**（input 直接是 flex 子项）⇒ 新包一层 .gacha-cal-set-find，
		// 并把原来挂在 input 上的 flex:0 1 128px / min-width:84px **原样搬到包裹层**；
		// input 改成 width:100% + box-sizing:border-box 填满它。两边都靠「绝对定位的图标不是
		// flex item」+「包裹层 display:flex ⇒ 没有行盒」保证这一行高度一分不涨 —— 设置页已经很长，
		// "别变长"是硬要求。
		// 静态预览实测（产物 CSS + 同款 DOM + 宿主 preflight，Playwright/Chromium）：
		//   改动前 行高 20 / input 128×20 / 组宽 264；改动后 **完全相同**；12×12 图标占输入框
		//   x∈[6,18]、文字从 20.67 起（3px 级间隙）、垂直居中偏差 0、图标中心 elementFromPoint
		//   拿到的是 INPUT（pointer-events:none 真的穿透）。
		// 占位文字「搜游戏名」11px 实测 44.0px，内容宽 128−2−20−6 = 100.67 ⇒ 余量 56.67px ≫ 5px，
		// 所以宽度**保持 128px 不加宽**（底栏那次只差 0.4px 才必须加宽）。
		const iSetFind = comp.indexOf('className: "gacha-cal-set-find"');
		const iSetInput = comp.indexOf('(0, react_jsx_runtime.jsx)("input", {', iSetFind);
		const setHead = iSetFind >= 0 && iSetInput > iSetFind ? comp.slice(iSetFind, iSetInput) : "";
		check("设置页：能截出「包裹层 → input」这段（守卫自身没瞎）", setHead.length > 0, `i=${iSetFind} end=${iSetInput}`);
		check("设置页：搜索框前面有放大镜（在 .gacha-cal-set-find 内、input **之前**）",
			/className: "gacha-cal-set-find-ic"/.test(setHead));
		const setIcon = setHead.slice(Math.max(0, setHead.indexOf('className: "gacha-cal-set-find-ic"')));
		check("设置页：放大镜规格 = 12×12 / viewBox 0 0 16 16 / fill none / stroke currentColor + 1.5 圆头圆角",
			/width: "12", height: "12", viewBox: "0 0 16 16", fill: "none"/.test(setIcon)
			&& /stroke: "currentColor", strokeWidth: "1\.5", strokeLinecap: "round", strokeLinejoin: "round"/.test(setIcon));
		check("设置页：放大镜是**装饰**（aria-hidden + focusable=false，不重复朗读）",
			/"aria-hidden": "true"/.test(setIcon) && /focusable: "false"/.test(setIcon));
		// 「同一套」不是"看着差不多"：与底栏那颗**逐字比对** svg 属性串，只改一半当场红。
		const iconSpecOf = (t) => {
			const box = /width: "([^"]+)", height: "([^"]+)", viewBox: "([^"]+)", fill: "([^"]+)"/.exec(t);
			const pen = /stroke: "([^"]+)", strokeWidth: "([^"]+)", strokeLinecap: "([^"]+)", strokeLinejoin: "([^"]+)"/.exec(t);
			return box && pen
				? { width: box[1], height: box[2], viewBox: box[3], fill: box[4], stroke: pen[1], strokeWidth: pen[2], strokeLinecap: pen[3], strokeLinejoin: pen[4] }
				: null;
		};
		const pnlIcon = comp.slice(Math.max(0, comp.indexOf('className: "gacha-cal-sched-find-ic"')));
		const setSpec = iconSpecOf(setIcon), pnlSpec = iconSpecOf(pnlIcon);
		check("设置页：放大镜与底栏那颗**逐字相同**（viewBox / strokeWidth / 渲染尺寸 / stroke / 圆头圆角 / fill）",
			!!setSpec && !!pnlSpec && JSON.stringify(setSpec) === JSON.stringify(pnlSpec),
			`set=${JSON.stringify(setSpec)} panel=${JSON.stringify(pnlSpec)}`);
		check("设置页：放大镜的图形也照抄底栏那枚（circle 7,7 r4.5 + 斜柄 M10.4 10.4 13.5 13.5）",
			/cx: "7", cy: "7", r: "4\.5"/.test(setIcon) && /d: "M10\.4 10\.4 13\.5 13\.5"/.test(setIcon));
		check("设置页：放大镜绝对定位在输入框内左侧（position:absolute / left:6px / 12×12）",
			/\.gacha-cal-set-find-ic\{[^}]*position:absolute[^}]*left:6px[^}]*width:12px[^}]*height:12px/.test(css));
		check("设置页：放大镜用弱化色 var(--dsw-alias-label-tertiary,#9aa1ab)（与底栏同色）",
			/\.gacha-cal-set-find-ic\{[^}]*color:var\(--dsw-alias-label-tertiary,#9aa1ab\)/.test(css));
		// 点图标能聚焦输入框：图标 pointer-events:none ⇒ 指针**穿过**图标落到下面的 input 上。
		// 改成 onClick 聚焦的话这条要一起改成断言接线，别只删这一行。
		check("设置页：点图标 = 点输入框（图标 pointer-events:none，指针穿透到 input，原生聚焦）",
			/\.gacha-cal-set-find-ic\{[^}]*pointer-events:none/.test(css));
		// 包裹层必须**接管**原来 input 的宽度约束，否则外层那行 flex 的换行点会变。
		check("设置页：包裹层接管原 input 的宽度约束（flex:0 1 128px + min-width:84px）",
			/\.gacha-cal-set-find\{[^}]*flex:0 1 128px/.test(css)
			&& /\.gacha-cal-set-find\{[^}]*min-width:84px/.test(css));
		check("设置页：input 改成 width:100% + box-sizing:border-box（填满包裹层，兼容旧行内 max-width:100%）",
			/\.gacha-cal-set-find input\{[^}]*box-sizing:border-box[^}]*width:100%/.test(css));
		// padding-left 20px：图标占 x∈[6,18]，文字从 1(border)+20=21 起 ⇒ 3px 间隙（与底栏同一组数）。
		check("设置页：input padding-left = 20px（> 图标右沿 18px，文字不被图标压住）",
			/\.gacha-cal-set-find input\{[^}]*padding:2px 6px 2px 20px/.test(css));
		// ⚠️ 反向守卫：padding / flex / width 一旦回到 input 的行内 style，会**盖掉**上面那条类规则
		// （行内优先级更高，inputStyle 自带 padding:"2px 6px"）⇒ padding-left:20px 直接失效。
		const iSetOnChange = comp.indexOf('onChange: (e) => setGameQuery(e.target.value)', iSetInput);
		const setInputAttrs = iSetInput >= 0 && iSetOnChange > iSetInput ? comp.slice(iSetInput, iSetOnChange) : "";
		check("设置页：能截出 input 的属性块（守卫自身没瞎）", setInputAttrs.length > 0, `len=${setInputAttrs.length}`);
		check("设置页：input 行内不再写 padding / flex / width（否则盖掉类规则，padding-left:20px 失效）",
			/\bpadding:/.test(setInputAttrs) === false && /\bflex:/.test(setInputAttrs) === false && /\bwidth:/.test(setInputAttrs) === false,
			setInputAttrs.replace(/\s+/g, " ").slice(0, 160));
		// 行高不变（"别变长"）：①包裹层 display:flex + align-items:center ⇒ 没有行盒
		// （inline-block 的 input 当 flex 子项时才可能多出基线以下的余量）②包裹层自己不设
		// height / min-height / padding ③图标绝对定位、不是 flex item ④input 竖直内边距仍是 2px
		// （高度 = 16 行高 + 4 + 2 边框 = 22px，与改动前逐像素相同）。
		check("设置页：包裹层 display:flex + align-items:center（没有行盒 ⇒ 高度 = input 高度）",
			/\.gacha-cal-set-find\{[^}]*display:flex[^}]*align-items:center/.test(css));
		check("设置页：包裹层不给自己加 height / min-height / padding（这一行高度只能由 input 决定）",
			!/\.gacha-cal-set-find\{[^}]*\bheight:/.test(css)
			&& !/\.gacha-cal-set-find\{[^}]*min-height:/.test(css)
			&& !/\.gacha-cal-set-find\{[^}]*padding:/.test(css));
		check("设置页：图标用绝对定位 + top:50%（不是 flex item ⇒ 不占输入框宽度、不改行高）",
			/\.gacha-cal-set-find-ic\{[^}]*position:absolute/.test(css)
			&& /\.gacha-cal-set-find-ic\{[^}]*top:50%/.test(css));
		check("设置页：input 竖直内边距仍是 2px 且没另设 line-height（22px 行高逐像素不变）",
			/\.gacha-cal-set-find input\{[^}]*padding:2px 6px 2px 20px/.test(css)
			&& !/\.gacha-cal-set-find input\{[^}]*line-height:/.test(css));
		// 这一行**没有**「× 清空」按钮（有× 的是底栏 .gacha-cal-sched-find-x）⇒ 不存在与放大镜抢位置。
		check("设置页：这一行没有「× 清空」按钮 ⇒ 与放大镜不冲突（清空走 Esc）",
			comp.includes('onKeyDown: (e) => { if (e.key === "Escape") setGameQuery(""); }')
			&& !/gacha-cal-set-find-x/.test(comp));

		// 只影响显示：轮播仍读**未过滤**的 games
		check("轮播 memo 仍读未过滤的 games（tickerItemsOf(games, now, tickerHours) 原样）",
			/\(tickerOn\s*\n\s*\? tickerItemsOf\(games, now, tickerHours\)\s*\n\s*: \[\]\)/.test(comp));
		check("轮播 memo 的依赖里没有搜索词 / 过滤后的表",
			!/tickerItemsOf\(shownGames/.test(comp)
			&& !/\[games, now, tickerOn, tickerHours[^\]]*findQuery/.test(comp));
		check("搜索状态不参与任何设置写入（没有 commit(\"gameQuery\") / commit(\"onlyShown\")）",
			!codes.includes('commit("gameQuery"') && !codes.includes('commit("onlyShown"'));
		check("搜索词 / 只看已启用**不落盘**：DEFAULT_SETTINGS 与 CONFIG_KEYS 里都没有这两个键",
			!/gameQuery|onlyShown|findQuery/.test(cfg) && !/gameQuery|onlyShown|findQuery/.test(head));
		check("过滤不碰 lastData（过滤函数体内没有 lastData / commit）",
			!/function settingsGamesFilter[\s\S]{0,800}?lastData/.test(comp)
			&& !/function panelGamesFilter[\s\S]{0,600}?lastData/.test(comp));

		// core 产物：纯函数进的是 core 段（60-helpers.js），不依赖宿主
		const core = readSrc(path.join("packages", "core", "core.mjs"));
		check("core 产物里也有这组纯函数（60-helpers.js 属 core 共用段）",
			core.includes("function settingsGamesFilter") && core.includes("function panelGamesFilter")
			&& core.includes("function searchNorm"));
	}

	// ── ⑦ 数据事实：没有可靠的地区字段 ⇒ 本次跳过分组 ─────────────────────────
	{
		const REGION_KEYS = ["region", "regionId", "area", "server", "serverRegion", "country"];
		const withRegion = SOURCES.filter((s) => REGION_KEYS.some((k) => s[k] != null && s[k] !== ""));
		check("能取到 SOURCES（守卫自身没瞎）", SOURCES.length >= 28, String(SOURCES.length));
		// 这条不是"永远不许加"的禁令，是**事实守卫**：哪天给条目补了地区字段，
		// 这里会红，提醒把「国服 / 日服 / 国际服」分组补上（本段开头的长注释写了为什么当时没做）。
		check("SOURCES 条目里没有 region/area/server 之类的地区字段（有 ⇒ 该补分组了）",
			withRegion.length === 0, withRegion.map((s) => s.id + ":" + JSON.stringify(s.region || s.area || s.server)).join(","));
		const hasSuffix = SOURCES.filter((s) => /·(国服|日服|国际服)$/.test(String(s.name || ""))).length;
		check("只有少数来源的名字带「·国服/·日服/·国际服」后缀（按名字硬推会漏掉大多数）",
			hasSuffix > 0 && hasSuffix < SOURCES.length, hasSuffix + "/" + SOURCES.length);
	}
}
