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
//   ⑦ 数据事实：`SOURCES` 里没有可靠的地区字段 ⇒ 本次**跳过分组**（加字段时要回来补这一条）。
//
// ⚠️ 「分组（国服/日服/国际服）」刻意**没做**：`registerSource` 的字段只有
//    id / name / tz / icon / url / source / eventUrl / eventSource / altSources / eventAltSources /
//    defaultHidden / parserVersion（+ 颜色由 SOURCE_COLORS 下发），**没有任何地区字段**；
//    `tz` 是**源站时区**不是地区（反例：ournotes-global 是国际服但 tz=Asia/Shanghai），
//    名字里也只有 11 条带「·国服/·日服/·国际服」后缀 ⇒ 按名字/时区硬推会把 17 条归错。
//    按任务书"数据里没有可靠的地区字段就不要硬造"⇒ 跳过，等有字段再补。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
