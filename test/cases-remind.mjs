// test/cases-remind.mjs —— 到期提醒（2026-10-25 晚：侧栏单行轮播 + 每游戏「强提醒」开关）
//                        （同日二次定稿：强提醒改**普通列表**语义 + 轮播改 **C 方案**）
//
// 功能范围（用户定）：侧栏按钮「单行轮播」+「提前 N 小时」设置 + 每游戏「强提醒」开关。
// 不做系统通知、不做弹窗/声音、不动刷新链路、不动缓存载荷结构。
//
// 本文件守六件事：
//   ① 判定口径（纯函数 `isExpiringSoon`，60-helpers.js）：
//      某侧"即将到期" = 该侧**已开始**（startTs <= now）且 **endTs 落在 (now, now + N 小时]**。
//   ② 双向判定（纯函数 `remindKindOf`，2026-10-25 晚）：即将**开始**也算提醒。
//      ""（不算）/ "end"（即将结束）/ "start"（即将开始）三态，两个方向天然互斥。
//   ③ 「强提醒」筛选语义（纯函数 `remindGameAllowed`）：**普通列表** —— 列表里有谁就提醒谁，
//      **空数组 = 一个都不提醒**（2026-10-25 二次定稿，**废弃**"空 = 全部参与"的哨兵）。
//      + **守卫**：`DEFAULT_SETTINGS.remindGames`（及 src/index.js 的 schema default）
//        必须恰好等于所有 `defaultHidden !== true` 的来源 id —— 新增来源/改默认隐藏时提醒同步。
//   ④ 轮播条目选取与**每格结构**（纯函数 `remindPickOf` / `remindCaptionOf` / `remindSlidesOf`）：
//      多条时顺序稳定（按"距离那一刻还有多远"升序，同刻保持输入顺序）、无可提醒条目时返回空
//      （⇒ 按钮只有状态 0、不滚动）；C 方案每格 = { gameId, gameIcon, itemName, statusText }
//      （事项名优先、状态单独一段、**分隔符 " · " 两侧都有空格**）。
//   ⑤ 清单层（`remindDueOf`，80-components.js）：落盘的「源站墙钟文本 + tz」要能换算出**绝对**窗口
//      —— 这一层必须与运行环境时区无关（CI 跑 UTC、开发机跑 +08，两边都要绿）。
//      做法：断言 remindWindowOf 的 ts 等于 `sourceInstant(...)` 的独立算法结果，不写死本机偏移。
//   ⑥ 样式静态守卫：按钮尺寸不许被撑开 / 动画只许一次性 backwards / 70-styles.js 模板字符串完整。
//
// ⚠️ 时刻全部显式传入（`now` 是参数，不是 Date.now()），所以本文件不随跑测那天漂移。
// ⚠️ 「今天 / 明天 / N 天后」用的是**本机日历日**，所以这里挑的偏移量在 UTC 与 +08 下落在同一天
//    （+8h / +30h / +50h：两边都是 今天 / 明天 / 后天）。

import { check, section } from "./harness.mjs";
import { T } from "./load.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

export default async function run() {
	section("到期提醒（侧栏单行轮播 + 「提前 N 小时」+ 每游戏「强提醒」）");
	const {
		isExpiringSoon, expiringSoonOf,
		remindKindOf, remindGameAllowed, remindPickOf, remindCaptionOf, remindSlidesOf,
		remindWindowOf, remindDueOf, sourceInstant, DEFAULT_SETTINGS, SOURCES
	} = T;

	const NOW = Date.UTC(2026, 9, 25, 4, 0);   // 2026-10-25 12:00 +08 / 13:00 +09 / 04:00 UTC
	const now = new Date(NOW);
	const H = 3600000;

	// ── ① 判定口径（纯函数，六条 + 两个边界）──────────────────────────────────
	{
		// ① 未开始：已经满足"24 小时内结束"（endTs = now + 5h），但 startTs 还在未来 → **不算**
		check("① 未开始（startTs > now）→ 不算「到期」（哪怕 endTs 就在 5 小时后）",
			isExpiringSoon(NOW + 1 * H, NOW + 5 * H, NOW, 24) === false);

		// ② 已结束：整段都在过去 → 不算
		check("② 已结束（endTs < now）→ 不算",
			isExpiringSoon(NOW - 10 * H, NOW - 1 * H, NOW, 24) === false);

		// ③ 刚刚开始、1 小时后结束、N=24 → 算
		check("③ 刚开始（startTs = now - 1 分钟）、1 小时后结束、N=24 → 算",
			isExpiringSoon(NOW - 60000, NOW + 1 * H, NOW, 24) === true);

		// ④ 25 小时后结束、N=24 → 不算；同一窗口换成 N=48 → 算（阈值真的在起作用）
		check("④ 25 小时后结束、N=24 → 不算",
			isExpiringSoon(NOW - 1 * H, NOW + 25 * H, NOW, 24) === false);
		check("④ 同一窗口换成 N=48 → 算（阈值不是写死的）",
			isExpiringSoon(NOW - 1 * H, NOW + 25 * H, NOW, 48) === true);

		// ⑤ N=0（设置里的「关闭」）→ 永远不算（拿③那个"最该算"的窗口来验）
		check("⑤ N=0（关闭）→ 永远不算",
			isExpiringSoon(NOW - 60000, NOW + 1 * H, NOW, 0) === false
			&& isExpiringSoon(NOW - 60000, NOW + 1 * H, NOW, -24) === false
			&& isExpiringSoon(NOW - 60000, NOW + 1 * H, NOW, null) === false
			&& isExpiringSoon(NOW - 60000, NOW + 1 * H, NOW, void 0) === false);

		// ⑥ 缺 startTs / endTs（或不是有限数字）→ 不算：落盘缓存只存文本，绝对档期是**现算**的，
		//    算不出来就是算不出来 —— 绝不拿半个窗口凑一个到期提醒
		check("⑥ 缺 startTs 或 endTs → 不算",
			isExpiringSoon(void 0, NOW + 1 * H, NOW, 24) === false
			&& isExpiringSoon(NOW - H, void 0, NOW, 24) === false
			&& isExpiringSoon(null, null, NOW, 24) === false
			&& isExpiringSoon(NaN, NOW + H, NOW, 24) === false
			&& isExpiringSoon(NOW - H, Infinity, NOW, 24) === false
			&& isExpiringSoon(String(NOW - H), String(NOW + H), NOW, 24) === false);

		// 闭区间两端：(now, now + N] —— 左端开、右端闭
		check("边界：endTs == now（刚好结束）→ 不算（左端开区间）",
			isExpiringSoon(NOW - 2 * H, NOW, NOW, 24) === false);
		check("边界：endTs == now + N 小时 → 算（右端闭区间）",
			isExpiringSoon(NOW - 2 * H, NOW + 24 * H, NOW, 24) === true
			&& isExpiringSoon(NOW - 2 * H, NOW + 24 * H + 1, NOW, 24) === false);
		check("startTs == now（刚起步那一刻）→ 算（左端 startTs <= now 闭）",
			isExpiringSoon(NOW, NOW + 2 * H, NOW, 24) === true);
	}

	// ── ② 双向判定（remindKindOf，2026-10-25 晚）：即将开始也算 ────────────────
	{
		// 结束方向
		check("双向·结束：已开始 + 3 小时后结束 + N=24 → \"end\"",
			remindKindOf(NOW - 1 * H, NOW + 3 * H, NOW, 24) === "end");
		check("双向·结束：threshold 边界 endTs == now + N → \"end\"；再晚 1ms → \"\"",
			remindKindOf(NOW - 1 * H, NOW + 24 * H, NOW, 24) === "end"
			&& remindKindOf(NOW - 1 * H, NOW + 24 * H + 1, NOW, 24) === "");
		// 开始方向
		check("双向·开始：还没开始 + 5 小时后开始 + N=24 → \"start\"",
			remindKindOf(NOW + 5 * H, NOW + 9 * H, NOW, 24) === "start");
		check("双向·开始：25 小时后开始 N=24 → \"\"；同一窗口 N=48 → \"start\"（阈值在起作用）",
			remindKindOf(NOW + 25 * H, NOW + 30 * H, NOW, 24) === ""
			&& remindKindOf(NOW + 25 * H, NOW + 30 * H, NOW, 48) === "start");
		check("双向·开始：startTs == now + N → \"start\"（右端闭）",
			remindKindOf(NOW + 24 * H, NOW + 30 * H, NOW, 24) === "start");
		// 两个方向**互斥**：同一时刻只可能是其中一个（startTs 落在 now 的哪一侧决定的）
		check("双向·互斥：已开始的窗口不会同时被判成 start，未开始的也不会被判成 end",
			remindKindOf(NOW - H, NOW + 2 * H, NOW, 24) === "end"
			&& remindKindOf(NOW + 1, NOW + 2 * H, NOW, 24) === "start"
			&& remindKindOf(NOW, NOW + 2 * H, NOW, 24) === "end");   // startTs == now 属于"已开始"
		// 不算的情况
		check("双向·不算：已结束 / 还太远（开始和结束都在窗外）/ 关闭 / 脏数据 / 结束早于开始",
			remindKindOf(NOW - 5 * H, NOW - 1 * H, NOW, 24) === ""
			&& remindKindOf(NOW + 30 * H, NOW + 40 * H, NOW, 24) === ""
			&& remindKindOf(NOW - 1 * H, NOW + 3 * H, NOW, 0) === ""
			&& remindKindOf(NOW - 1 * H, NOW + 3 * H, NOW, null) === ""
			&& remindKindOf(void 0, NOW + 3 * H, NOW, 24) === ""
			&& remindKindOf(NOW - 1 * H, void 0, NOW, 24) === ""
			&& remindKindOf(NaN, NaN, NOW, 24) === ""
			&& remindKindOf(NOW + 3 * H, NOW + 1 * H, NOW, 24) === "");  // 脏数据：结束早于开始
	}

	// ── ③ 列表版（expiringSoonOf）：关闭时短路 + 顺序保持 ──────────────────────
	{
		const items = [
			{ key: "a", startTs: NOW - 1 * H, endTs: NOW + 5 * H },    // 算
			{ key: "b", startTs: NOW + 1 * H, endTs: NOW + 6 * H },    // 未开始 → 不算
			{ key: "c", startTs: NOW - 3 * H, endTs: NOW + 2 * H },    // 算
			{ key: "d", startTs: NOW - 3 * H, endTs: NOW + 30 * H },   // 超 24h → 不算
			{ key: "e", startTs: void 0, endTs: NOW + 2 * H },         // 缺 ts → 不算
			null                                                       // 脏数据不许抛
		];
		const hit = expiringSoonOf(items, NOW, 24);
		check("列表版：只留下「已开始 + 24 小时内结束」的 2 条",
			hit.length === 2, JSON.stringify(hit.map((x) => x.key)));
		check("列表版：顺序保持输入顺序（a 在前、c 在后）",
			hit.map((x) => x.key).join(",") === "a,c", hit.map((x) => x.key).join(","));
		check("列表版：N=0（关闭）→ 空数组（关闭时不做任何计算）",
			expiringSoonOf(items, NOW, 0).length === 0);
		check("列表版：非数组 → 空数组（不抛）", expiringSoonOf(null, NOW, 24).length === 0);
	}

	// ── ④ 「强提醒」筛选语义（remindGameAllowed）：**普通列表**，空 = 一个都不提醒 ──────
	// 2026-10-25 二次定稿：废弃"空数组 = 全部参与"的哨兵（用户原话「副作用过大，改成正常的逻辑」），
	// 并且"取消最后一个勾被拒绝"必须修掉 —— 空列表现在就是"一个都不提醒"，是**合法的终态**。
	{
		check("remindGames 为空数组 → **一个都不提醒**（不再有「空 = 全部」的哨兵）",
			remindGameAllowed("g1", []) === false && remindGameAllowed("随便什么", []) === false);
		check("remindGames 缺失 / 不是数组 → 也不提醒（纯函数不猜「没设置过」，默认值由 DEFAULT_SETTINGS/schema 给）",
			remindGameAllowed("g1", void 0) === false
			&& remindGameAllowed("g1", null) === false
			&& remindGameAllowed("g1", "g1") === false);
		check("remindGames 非空 → **只有列表里的参与**（[\"a\"] 只提醒 a）",
			remindGameAllowed("a", ["a"]) === true
			&& remindGameAllowed("b", ["a"]) === false
			&& remindGameAllowed("a", ["b", "c"]) === false);

		// ── 守卫：出厂默认提醒列表 == 出厂时「展示中」的来源（defaultHidden !== true）──────────
		// 它钉住两件事（这是"开箱即用"从哨兵手里接过来的保证）：
		//   ① 新增来源时提醒必须同步（忘了改默认列表就红）；
		//   ② 改某个条目的 defaultHidden 时提醒必须同步（否则默认隐藏的条目会偷偷提醒，反之亦然）。
		// 比较口径：两边都去重 + 排序后整体相等（顺序无所谓，集合必须相同）。
		const sortIds = (xs) => [...xs].sort();
		const shownIds = sortIds(SOURCES.filter((s) => s.defaultHidden !== true).map((s) => s.id));
		const defIds = sortIds(DEFAULT_SETTINGS.remindGames);
		check("默认 remindGames（去重排序后）**恰好等于**所有 defaultHidden !== true 的来源 id（排序后）",
			defIds.length === new Set(defIds).size && defIds.join(",") === shownIds.join(","),
			"默认=" + defIds.join(",") + " ／ 展示中=" + shownIds.join(","));
		check("默认 remindGames **不含**出厂默认隐藏的条目（defaultHidden === true 的一个都不许进来）",
			SOURCES.filter((s) => s.defaultHidden === true).every((s) => !defIds.includes(s.id)),
			SOURCES.filter((s) => s.defaultHidden === true).map((s) => s.id).join(","));
		check("默认 remindGames 非空（否则开箱即用就没了）", defIds.length > 0, String(defIds.length));

		// schema 那一侧的 default 必须与 DEFAULT_SETTINGS 一致：两处都是"出厂值"，漂了就是两套默认
		// （客户端 spread 用 DEFAULT_SETTINGS，宿主表单用 schema default，用户看到哪个取决于读哪一边）。
		{
			const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
			const m = /remindGames:\s*z\.array\(z\.string\(\)\)\.default\((\[[\s\S]*?\])\)/.exec(hostSrc);
			let hostDefault = null;
			if (m) { try { hostDefault = JSON.parse(m[1]); } catch { hostDefault = null; } }
			check("src/index.js 的 schema `.default(...)` 能解析出来（守卫自身没瞎）",
				Array.isArray(hostDefault), m ? m[1].slice(0, 80) : "没匹配到 remindGames 的 default");
			check("src/index.js 的 schema default 与 DEFAULT_SETTINGS.remindGames 逐项一致（排序后）",
				Array.isArray(hostDefault) && sortIds(hostDefault).join(",") === defIds.join(","),
				Array.isArray(hostDefault) ? sortIds(hostDefault).join(",") : "null");
		}
	}

	// ── ⑤ 轮播条目选取（remindPickOf）：顺序稳定 + 无命中→空 ──────────────────
	// 候选契约与 80-components.js 的 remindDueOf 组装出来的完全一致
	// （{ key, gameId, side, name, title, gameIcon, startTs, endTs }）；这里刻意**绕开**文本换算，
	// 直接喂绝对时刻 —— 选取/排序/筛选这一层本身就是纯的。
	// 第四个参数是「强提醒」列表（普通列表语义）：空 = 一个都不提醒，所以在"要全都要"的用例里
	// 必须把 id 显式写全 —— 这正是废弃哨兵后的代价，也正是用户要的"正常的逻辑"。
	{
		const cand = [
			{ key: "a:gacha", gameId: "a", side: "gacha", name: "甲", title: "池甲", startTs: NOW - 1 * H, endTs: NOW + 3 * H },   // end，3h 后
			{ key: "b:gacha", gameId: "b", side: "gacha", name: "乙", title: "池乙", startTs: NOW + 5 * H, endTs: NOW + 9 * H },   // start，5h 后
			{ key: "c:event", gameId: "c", side: "event", name: "丙", title: "活动丙", startTs: NOW + 1 * H, endTs: NOW + 2 * H }, // start，1h 后
			{ key: "d:event", gameId: "d", side: "event", name: "丁", title: "活动丁", startTs: NOW - 2 * H, endTs: NOW + 30 * H }  // end 30h > 24 → 不算
		];
		const ALL = ["a", "b", "c", "d"];
		const pick = remindPickOf(cand, NOW, 24, ALL);
		check("选取：只留下 24 小时内的 3 条（两个方向混在一起，按紧迫度排）",
			pick.map((x) => x.key).join(",") === "c:event,a:gacha,b:gacha", pick.map((x) => x.key).join(","));
		check("选取：每条都带上方向 kind（c=start / a=end）与 dueMs",
			pick[0].kind === "start" && pick[1].kind === "end"
			&& pick[0].dueMs === 1 * H && pick[1].dueMs === 3 * H,
			JSON.stringify(pick.map((x) => [x.key, x.kind, x.dueMs])));
		check("选取：叫两遍结果完全一致（顺序稳定、无随机成分）",
			remindPickOf(cand, NOW, 24, ALL).map((x) => x.key).join(",")
			=== remindPickOf(cand, NOW, 24, ALL).map((x) => x.key).join(","));
		// 同一毫秒的多条：保持**输入顺序**（不是按名字/按 id 再排一次）
		{
			const tie = [
				{ key: "x", gameId: "x", side: "gacha", name: "X", startTs: NOW + 2 * H, endTs: NOW + 3 * H },
				{ key: "y", gameId: "y", side: "gacha", name: "Y", startTs: NOW - 1 * H, endTs: NOW + 2 * H }
			];
			check("选取：同一紧迫度时保持输入顺序（x 在 y 前）",
				remindPickOf(tie, NOW, 24, ["x", "y"]).map((x) => x.key).join(",") === "x,y",
				remindPickOf(tie, NOW, 24, ["x", "y"]).map((x) => x.key).join(","));
		}
		// 强提醒筛选（普通列表语义）
		check("选取：remindGames 为空 → **0 条**（空列表 = 一个都不提醒）",
			remindPickOf(cand, NOW, 24, []).length === 0);
		check("选取：非空列表 → 只有列表里的（[\"a\"] → 只剩 a:gacha）",
			remindPickOf(cand, NOW, 24, ["a"]).map((x) => x.key).join(",") === "a:gacha");
		check("选取：列表里没命中的条目**全部**被筛掉（[\"c\"] 只剩 c:event）",
			remindPickOf(cand, NOW, 24, ["c"]).map((x) => x.key).join(",") === "c:event");
		check("选取：列表写全 → 3 条都在（[\"a\",\"b\",\"c\"]）",
			remindPickOf(cand, NOW, 24, ["a", "b", "c"]).map((x) => x.key).join(",") === "c:event,a:gacha,b:gacha");
		check("选取：列表里写了一个不存在的 id → 空数组（不会退回「全部」）",
			remindPickOf(cand, NOW, 24, ["nope"]).length === 0);
		// 无可提醒 → 空（⇒ 按钮只有状态 0，不滚动）
		check("选取：没有任何命中 → 空数组（⇒ 不滚动）",
			remindPickOf([], NOW, 24, ALL).length === 0
			&& remindPickOf(cand, NOW, 0, ALL).length === 0        // 关闭
			&& remindPickOf(cand, NOW, 24, ["nope"]).length === 0); // 全被筛掉
		check("选取：脏输入不抛（null / 非数组 / 数组里夹 null / N=0）",
			remindPickOf(null, NOW, 24, ALL).length === 0
			&& remindPickOf(cand, NOW, 0, ALL).length === 0
			&& remindPickOf([null, void 0, 1], NOW, 24, ALL).length === 0);
	}

	// ── ⑥ 轮播文案与**每格结构**（remindCaptionOf / remindSlidesOf，C 方案）──────────
	// 2026-10-25 二次定稿（用户 C 方案）：
	//   · 文字优先显示**事项名**（banner/event 名 = 那一期的角色/活动名）—— 只有游戏名时
	//     "哪个池子/哪个活动"根本看不出来；游戏身份交给**图标**（gameIcon）。
	//   · 再加一条硬要求：分隔符**前后都要有空格**（上一版渲染成「少女· 还剩」，少一个空格）。
	{
		const endItem = { key: "k", gameId: "k", side: "gacha", name: "绝区零", title: "耀嘉音", startTs: NOW - 2 * H, endTs: NOW + 3 * H, kind: "end" };
		const capEnd = remindCaptionOf(endItem, NOW);
		check("文案·结束：**事项名优先**（name=耀嘉音，不是游戏名绝区零）",
			capEnd.name === "耀嘉音", JSON.stringify(capEnd));
		check("文案·结束：整行是 `耀嘉音 · 3 小时`（结束方向上 名字在前、状态在后；按钮这一侧**不带「还剩」**）",
			capEnd.status === "3 小时" && capEnd.text === "耀嘉音 · 3 小时",
			JSON.stringify(capEnd));
		// 读屏 / 悬停（aria-label / title）要的是完整句子 —— 那里**保留「还剩」**（用户 2026-10-25 明确要求）：
		// 按钮省宽度去掉的词，在这一份里补回来，其余一字不差。
		check("读屏·结束：完整句子里保留「还剩」（statusFull / ariaText）",
			capEnd.statusFull === "还剩 3 小时" && capEnd.ariaText === "耀嘉音 · 还剩 3 小时",
			JSON.stringify([capEnd.statusFull, capEnd.ariaText]));
		check("分隔符：生成的文本里有 ` · `（**前后都有空格** —— 上一版少了前导空格）",
			capEnd.text.indexOf(" · ") > 0
			&& remindCaptionOf({ ...endItem, endTs: NOW + 45 * 60000 }, NOW).text.indexOf(" · ") > 0,
			JSON.stringify(capEnd.text));
		check("文案·结束：没有事项名时回退到游戏名（自定义条目可能没有 title）",
			remindCaptionOf({ ...endItem, title: "" }, NOW).name === "绝区零"
			&& remindCaptionOf({ ...endItem, title: "", name: "" }, NOW).name === "k");
		check("文案·结束：不足 1 小时按分钟说（45 分）",
			remindCaptionOf({ ...endItem, endTs: NOW + 45 * 60000 }, NOW).status === "45 分");
		check("文案·结束：≥1 天**只说天数**（30 小时 → 1 天，小时段丢掉）",
			remindCaptionOf({ ...endItem, endTs: NOW + 30 * H }, NOW).status === "1 天");
		check("文案·结束：1 天 17 时 → 1 天（丢掉 17 时，不四舍五入到 2 天）",
			remindCaptionOf({ ...endItem, endTs: NOW + 41 * H }, NOW).status === "1 天");
		check("文案·结束：24 天 10 时 → 24 天（天数不封顶、也不带小时）",
			remindCaptionOf({ ...endItem, endTs: NOW + (24 * 24 + 10) * H }, NOW).status === "24 天");
		check("文案·结束：向下取整（3 小时 59 分 → 3 小时，不虚报）",
			remindCaptionOf({ ...endItem, endTs: NOW + 3 * H + 59 * 60000 }, NOW).status === "3 小时");

		// 开始方向：今天 / 明天 / N 天后（偏移量在 UTC 与 +08 下同一天，见文件头注释）
		const gachaStart = (startTs) => ({ key: "k", gameId: "k", side: "gacha", name: "星塔旅人", title: "限定寻访", startTs, endTs: startTs + 10 * H, kind: "start" });
		check("文案·开始（卡池）：今天开工 → `限定寻访 · 今天开池`",
			remindCaptionOf(gachaStart(NOW + 8 * H), NOW).text === "限定寻访 · 今天开池",
			remindCaptionOf(gachaStart(NOW + 8 * H), NOW).text);
		check("文案·开始（卡池）：明天 → `限定寻访 · 明天开池`",
			remindCaptionOf(gachaStart(NOW + 30 * H), NOW).text === "限定寻访 · 明天开池",
			remindCaptionOf(gachaStart(NOW + 30 * H), NOW).text);
		check("文案·开始（卡池）：2 天后 → `限定寻访 · 2 天后开池`",
			remindCaptionOf(gachaStart(NOW + 50 * H), NOW).text === "限定寻访 · 2 天后开池",
			remindCaptionOf(gachaStart(NOW + 50 * H), NOW).text);
		check("文案·开始（活动）：活动侧说「开始」而不是「开池」",
			remindCaptionOf({ ...gachaStart(NOW + 30 * H), side: "event" }, NOW).status === "明天开始");
		check("文案：缺 name/title → 兜底「某个游戏」（不抛、也不显示 undefined）",
			remindCaptionOf({ kind: "end", endTs: NOW + H }, NOW).name === "某个游戏"
			&& remindCaptionOf(null, NOW).text.indexOf("undefined") < 0);

		// —— C 方案的**每格结构**：{ gameId, gameIcon, itemName, statusText } ——
		// 渲染层（80-components.js）只认这一种形状；状态 0（原按钮外观）**不在**这里 ——
		// 所以"无可提醒 ⇒ 只有状态 0、不滚动"在数据层就是"slides 为空"。
		const due = [
			{ key: "a:gacha", id: "a", gameId: "a", side: "gacha", name: "绝区零", title: "耀嘉音", gameIcon: "https://cdn.example/a.png", startTs: NOW - 2 * H, endTs: NOW + 3 * H, kind: "end", dueMs: 3 * H },
			{ key: "c:event", id: "c", gameId: "c", side: "event", name: "星塔旅人", title: "「养成奖励」碎片追加活动", gameIcon: "https://cdn.example/c.png", startTs: NOW + 1 * H, endTs: NOW + 2 * H, kind: "start", dueMs: 1 * H }
		];
		const slides = remindSlidesOf(due, NOW);
		check("每格结构：一条提醒一格（2 条 → 2 格）", slides.length === 2, String(slides.length));
		check("每格结构：都带 gameId / gameIcon / itemName / statusText（C 方案的四件套）",
			slides.every((s) => typeof s.gameId === "string" && typeof s.gameIcon === "string"
				&& typeof s.itemName === "string" && typeof s.statusText === "string"),
			JSON.stringify(slides.map((s) => [s.gameId, s.gameIcon, s.itemName, s.statusText])));
		check("每格结构：gameId / gameIcon 用的是**该条目自己的**（不是包一层固定日历图标）",
			slides[0].gameId === "a" && slides[0].gameIcon === "https://cdn.example/a.png"
			&& slides[1].gameId === "c" && slides[1].gameIcon === "https://cdn.example/c.png",
			JSON.stringify(slides.map((s) => [s.gameId, s.gameIcon])));
		check("每格结构：itemName = 事项名（活动名原样带引号也要照搬）",
			slides[0].itemName === "耀嘉音" && slides[1].itemName === "「养成奖励」碎片追加活动",
			JSON.stringify(slides.map((s) => s.itemName)));
		check("每格结构：statusText 只有状态那半句（不把名字混进去，也不带「还剩」）",
			slides[0].statusText === "3 小时" && slides[1].statusText === "今天开始",
			JSON.stringify(slides.map((s) => s.statusText)));
		check("每格结构：text = `事项名 · 状态`（按钮上显示的那一份，分隔符两侧都有空格）",
			slides[0].text === "耀嘉音 · 3 小时" && slides[1].text === "「养成奖励」碎片追加活动 · 今天开始",
			JSON.stringify(slides.map((s) => s.text)));
		check("每格结构：ariaText = 读屏版（结束方向带「还剩」，开始方向与 text 相同）",
			slides[0].ariaText === "耀嘉音 · 还剩 3 小时"
			&& slides[1].ariaText === "「养成奖励」碎片追加活动 · 今天开始",
			JSON.stringify(slides.map((s) => s.ariaText)));
		check("每格结构：还带 gameName 给悬停/读屏补「哪款游戏」（文字里不占宽度）",
			slides[0].gameName === "绝区零" && slides[1].gameName === "星塔旅人");
		check("每格结构：缺 gameIcon 时是空串（渲染层据此退化成首字方块），不是 undefined",
			remindSlidesOf([{ key: "z", gameId: "z", name: "某游", title: "某池", startTs: NOW - H, endTs: NOW + H, kind: "end" }], NOW)[0].gameIcon === "");
		check("每格结构：无可提醒 → 空数组（⇒ 只有状态 0、不滚动）",
			remindSlidesOf([], NOW).length === 0 && remindSlidesOf(null, NOW).length === 0);
	}

	// ── ⑦ 清单层：落盘文本 + tz → 绝对窗口（与运行环境时区无关）──────────────
	// 源站固定 Asia/Tokyo（+09）。用 sourceInstant 独立算一遍绝对时刻来对照，
	// 因此断言在 TZ=UTC 与 +08 下都成立。
	{
		const tz = "Asia/Tokyo";
		const games = [
			{
				id: "g1", name: "游戏甲", tz,
				// 卡池：源站 10-24 20:00 ~ 10-25 14:00 = 绝对 10-24T11:00Z ~ 10-25T05:00Z（= now + 1h）
				banner: "池甲", roles: "角色甲", bannerDates: "10-24 20:00 ~ 10-25 14:00",
				// 活动：同一窗口 → 两侧都该命中
				event: "活动甲", eventDates: "10-24 20:00 ~ 10-25 14:00"
			},
			{
				id: "g2", name: "游戏乙", tz,
				// 即将开始：源站 10-25 15:00（= 06:00Z = now + 2h）→ 双向判定里属于 "start"
				banner: "池乙", bannerDates: "10-25 15:00 ~ 10-25 20:00",
				// 25 小时后结束：源站 10-26 14:00（= 10-26T05:00Z = now + 25h）→ N=24 不算、N=48 算
				event: "活动乙", eventDates: "10-25 10:00 ~ 10-26 14:00"
			},
			{
				id: "g3", name: "游戏丙", tz,
				// 源站原文读不出绝对档期（"版本更新后 ~ …"）→ 不参与提醒，不硬凑
				banner: "池丙", bannerDates: "版本更新后 ~ 10-21 11:59",
				event: "活动丙", eventDates: ""
			},
			{
				id: "custom-1", name: "自定义条目", tz: null,
				// 自定义条目没填 tz → localWinText 返回 null（宁可不算，也不按错时区猜）
				banner: "自定池", bannerDates: "10-24 20:00 ~ 10-25 14:00"
			},
			{
				id: "g4", name: "游戏丁", tz,
				// 卡池侧直接带绝对档期（fetch 层契约）：走 localWin 那条路，不走文本换算
				banner: "池丁", startTs: NOW - 1 * H, endTs: NOW + 2 * H,
				// 该游戏只有卡池这一侧
				event: "", eventDates: "",
				// 该条目自己的图标（C 方案：轮播那一格用它，不再固定用日历图标）
				icon: "https://cdn.example/g4.png"
			}
		];

		// 窗口换算：与 sourceInstant 的独立算法对齐（不写死本机偏移）
		{
			const w = remindWindowOf(games[0], true, now);
			const start = sourceInstant(2026, 10, 24, 20, 0, tz);
			const end = sourceInstant(2026, 10, 25, 14, 0, tz);
			check("文本 + tz → 绝对窗口（与 sourceInstant 独立算法一致）",
				!!w && w.startTs === start && w.endTs === end,
				JSON.stringify([w && w.startTs, start, w && w.endTs, end]));
			check("绝对窗口确实落在 now 的两侧（前置条件：这条真的「已开始、1 小时后结束」）",
				!!w && w.startTs < NOW && w.endTs === NOW + 1 * H);
			// 卡池侧带 startTs/endTs 时优先用它们（不经过文本）
			const w2 = remindWindowOf(games[4], true, now);
			check("卡池侧有 startTs/endTs → 直接采用（与文本换算同一条链，结果相等）",
				!!w2 && w2.startTs === NOW - 1 * H && w2.endTs === NOW + 2 * H);
			check("读不出绝对档期的一律 null（源站原文 / 缺 tz / 缺内容）",
				remindWindowOf(games[2], true, now) === null
				&& remindWindowOf(games[3], true, now) === null
				&& remindWindowOf({ banner: "", bannerDates: "" }, true, now) === null
				&& remindWindowOf(null, true, now) === null);
		}

		// 清单（N=24，双向）：g1 卡池 + g1 活动（都在 1h 后结束）
		//                  + g2 卡池（2h 后**开始**，双向后新进来的）
		//                  + g4 卡池（2h 后结束）
		//   g2 活动 25h 后才结束 → N=24 不算；g3/custom 读不出绝对档期 → 不参与
		// ⚠️ 第四个参数现在是**普通列表**（空 = 一个都不提醒），所以"全都要"必须把 id 写全。
		const ALL = ["g1", "g2", "g3", "g4", "custom-1"];
		{
			const due = remindDueOf(games, now, 24, ALL);
			check("N=24 的提醒清单 = 4 条（双向：g1 两侧 + g2 卡池开始 + g4 卡池）",
				due.length === 4, JSON.stringify(due.map((x) => x.key)));
			check("清单按紧迫度升序（1h 的两条 → 2h 的两条；同刻保持输入顺序）",
				due.map((x) => x.key).join(",") === "g1:gacha,g1:event,g2:gacha,g4:gacha",
				due.map((x) => x.key).join(","));
			check("清单带方向：g1 两侧是 end、g2 卡池是 start",
				due[0].kind === "end" && due[1].kind === "end" && due[2].kind === "start",
				JSON.stringify(due.map((x) => [x.key, x.kind])));
			check("清单带游戏名与到期标题（按钮悬停用）",
				due[0].name === "游戏甲" && due[0].title === "角色甲", JSON.stringify([due[0].name, due[0].title]));
			check("清单带上**该条目自己的图标**（C 方案：轮播那一格用它，没配就是空串）",
				due.some((x) => x.key === "g4:gacha" && x.gameIcon === "https://cdn.example/g4.png")
				&& due.filter((x) => x.key !== "g4:gacha").every((x) => x.gameIcon === ""),
				JSON.stringify(due.map((x) => [x.key, x.gameIcon])));
			check("清单带的图标能一路进到轮播那一格（remindSlidesOf 的 gameIcon）",
				remindSlidesOf(due, now.getTime()).some((s) => s.gameId === "g4" && s.gameIcon === "https://cdn.example/g4.png"));
			check("即将开始的侧（g2 卡池）以 kind=start 进清单（双向判定的直接证据）",
				due.some((x) => x.key === "g2:gacha" && x.kind === "start"));
			check("25 小时后结束的侧（g2 活动）N=24 不在、N=48 才在",
				!remindDueOf(games, now, 24, ALL).some((x) => x.key === "g2:event")
				&& remindDueOf(games, now, 48, ALL).some((x) => x.key === "g2:event"));
			check("N=48 → 5 条（g2 活动在 25h 后的 end 也进来了）",
				remindDueOf(games, now, 48, ALL).length === 5);
		}

		// 「强提醒」筛选接到清单层（普通列表语义）
		check("remindGames=[\"g1\"] → 清单只剩 g1 的两条（g2/g4 被筛掉）",
			remindDueOf(games, now, 24, ["g1"]).map((x) => x.key).join(",") === "g1:gacha,g1:event");
		check("remindGames=[\"g4\"] → 只剩 g4 卡池",
			remindDueOf(games, now, 24, ["g4"]).map((x) => x.key).join(",") === "g4:gacha");
		check("remindGames 为空 → **0 条**（新语义：空列表 = 一个都不提醒）",
			remindDueOf(games, now, 24, []).length === 0);
		check("remindGames 写全 → 4 条都在（「全勾」的等价写法就是显式列出 id）",
			remindDueOf(games, now, 24, ALL).length === 4);

		// 关闭 = 空清单（按钮不滚动），且不再换算
		check("N=0（关闭）→ 空清单（按钮不滚动）",
			remindDueOf(games, now, 0, ALL).length === 0
			&& remindDueOf(games, now, -1, ALL).length === 0);
		check("N=12 → 4 条都在 12 小时内（1h/1h/2h/2h）",
			remindDueOf(games, now, 12, ALL).length === 4);
		check("脏输入不抛：games 非数组 / now 缺失 → 空清单",
			remindDueOf(null, now, 24, ALL).length === 0
			&& remindDueOf(games, null, 24, ALL).length === 0);
	}

	// ── ⑧ 样式静态守卫：不许撑开按钮 / 动画不许留持久层 / 70-styles.js 模板字符串完整性 ──
	// 用户定下「不要改变按钮尺寸/布局（不能重演上次的按钮错位）」；而 70-styles.js 的 CSS 全藏在
	// 一个模板字符串里（"反引号必须恰好 2 个、注释必须配平"已经踩过两次）。这两条都是
	// **改错了不报错、只在真机上才发现**的病，所以用静态守卫钉住（读源码，不需要 DOM）。
	{
		const styles = readFileSync(path.join(REPO, "src", "client", "70-styles.js"), "utf8");
		const comp = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		const count = (sub) => styles.split(sub).length - 1;
		check("70-styles.js 的反引号恰好 2 个（模板字符串起止各一个）", count("`") === 2, String(count("`")));
		check("70-styles.js 的 /* */ 配平", count("/*") === count("*/"), `${count("/*")} / ${count("*/")}`);
		check("70-styles.js 的 { } 配平", count("{") === count("}"), `${count("{")} / ${count("}")}`);

		const ruleOf = (sel) => {
			const re = new RegExp("\\." + sel.replace(/[-]/g, "\\-") + "\\{([^}]*)\\}");
			const m = re.exec(styles);
			return m ? m[1] : "";
		};
		// 红点：降级用（仅窄侧栏），仍必须绝对定位、不参与 flex、不参与命中
		const dotRule = ruleOf("gacha-cal-dot");
		check("红点规则还在（.gacha-cal-dot，窄侧栏降级用）", !!dotRule, dotRule);
		check("红点是绝对定位（不进按钮的 flex 布局 ⇒ 不会挤动图标/文字）",
			/position:\s*absolute/.test(dotRule), dotRule);
		check("红点不参与鼠标命中（悬停说明因此挂在按钮上）",
			/pointer-events:\s*none/.test(dotRule), dotRule);
		check("按钮提供定位上下文（.gacha-cal-btn 带 position:relative，本身不影响布局）",
			/\.gacha-cal-btn\{[^}]*position:\s*relative/.test(styles));

		// 轮播：固定 22px 高的"窗口" + 内部两行 22px；按钮自身尺寸一个字都不改
		const txtRule = ruleOf("gacha-cal-btn-txt");
		check("轮播窗口 .gacha-cal-btn-txt：overflow:hidden + 固定 22px 高（不撑开按钮）",
			/overflow:\s*hidden/.test(txtRule) && /height:\s*22px/.test(txtRule), txtRule);
		check("轮播窗口：flex:1 1 auto + min-width:0（占满剩余宽度、可收缩，不给按钮加宽高）",
			/flex:\s*1 1 auto/.test(txtRule) && /min-width:\s*0/.test(txtRule), txtRule);
		const lineRule = ruleOf("gacha-cal-btn-line");
		check("轮播行：display:flex + 固定 22px 高（两行叠成 44px，被窗口裁掉一半）",
			/display:\s*flex/.test(lineRule) && /height:\s*22px/.test(lineRule), lineRule);
		const stRule = ruleOf("gacha-cal-btn-st");
		check("状态那一段 flex:none（**永不截断**：窄宽度下必须留下「还剩 3 小时 / 明天开池」）",
			/flex:\s*none/.test(stRule) && /white-space:\s*(?:nowrap|pre)/.test(stRule), stRule);
		// 2026-10-25 二次定稿：状态文字带**前导空格**（" · 还剩 X"），必须是 pre —— nowrap 会把
		// 行首空格折叠掉，渲染成「少女· 还剩」（少一个空格，用户指出的那个 bug）。
		check("状态那一段用 white-space:pre（保留分隔符前的空格，且永不换行）",
			/white-space:\s*pre/.test(stRule), stRule);
		check("渲染层给状态段带的是**带前导空格**的分隔符 ` · `（不是 `· `）",
			comp.includes('" \\u00B7 " + slide.statusText'), "见 80-components.js 的 remindLine");
		const nmRule = ruleOf("gacha-cal-btn-nm");
		check("名字那一段可截断（min-width:0 + 省略号 ⇒ 只丢名字，不丢状态）",
			/min-width:\s*0/.test(nmRule) && /text-overflow:\s*ellipsis/.test(nmRule), nmRule);
		// C 方案：图标在**行内**（跟整行一起翻），不再有固定的日历图标
		const icRule = ruleOf("gacha-cal-btn-ic");
		check("图标格子 .gacha-cal-btn-ic：16px 见方 + flex:none（与原日历图标同尺寸、不参与收缩）",
			/width:\s*16px/.test(icRule) && /height:\s*16px/.test(icRule) && /flex:\s*none/.test(icRule), icRule);
		check("图标格子用 margin-right:8px 复刻原按钮 gap:8px 的图标↔文字间距（按钮自身 gap 不用改）",
			/margin-right:\s*8px/.test(icRule), icRule);
		check("渲染层用了 .gacha-cal-btn-ic（图标确实在翻页那一行里）", comp.includes('"gacha-cal-btn-ic"'));
		check("状态 0 那一格用日历图标、状态 i 用该游戏自己的图标（GameIcon + slide.gameIcon）",
			/const icon = slide[\s\S]{0,200}?GameIcon[\s\S]{0,120}?slide\.gameIcon/.test(comp)
			&& /: calIcon;/.test(comp));
		// 动画：一次性、fill-mode 必须是 backwards（both/forwards 会留持久层）
		check("存在翻页动画 .gacha-cal-btn-flip 且用 animation-fill-mode: backwards",
			/\.gacha-cal-btn-flip\{[^}]*animation:[^;}]*\bbackwards\b/.test(styles));
		check("翻页动画**没有**用 both / forwards（会留一个持久合成层，改变绘制顺序）",
			!/\.gacha-cal-btn-flip\{[^}]*animation:[^;}]*\b(?:both|forwards)\b/.test(styles));
		check("翻页 keyframes：从 -50%（露出上一行）回到 0（当前行）",
			/@keyframes gacha-cal-btn-flip\{from\{transform:translateY\(-50%\)\}to\{transform:translateY\(0\)\}\}/.test(styles));
		check("prefers-reduced-motion：reduce 时动画置 none（完全不滚动）",
			/@media \(prefers-reduced-motion:reduce\)\{\.gacha-cal-btn-flip\{animation:none\}\}/.test(styles));
		// 不可滚动的两种情形都在渲染层短路：没有提醒项 ⇒ 整段轮播都不渲染（只留状态 0）；
		// reduce ⇒ 轮播节拍暂停且静态钉在第 1 格。这两条都是"改错了不报错、真机才发现"的病。
		check("无可提醒时不渲染轮播（remindSlides.length 为 0 ⇒ 按钮回到「图标 + 二文字」原样）",
			/remindSlides\.length\s*\?/.test(comp) && /\(wide === false \|\| remindSlides\.length === 0\) \? calIcon : null/.test(comp));
		check("轮播节拍：slides 为空 / reduce / 悬停 三种情况都暂停（useCycle 的 paused）",
			/useCycle\(remindSlides\.length \+ 1, REMIND_SLIDE_SECS,\s*\n?\s*remindSlides\.length === 0 \|\| reduceMotion \|\| btnHover\)/.test(comp));
		check("reduce 时静态钉在第一条提醒（still 能看出有事）",
			/reduceMotion && remindSlides\.length > 0 \? 1 : slideStep/.test(comp));
		// 祖先层**不许**出现 transform/filter/contain/will-change（浮层 .gacha-cal-sched-rest 依赖包含块）
		const btnRules = [...styles.matchAll(/\.gacha-cal-btn[a-z-]*\{([^}]*)\}/g)].map((m) => m[1]);
		check("能取到 .gacha-cal-btn* 的各条规则（守卫自身没瞎）", btnRules.length >= 5, String(btnRules.length));
		check("按钮/窗口/行/图标格子的规则里没有 transform / filter / contain / will-change（动画只在 .gacha-cal-btn-flip 的 keyframes 里）",
			btnRules.every((b) => !/transform|will-change|filter|contain|perspective/.test(b)),
			btnRules.filter((b) => /transform|will-change|filter|contain|perspective/.test(b)).join(" | "));
		// 接线：CSS 类名必须在渲染层真的用上（否则"样式写了但没人用"这种死代码不会报错）
		for (const cls of ["gacha-cal-btn-txt", "gacha-cal-btn-flip", "gacha-cal-btn-line", "gacha-cal-btn-ic", "gacha-cal-btn-nm", "gacha-cal-btn-st"]) {
			check(`渲染层用了 .${cls}（样式不是死代码）`, comp.includes(`"${cls}"`));
		}
		check("红点在渲染层**只剩窄侧栏降级**这一处（宽侧栏一律走轮播）",
			(comp.match(/"gacha-cal-dot"/g) || []).length === 1
			&& /wide === false[\s\S]{0,400}?gacha-cal-dot/.test(comp));

		// ── 「强提醒」设置页的两个静态事实（2026-10-25 二次定稿）──────────────
		check("未展示的行：强提醒复选框 disabled（置灰且不参与）",
			/disabled:\s*!shownNow\(g\)/.test(comp));
		check("取消最后一个勾**不再**被拒绝（旧实现的那句提示已删掉）",
			comp.indexOf("至少留一条") < 0 && comp.indexOf("要全部关掉请把") < 0);
		check("「全部提醒」写的是**展示中的 id 列表**，不再是空数组（空 = 一个都不提醒了）",
			/allEntries\.filter\(\(g\) => shownNow\(g\)\)\.map\(\(g\) => g\.id\)/.test(comp));
	}
}
