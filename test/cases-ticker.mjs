// test/cases-ticker.mjs —— 侧栏轮播（2026-10-25 晚：按钮单行翻页；同日三次定稿：设置页拆成「开关 + 范围」）
//                        （2026-10-25 定稿：轮播**只有全局开关 + 范围、不分游戏**；
//                          游戏列表里那一列是「提醒」，给「到期提醒（送达）」预留；2026-10-26 起整列暂时隐藏）
//
// 功能范围（用户定）：侧栏按钮「单行轮播」+「提前 N 小时」设置。**不含逐游戏筛选**。
// 不做系统通知、不做弹窗/声音、不动刷新链路、不动缓存载荷结构。
//
// 本文件守九件事：
//   ① 判定口径（纯函数 `isExpiringSoon`，60-helpers.js）：
//      某侧"即将到期" = 该侧**已开始**（startTs <= now）且 **endTs 落在 (now, now + N 小时]**。
//   ② 方向判定（纯函数 `dueKindOf`）：⚠️ 2026-10-28 起**开始方向暂时停用** —— 解析器只产出
//      "覆盖当前时刻"的窗口（startTs 永远 <= now），所以"即将开始"在真实数据里永远不命中。
//      现在只会返回 "" / "end"。"start" 的判定代码仍留在 60-helpers.js（注释写了怎么恢复），
//      这里只守"还没开始 ⇒ \"\"" 这一条（label 里带「暂时停用」，恢复时按名字找得到）。
//   ③ 「提醒」逐游戏白名单的语义（纯函数 `remindGameAllowed`）——⚠️ 这是**给未来的「到期提醒
//      （送达）」预留的**，**轮播不读它**：**普通列表**，列表里有谁就提醒谁，**空数组 = 一个都不提醒**。
//      ⚠️ 2026-10-26 起设置页那一列**暂时隐藏**（`SHOW_REMIND_COLUMN = false`，送达未实现）；
//        配置键 / schema / CONFIG_KEYS / 纯函数都保留，这里同步守"隐藏时五处入口全部不可见"。
//      + **守卫**：`DEFAULT_SETTINGS.remindGames`（及 src/index.js 的 schema default）
//        必须恰好等于所有 `defaultHidden !== true` 的来源 id —— 新增来源/改默认隐藏时要同步。
//      + **反向守卫**：轮播链路（`tickerItemsOf` / `tickerPickOf` / 渲染层 memo）**不得**读这份列表，
//        也不得再接受"逐游戏筛选"参数 —— 用户 2026-10-25 明确纠正过这一点。
//   ④ 轮播条目选取与**每格结构**（纯函数 `tickerPickOf` / `tickerCaptionOf` / `tickerSlidesOf`）：
//      多条时顺序稳定（按"距离那一刻还有多远"升序，同刻保持输入顺序）、无可轮播条目时返回空
//      （⇒ 按钮只有状态 0、不滚动）；C 方案每格 = { gameId, gameIcon, itemName, statusText }
//      （事项名优先、状态单独一段、**分隔符 " · " 两侧都有空格**）。
//   ⑤ 清单层（`tickerItemsOf`，80-components.js）：落盘的「源站墙钟文本 + tz」要能换算出**绝对**窗口
//      —— 这一层必须与运行环境时区无关（CI 跑 UTC、开发机跑 +08，两边都要绿）。
//      做法：断言 dueWindowOf 的 ts 等于 `sourceInstant(...)` 的独立算法结果，不写死本机偏移。
//   ⑥ 样式静态守卫：按钮尺寸不许被撑开 / 动画只许一次性 backwards / 70-styles.js 模板字符串完整。
//   ⑦ 设置页**两个控件**（2026-10-25 三次定稿）：开关 `tickerOn`（默认 **开**）+ 范围
//      `tickerHours`（12/24/48/72，默认 **72**，**没有「关闭」档位**）；关掉开关 ⇒ 清单为空。
//   ⑧ 轮播的**交叉序列**与**翻页方向**（同日三次定稿 + 四次定稿修正）：
//      `tickerStepsOf` 展开成 [idle, 1, idle, 2, …]（长度 2n；n=0 只有 idle）；
//      方向按**切换次数**四步一循环 up,down,down,up（idx 0 = 挂载兜底 down），
//      且**类名 = 视觉方向**（.is-up = 新内容从下方进 / .is-down = 新内容从上方进）。
//   ⑨ 翻页层的**两行顺序** + **落定**（同日五次、六次定稿）：up ⇒ [prev, cur]、down ⇒ [cur, prev]
//      （纯函数 `tickerFlipLinesOf`）；动画播完只渲染 cur 一行（`tickerFlipRenderLinesOf`）。
//
// ⚠️ 时刻全部显式传入（`now` 是参数，不是 Date.now()），所以本文件不随跑测那天漂移。
// ⚠️ 「今天 / 明天 / N 天后」用的是**本机日历日**（tickerDayWord），所以期望值也必须按本机日历日现造
//    （`localNoonPlusDays`：本机"今天 + k 天"的正午）—— 写死小时偏移（+8h/+30h/+50h）只在
//    UTC~+08 那段时区成立，TZ=America/Los_Angeles 下会假红（2026-10-28 修）。

import { check, section } from "./harness.mjs";
import { T } from "./load.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

export default async function run() {
	section("侧栏轮播（单行翻页 + 「提前 N 小时」）");
	const {
		isExpiringSoon, expiringSoonOf,
		dueKindOf, remindGameAllowed, tickerOnOf, tickerRangeOf, tickerPickOf, tickerCaptionOf, tickerSlidesOf,
		tickerStepsOf, tickerDirAt, tickerFlipLinesOf, tickerFlipRenderLinesOf,
		dueWindowOf, tickerItemsOf, sourceInstant, DEFAULT_SETTINGS, SOURCES
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
		//    算不出来就是算不出来 —— 绝不拿半个窗口凑一个"快到期"
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

	// ── ② 方向判定（dueKindOf）：**只剩结束方向** —— 开始方向 2026-10-28 起暂时停用 ──────────
	// 新事实（见 60-helpers.js 里 dueKindOf 的注释）：解析器只产出"覆盖当前时刻"的窗口 ⇒ startTs
	// 永远 <= now ⇒ "即将开始"永远不会命中。dueKindOf 现在只返回 "" / "end"。
	// 原来"未来窗口 ⇒ start"的三条断言（还没开始 / 阈值右端 / startTs == now + N）已按新事实删除；
	// 恢复开始方向时把它们加回来，并把下面的「暂时停用」守卫反过来写成"未来窗口 ⇒ start"。
	{
		// 结束方向
		check("结束方向：已开始 + 3 小时后结束 + N=24 → \"end\"",
			dueKindOf(NOW - 1 * H, NOW + 3 * H, NOW, 24) === "end");
		check("结束方向：threshold 边界 endTs == now + N → \"end\"；再晚 1ms → \"\"",
			dueKindOf(NOW - 1 * H, NOW + 24 * H, NOW, 24) === "end"
			&& dueKindOf(NOW - 1 * H, NOW + 24 * H + 1, NOW, 24) === "");
		// startTs == now 属于"已开始"（left 端闭）—— 这条只守边界，与另一个方向无关。
		check("结束方向：startTs == now（刚起步那一刻）仍算「已开始」⇒ \"end\"（左端闭）",
			dueKindOf(NOW, NOW + 2 * H, NOW, 24) === "end");
		// ⚠️ 开始方向**暂时停用**（数据源不提供未来档期）：还没开始就一律不算 —— 哪怕 1ms 后就开始。
		// 这条是"停用"的守卫：旧实现下 NOW+1 那个窗口会命中 "start"，现在必须是 ""。
		check("开始方向**暂时停用**（数据源不提供未来档期）：还没开始 + 3 小时后开始 N=24 → \"\"；startTs = now + 1ms（很接近开始）→ 也 \"\"；N=48 也一样",
			dueKindOf(NOW + 3 * H, NOW + 7 * H, NOW, 24) === ""
			&& dueKindOf(NOW + 1, NOW + 2 * H, NOW, 24) === ""
			&& dueKindOf(NOW + 24 * H, NOW + 30 * H, NOW, 48) === "");
		// 不算的情况
		check("不算：已结束 / 还太远（开始和结束都在窗外）/ 关闭 / 脏数据 / 结束早于开始",
			dueKindOf(NOW - 5 * H, NOW - 1 * H, NOW, 24) === ""
			&& dueKindOf(NOW + 30 * H, NOW + 40 * H, NOW, 24) === ""
			&& dueKindOf(NOW - 1 * H, NOW + 3 * H, NOW, 0) === ""
			&& dueKindOf(NOW - 1 * H, NOW + 3 * H, NOW, null) === ""
			&& dueKindOf(void 0, NOW + 3 * H, NOW, 24) === ""
			&& dueKindOf(NOW - 1 * H, void 0, NOW, 24) === ""
			&& dueKindOf(NaN, NaN, NOW, 24) === ""
			&& dueKindOf(NOW + 3 * H, NOW + 1 * H, NOW, 24) === "");  // 脏数据：结束早于开始
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

	// ── ④ 「提醒」白名单语义（remindGameAllowed）：**给未来的到期送达预留**，轮播不读它 ─────
	// 2026-10-25 定稿（用户纠正）：游戏列表里那一列 = 「提醒」，是**主动送达**的逐游戏钩子，
	// **不是轮播的一部分**。送达功能尚未实现 ⇒ 现在只有设置页读写（2026-10-26 起那一列**暂时隐藏**，
	// 见 ⑧ 之前的静态守卫），轮播链路一律不碰它。
	// 判定仍是普通列表（空 = 一个都不提醒），与原来的语义一字不差 —— 只是**归属改了**。
	{
		check("remindGames 为空数组 → **一个都不提醒**（不再有「空 = 全部」的哨兵）",
			remindGameAllowed("g1", []) === false && remindGameAllowed("随便什么", []) === false);
		check("remindGames 缺失 / 不是数组 → 也不提醒（纯函数不猜「没设置过」，默认值由 DEFAULT_SETTINGS/schema 给）",
			remindGameAllowed("g1", void 0) === false
			&& remindGameAllowed("g1", null) === false
			&& remindGameAllowed("g1", "g1") === false);
		check("remindGames 非空 → **只有列表里的提醒**（[\"a\"] 只提醒 a）",
			remindGameAllowed("a", ["a"]) === true
			&& remindGameAllowed("b", ["a"]) === false
			&& remindGameAllowed("a", ["b", "c"]) === false);

		// ── 守卫：出厂默认提醒白名单 == 出厂时「展示中」的来源（defaultHidden !== true）──────────
		// 它钉住两件事（这是"开箱即用"从哨兵手里接过来的保证）：
		//   ① 新增来源时白名单必须同步（忘了改默认列表就红）；
		//   ② 改某个条目的 defaultHidden 时白名单必须同步。
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
		check("默认 remindGames 非空（否则将来接上送达时开箱即用就是空的）", defIds.length > 0, String(defIds.length));

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

	// ── ⑤ 轮播条目选取（tickerPickOf）：顺序稳定 + 无命中→空 + **不受逐游戏列表影响** ──────
	// 候选契约与 80-components.js 的 tickerItemsOf 组装出来的完全一致
	// （{ key, gameId, side, name, title, gameIcon, startTs, endTs }）；这里刻意**绕开**文本换算，
	// 直接喂绝对时刻 —— 选取/排序/筛选这一层本身就是纯的。
	// ⚠️ 2026-10-25 定稿：签名**只有三个参数**（items, now, hours）—— 逐游戏列表那个参数已删除。
	// 用户明确纠正过：轮播 = 全局开关 + 范围，**不分游戏**；逐游戏列表属于「到期提醒（送达）」。
	{
		// ⚠️ 2026-10-28：候选全部改成**已开始**的窗口（开始方向暂时停用，未来窗口不再进清单）。
		// 排序 / 同刻稳定 / 白名单无关这三类断言与方向无关，所以用 end 方向的窗口照样钉得住。
		const cand = [
			{ key: "a:gacha", gameId: "a", side: "gacha", name: "甲", title: "池甲", startTs: NOW - 1 * H, endTs: NOW + 3 * H },   // end，3h 后
			{ key: "b:gacha", gameId: "b", side: "gacha", name: "乙", title: "池乙", startTs: NOW - 1 * H, endTs: NOW + 5 * H },   // end，5h 后
			{ key: "c:event", gameId: "c", side: "event", name: "丙", title: "活动丙", startTs: NOW - 2 * H, endTs: NOW + 1 * H }, // end，1h 后
			{ key: "d:event", gameId: "d", side: "event", name: "丁", title: "活动丁", startTs: NOW - 2 * H, endTs: NOW + 30 * H }  // end 30h > 24 → 不算
		];
		// 用户在设置里可能这么勾「提醒」（只勾了 a）—— 轮播**看不见**这份列表。
		const REMIND_ONLY_A = ["a"];
		const pick = tickerPickOf(cand, NOW, 24);
		check("选取：只留下 24 小时内的 3 条（按紧迫度排）",
			pick.map((x) => x.key).join(",") === "c:event,a:gacha,b:gacha", pick.map((x) => x.key).join(","));
		check("选取：每条都带上方向 kind（只剩 end 方向）与 dueMs",
			pick.every((x) => x.kind === "end")
			&& pick[0].dueMs === 1 * H && pick[1].dueMs === 3 * H && pick[2].dueMs === 5 * H,
			JSON.stringify(pick.map((x) => [x.key, x.kind, x.dueMs])));
		// ⚠️ 开始方向**暂时停用**（数据源不提供未来档期）：还没开始的候选一条都不进清单。
		check("选取：**还没开始**的候选不进清单（开始方向暂时停用：数据源不提供未来档期）",
			tickerPickOf([
				{ key: "f:gacha", gameId: "f", side: "gacha", name: "己", title: "池己", startTs: NOW + 1 * H, endTs: NOW + 3 * H }
			], NOW, 24).length === 0);
		check("选取：叫两遍结果完全一致（顺序稳定、无随机成分）",
			tickerPickOf(cand, NOW, 24).map((x) => x.key).join(",")
			=== tickerPickOf(cand, NOW, 24).map((x) => x.key).join(","));
		// 同一毫秒的多条：保持**输入顺序**（不是按名字/按 id 再排一次）
		{
			const tie = [
				{ key: "x", gameId: "x", side: "gacha", name: "X", startTs: NOW - 2 * H, endTs: NOW + 2 * H },
				{ key: "y", gameId: "y", side: "gacha", name: "Y", startTs: NOW - 1 * H, endTs: NOW + 2 * H }
			];
			check("选取：同一紧迫度时保持输入顺序（x 在 y 前）",
				tickerPickOf(tie, NOW, 24).map((x) => x.key).join(",") === "x,y",
				tickerPickOf(tie, NOW, 24).map((x) => x.key).join(","));
		}
		// ── 反向守卫：轮播**不读**逐游戏列表 ────────────────────────────────────────
		// 行为级证据（不只靠源码正则）：把白名单当第 4 个实参硬塞进去 —— JS 会**静默忽略**
		// 多余的实参，所以结果必须与"不传"时一字不差（a 与 b 都在，c 也在）。
		check("选取签名只有 3 个参数（items, now, hours）——没有第 4 个「逐游戏列表」",
			tickerPickOf.length === 3, String(tickerPickOf.length));
		check("轮播**不受逐游戏列表影响**：白名单只含 a，硬塞第 4 个参数也照样轮到 b 与 c",
			tickerPickOf(cand, NOW, 24, REMIND_ONLY_A).map((x) => x.key).join(",") === "c:event,a:gacha,b:gacha",
			tickerPickOf(cand, NOW, 24, REMIND_ONLY_A).map((x) => x.key).join(","));
		// 没有可轮播的条目 → 空（⇒ 按钮只有状态 0，不滚动）
		check("选取：没有任何命中 → 空数组（⇒ 不滚动）",
			tickerPickOf([], NOW, 24).length === 0
			&& tickerPickOf(cand, NOW, 0).length === 0);       // 关闭（N<=0 短路）
		check("选取：脏输入不抛（null / 非数组 / 数组里夹 null / N=0）",
			tickerPickOf(null, NOW, 24).length === 0
			&& tickerPickOf(cand, NOW, 0).length === 0
			&& tickerPickOf([null, void 0, 1], NOW, 24).length === 0);
	}

	// ── ⑥ 轮播文案与**每格结构**（tickerCaptionOf / tickerSlidesOf，C 方案）──────────
	// 2026-10-25 二次定稿（用户 C 方案）：
	//   · 文字优先显示**事项名**（banner/event 名 = 那一期的角色/活动名）—— 只有游戏名时
	//     "哪个池子/哪个活动"根本看不出来；游戏身份交给**图标**（gameIcon）。
	//   · 再加一条硬要求：分隔符**前后都要有空格**（上一版渲染成「少女· 还剩」，少一个空格）。
	{
		const endItem = { key: "k", gameId: "k", side: "gacha", name: "绝区零", title: "耀嘉音", startTs: NOW - 2 * H, endTs: NOW + 3 * H, kind: "end" };
		const capEnd = tickerCaptionOf(endItem, NOW);
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
			&& tickerCaptionOf({ ...endItem, endTs: NOW + 45 * 60000 }, NOW).text.indexOf(" · ") > 0,
			JSON.stringify(capEnd.text));
		check("文案·结束：没有事项名时回退到游戏名（自定义条目可能没有 title）",
			tickerCaptionOf({ ...endItem, title: "" }, NOW).name === "绝区零"
			&& tickerCaptionOf({ ...endItem, title: "", name: "" }, NOW).name === "k");
		check("文案·结束：不足 1 小时按分钟说（45 分）",
			tickerCaptionOf({ ...endItem, endTs: NOW + 45 * 60000 }, NOW).status === "45 分");
		check("文案·结束：≥1 天**只说天数**（30 小时 → 1 天，小时段丢掉）",
			tickerCaptionOf({ ...endItem, endTs: NOW + 30 * H }, NOW).status === "1 天");
		check("文案·结束：1 天 17 时 → 1 天（丢掉 17 时，不四舍五入到 2 天）",
			tickerCaptionOf({ ...endItem, endTs: NOW + 41 * H }, NOW).status === "1 天");
		check("文案·结束：24 天 10 时 → 24 天（天数不封顶、也不带小时）",
			tickerCaptionOf({ ...endItem, endTs: NOW + (24 * 24 + 10) * H }, NOW).status === "24 天");
		check("文案·结束：向下取整（3 小时 59 分 → 3 小时，不虚报）",
			tickerCaptionOf({ ...endItem, endTs: NOW + 3 * H + 59 * 60000 }, NOW).status === "3 小时");

		// 开始方向：今天 / 明天 / N 天后。
		// ⚠️ 2026-10-28 修（三处"只在某些时区红"）：原来用固定的 +8h / +30h / +50h 偏移，
		// 只有本机时区落在 UTC~+08 那段时才恰好是 今天 / 明天 / 2 天后 —— TZ=America/Los_Angeles
		// 下 NOW 是本地 10-24 21:00，NOW+8h 已是本地 10-25 05:00 ⇒ 期望「今天」实得「明天」。
		// 产品口径本来就是**本机日历日**（tickerDayWord），所以期望值也按本机日历日造：
		// startTs = 本机"今天 + k 天"的正午，期望值就是 k 的读数，任何时区同一串。
		// 取正午不取 00:00 —— DST 在半夜跳变的那一天，本地 00:00 可能不存在/出现两次。
		const localNoonPlusDays = (baseTs, k) => {
			const d = new Date(baseTs);
			return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, 12, 0, 0, 0).getTime();
		};
		const gachaStart = (startTs) => ({ key: "k", gameId: "k", side: "gacha", name: "星塔旅人", title: "限定寻访", startTs, endTs: startTs + 10 * H, kind: "start" });
		check("文案·开始（卡池）：今天开工 → `限定寻访 · 今天开池`",
			tickerCaptionOf(gachaStart(localNoonPlusDays(NOW, 0)), NOW).text === "限定寻访 · 今天开池",
			tickerCaptionOf(gachaStart(localNoonPlusDays(NOW, 0)), NOW).text);
		check("文案·开始（卡池）：明天 → `限定寻访 · 明天开池`",
			tickerCaptionOf(gachaStart(localNoonPlusDays(NOW, 1)), NOW).text === "限定寻访 · 明天开池",
			tickerCaptionOf(gachaStart(localNoonPlusDays(NOW, 1)), NOW).text);
		check("文案·开始（卡池）：2 天后 → `限定寻访 · 2 天后开池`",
			tickerCaptionOf(gachaStart(localNoonPlusDays(NOW, 2)), NOW).text === "限定寻访 · 2 天后开池",
			tickerCaptionOf(gachaStart(localNoonPlusDays(NOW, 2)), NOW).text);
		check("文案·开始（活动）：活动侧说「开始」而不是「开池」",
			tickerCaptionOf({ ...gachaStart(localNoonPlusDays(NOW, 1)), side: "event" }, NOW).status === "明天开始");
		check("文案：缺 name/title → 兜底「某个游戏」（不抛、也不显示 undefined）",
			tickerCaptionOf({ kind: "end", endTs: NOW + H }, NOW).name === "某个游戏"
			&& tickerCaptionOf(null, NOW).text.indexOf("undefined") < 0);

		// —— C 方案的**每格结构**：{ gameId, gameIcon, itemName, statusText } ——
		// 渲染层（80-components.js）只认这一种形状；状态 0（原按钮外观）**不在**这里 ——
		// 所以"无可轮播 ⇒ 只有状态 0、不滚动"在数据层就是"slides 为空"。
		const due = [
			{ key: "a:gacha", id: "a", gameId: "a", side: "gacha", name: "绝区零", title: "耀嘉音", gameIcon: "https://cdn.example/a.png", startTs: NOW - 2 * H, endTs: NOW + 3 * H, kind: "end", dueMs: 3 * H },
			// ⚠️ 同一类假红的邻居：这里原来写 `startTs: NOW + 1 * H`（期望「今天」）—— 只在
			// 本地时间不在 23 点那一格时成立（TZ=America/Chicago 下 NOW 是本地 23:00，+1h 就跨日）。
			// 同上改成"本机今天正午"，与 ⑥ 的日词口径一致。
			{ key: "c:event", id: "c", gameId: "c", side: "event", name: "星塔旅人", title: "「养成奖励」碎片追加活动", gameIcon: "https://cdn.example/c.png", startTs: localNoonPlusDays(NOW, 0), endTs: localNoonPlusDays(NOW, 0) + 2 * H, kind: "start", dueMs: 1 * H }
		];
		const slides = tickerSlidesOf(due, NOW);
		check("每格结构：一条轮播条目一格（2 条 → 2 格）", slides.length === 2, String(slides.length));
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
			tickerSlidesOf([{ key: "z", gameId: "z", name: "某游", title: "某池", startTs: NOW - H, endTs: NOW + H, kind: "end" }], NOW)[0].gameIcon === "");
		check("每格结构：无可轮播 → 空数组（⇒ 只有状态 0、不滚动）",
			tickerSlidesOf([], NOW).length === 0 && tickerSlidesOf(null, NOW).length === 0);
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
				// 还没开始：源站 10-25 15:00（= 06:00Z = now + 2h）→ 开始方向**暂时停用**后不进清单
				//（原来是"双向"判定里那条 kind=start 的条目，现在只作为"未开始不进清单"的反例）
				banner: "池乙", bannerDates: "10-25 15:00 ~ 10-25 20:00",
				// 25 小时后结束：源站 10-26 14:00（= 10-26T05:00Z = now + 25h）→ N=24 不算、N=48 算
				event: "活动乙", eventDates: "10-25 10:00 ~ 10-26 14:00"
			},
			{
				id: "g3", name: "游戏丙", tz,
				// 源站原文读不出绝对档期（"版本更新后 ~ …"）→ 不参与轮播，不硬凑
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
			const w = dueWindowOf(games[0], true, now);
			const start = sourceInstant(2026, 10, 24, 20, 0, tz);
			const end = sourceInstant(2026, 10, 25, 14, 0, tz);
			check("文本 + tz → 绝对窗口（与 sourceInstant 独立算法一致）",
				!!w && w.startTs === start && w.endTs === end,
				JSON.stringify([w && w.startTs, start, w && w.endTs, end]));
			check("绝对窗口确实落在 now 的两侧（前置条件：这条真的「已开始、1 小时后结束」）",
				!!w && w.startTs < NOW && w.endTs === NOW + 1 * H);
			// 卡池侧带 startTs/endTs 时优先用它们（不经过文本）
			const w2 = dueWindowOf(games[4], true, now);
			check("卡池侧有 startTs/endTs → 直接采用（与文本换算同一条链，结果相等）",
				!!w2 && w2.startTs === NOW - 1 * H && w2.endTs === NOW + 2 * H);
			check("读不出绝对档期的一律 null（源站原文 / 缺 tz / 缺内容）",
				dueWindowOf(games[2], true, now) === null
				&& dueWindowOf(games[3], true, now) === null
				&& dueWindowOf({ banner: "", bannerDates: "" }, true, now) === null
				&& dueWindowOf(null, true, now) === null);
		}

		// 清单（N=24，**只剩结束方向**）：g1 卡池 + g1 活动（都在 1h 后结束）+ g4 卡池（2h 后结束）
		//   ⚠️ 2026-10-28：g2 卡池（2h 后**才开始**）不再进清单 —— 开始方向暂时停用（数据源不提供
		//      未来档期），原来"双向"时它是以 kind=start 进来的那条。
		//   g2 活动 25h 后才结束 → N=24 不算；g3/custom 读不出绝对档期 → 不参与
		// ⚠️ 清单层**没有**逐游戏参数（2026-10-25 定稿）：内容 = 传进来的所有 games 的条目，
		//    只按 N 小时范围筛。调用方（渲染层）保证 games 全是"展示中"的条目。
		{
			const due = tickerItemsOf(games, now, 24);
			check("N=24 的轮播清单 = 3 条（只剩 end 方向：g1 两侧 + g4 卡池）",
				due.length === 3, JSON.stringify(due.map((x) => x.key)));
			check("清单按紧迫度升序（1h 的两条 → 2h 的那条；同刻保持输入顺序）",
				due.map((x) => x.key).join(",") === "g1:gacha,g1:event,g4:gacha",
				due.map((x) => x.key).join(","));
			check("清单带方向：全部是 end（g2 卡池没开始 ⇒ 不进清单）",
				due.every((x) => x.kind === "end"),
				JSON.stringify(due.map((x) => [x.key, x.kind])));
			check("清单带游戏名与到期标题（按钮悬停用）",
				due[0].name === "游戏甲" && due[0].title === "角色甲", JSON.stringify([due[0].name, due[0].title]));
			check("清单带上**该条目自己的图标**（C 方案：轮播那一格用它，没配就是空串）",
				due.some((x) => x.key === "g4:gacha" && x.gameIcon === "https://cdn.example/g4.png")
				&& due.filter((x) => x.key !== "g4:gacha").every((x) => x.gameIcon === ""),
				JSON.stringify(due.map((x) => [x.key, x.gameIcon])));
			check("清单带的图标能一路进到轮播那一格（tickerSlidesOf 的 gameIcon）",
				tickerSlidesOf(due, now.getTime()).some((s) => s.gameId === "g4" && s.gameIcon === "https://cdn.example/g4.png"));
			// ⚠️ 开始方向**暂时停用**（数据源不提供未来档期）：还没开始的侧一条都不进清单。
			check("**还没开始**的侧（g2 卡池，2 小时后才开始）不进清单（开始方向暂时停用：数据源不提供未来档期）",
				!due.some((x) => x.key === "g2:gacha"),
				JSON.stringify(due.map((x) => x.key)));
			check("25 小时后结束的侧（g2 活动）N=24 不在、N=48 才在",
				!tickerItemsOf(games, now, 24).some((x) => x.key === "g2:event")
				&& tickerItemsOf(games, now, 48).some((x) => x.key === "g2:event"));
			check("N=48 → 4 条（g2 活动在 25h 后的 end 也进来了；g2 卡池仍不进）",
				tickerItemsOf(games, now, 48).length === 4
				&& !tickerItemsOf(games, now, 48).some((x) => x.key === "g2:gacha"));
		}

		// ── 反向守卫：清单层**不读**逐游戏列表（2026-10-25 定稿）────────────────────────
		// 用户口径：轮播只按 tickerOn（调用方短路）+ tickerHours 筛，**内容 = 所有展示中游戏的条目**。
		// 证据用"行为 + 签名"两条钉：
		//   ① 签名只有 3 个参数；② 白名单硬塞成第 4 个实参（JS 静默忽略）结果必须一字不差。
		check("清单层签名只有 3 个参数（games, now, hours）——没有第 4 个「逐游戏列表」",
			tickerItemsOf.length === 3, String(tickerItemsOf.length));
		check("清单层：白名单只含 g1，硬塞第 4 个参数也照样有 g1 之外（g4）的条目（轮播不受它影响）",
			tickerItemsOf(games, now, 24, ["g1"]).map((x) => x.key).join(",") === "g1:gacha,g1:event,g4:gacha",
			tickerItemsOf(games, now, 24, ["g1"]).map((x) => x.key).join(","));
		check("清单层：传**空数组**当白名单也不影响（旧语义里「空 = 一条都不轮播」已被废除）",
			tickerItemsOf(games, now, 24, []).length === 3,
			String(tickerItemsOf(games, now, 24, []).length));

		// 关闭 = 空清单（按钮不滚动），且不再换算
		check("N=0（关闭）→ 空清单（按钮不滚动）",
			tickerItemsOf(games, now, 0).length === 0
			&& tickerItemsOf(games, now, -1).length === 0);
		check("N=12 → 3 条都在 12 小时内（1h/1h/2h）",
			tickerItemsOf(games, now, 12).length === 3);
		check("脏输入不抛：games 非数组 / now 缺失 → 空清单",
			tickerItemsOf(null, now, 24).length === 0
			&& tickerItemsOf(games, null, 24).length === 0);
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
			comp.includes('" \\u00B7 " + slide.statusText'), "见 80-components.js 的 tickerLine");
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
		// 动画：一次性；基础规则（没有方向类时的兜底）按 **down** 走 backwards。
		// 2026-10-25 五次定稿后 fill-mode **按方向各用一套**：down = backwards(+1ms)、up = forwards
		// （up 的终点必须停在 -50%，否则收尾弹回 0 会露出 prev）。所以下面两条只守**基础规则**，
		// 每个方向的 fill-mode 由后面两条专门的断言钉死。
		check("基础规则 .gacha-cal-btn-flip 用 animation-fill-mode: backwards（无方向类时的兜底 = down）",
			/\.gacha-cal-btn-flip\{[^}]*animation:gacha-cal-btn-flip-down[^;}]*\bbackwards\b/.test(styles));
		check("基础规则的 fill-mode **不是** both / forwards（兜底方向不留持久层）",
			!/\.gacha-cal-btn-flip\{[^}]*animation:[^;}]*\b(?:both|forwards)\b/.test(styles));
		// 方向语义（2026-10-25 五次定稿）：**类名 = 视觉方向**，且**行顺序 + keyframes + fill-mode 成套**。
		// 窗口 22px / 翻页层 44px（两行各 22px）⇒ translateY(±50%) = ±22px 正好一行。
		// 两种方向的共同点：**起点时 prev 占满窗口**（旧内容先占住窗口 ⇒ 不空白）：
		//   · .is-up   ⇒ 层序 [prev, cur] + keyframes 0 → -50% + forwards：起点 ty=0 ⇒ prev 占满 [0,22]，
		//                终点 -22px ⇒ cur 占满窗口；
		//   · .is-down ⇒ 层序 [cur, prev] + keyframes -50% → 0 + backwards：起点 ty=-22px ⇒
		//                cur 在窗口上方、prev 占满窗口；终点 0 ⇒ cur 占满窗口。
		// 旧版（四次定稿）两种方向都写死 [cur, prev]，向上翻的 from 是 +50% ⇒ 起点时**两层都在窗口
		// 下方** ⇒ 一开场空白 30~60ms，再让新行从上方滑进来（用户 2026-10-25「还是不对，和向下翻的
		// 动画不一样」的根因）。以下断言把新事实钉死：既钉 keyframes 的起止，也钉 fill-mode 的归属。
		check(".is-up 的 keyframes 是 0 → -50%（整层往上走：prev 滑出、cur 从下方进）",
			/@keyframes gacha-cal-btn-flip\{from\{transform:translateY\(0\)\}to\{transform:translateY\(-50%\)\}\}/.test(styles));
		check(".is-down 的 keyframes 是 -50% → 0（整层往下走：prev 往下滑出、cur 从上方进）",
			/@keyframes gacha-cal-btn-flip-down\{from\{transform:translateY\(-50%\)\}to\{transform:translateY\(0\)\}\}/.test(styles));
		// 类名 → keyframes 的映射也必须钉死：只对 keyframes 断言的话，两条规则名互换仍能通过。
		check("类名映射：.is-up 用 gacha-cal-btn-flip（0→-50%）、.is-down 用 gacha-cal-btn-flip-down（-50%→0）",
			/\.gacha-cal-btn-flip\.is-up\{animation:gacha-cal-btn-flip /.test(styles)
			&& /\.gacha-cal-btn-flip\.is-down\{animation:gacha-cal-btn-flip-down /.test(styles));
		// fill-mode 的归属（新增，五次定稿）：up = forwards（终点必须停在 -50%）；down = backwards(+1ms)
		check(".is-up 的 fill-mode 含 forwards（终点停在 -50%，让 cur 占满窗口；不带 1ms 延迟）",
			/\.gacha-cal-btn-flip\.is-up\{animation:gacha-cal-btn-flip \.42s cubic-bezier\(\.2,\.9,\.25,1\) forwards\}/.test(styles));
		check(".is-down 的 fill-mode 含 backwards + 1ms 延迟（起点状态首帧即生效，防重挂载闪跳）",
			/\.gacha-cal-btn-flip\.is-down\{animation:gacha-cal-btn-flip-down \.42s cubic-bezier\(\.2,\.9,\.25,1\) 1ms backwards\}/.test(styles));
		// 两条方向规则：时长 0.42s、同一条 easing 一字不差；fill-mode 各按方向（up=forwards / down=backwards）；
		// 且不许夹带 transform/filter/...（动画只在 keyframes 里）。
		// ⚠️ 取规则时把 reduce 媒体查询里那条 `.is-down{animation:none}` 排除掉（它也是同一个选择器）。
		const dirRules = [...styles.matchAll(/\.gacha-cal-btn-flip\.is-(?:up|down)\{([^}]*)\}/g)]
			.map((m) => m[1])
			.filter((r) => !/animation:\s*none/.test(r));
		check("两条方向规则都在（.gacha-cal-btn-flip.is-up / .is-down）", dirRules.length === 2, String(dirRules.length));
		check("方向规则只换 keyframes 名与 fill-mode：时长 .42s + cubic-bezier(.2,.9,.25,1) 一个不改",
			dirRules.every((r) => /animation:gacha-cal-btn-flip(?:-down)? \.42s cubic-bezier\(\.2,\.9,\.25,1\) (?:1ms )?(?:backwards|forwards)/.test(r)),
			dirRules.join(" | "));
		check("方向规则里没有 transform / filter / contain / will-change（动画只在 keyframes 里）",
			dirRules.every((r) => !/transform|will-change|filter|contain|perspective/.test(r)),
			dirRules.filter((r) => /transform|will-change|filter|contain|perspective/.test(r)).join(" | "));
		check("prefers-reduced-motion：reduce 时动画置 none（完全不滚动）",
			/@media \(prefers-reduced-motion:reduce\)\{\.gacha-cal-btn-flip,\.gacha-cal-btn-flip\.is-up,\.gacha-cal-btn-flip\.is-down\{animation:none\}\}/.test(styles));
		// reduce 这条必须把 is-down 也列进去：媒体查询不加特异性，只写基础类的话
		// .gacha-cal-btn-flip.is-down（两个类）会把 animation-name 抢回来 ⇒ reduce 时仍会翻页。
		check("reduce 媒体查询覆盖了两个方向类（否则 .is-down 会盖掉 animation:none）",
			/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.gacha-cal-btn-flip\.is-down\{animation:none\}/.test(styles));
		// 不可滚动的两种情形都在渲染层短路：没有轮播项 ⇒ 整段轮播都不渲染（只留状态 0）；
		// reduce ⇒ 轮播节拍暂停且静态钉在第 1 格。这两条都是"改错了不报错、真机才发现"的病。
		check("无可轮播时不渲染轮播（tickerSlides.length 为 0 ⇒ 按钮回到「图标 + 二文字」原样）",
			/tickerSlides\.length\s*\?/.test(comp) && /\(wide === false \|\| tickerSlides\.length === 0\) \? calIcon : null/.test(comp));
		check("轮播节拍：slides 为空 / reduce / 悬停 三种情况都暂停（useCycleSteps 的 paused）",
			/useCycleSteps\(tickerSteps\.length, TICKER_SLIDE_SECS,\s*\n?\s*tickerSlides\.length === 0 \|\| reduceMotion \|\| btnHover\)/.test(comp));
		check("轮播节拍数的是**展开后的格数**（tickerSteps.length = 2n），不再是 slides+1",
			tickerStepsOf([1, 2]).length === 4);
		check("渲染层用纯函数展开序列（tickerStepsOf(tickerSlides)），不自己拼交叉",
			/const tickerSteps = tickerStepsOf\(tickerSlides\);/.test(comp));
		check("reduce 时静态钉在第一条轮播条目（still 能看出有事）",
			/reduceMotion && tickerSlides\.length > 0 \? 1 : slideStep/.test(comp));
		// 方向类必须真的接到 DOM 上，而且**方向来源必须是"单调切换序"**（2026-10-25 四次定稿）。
		// 之前的实现是 `stepAt(shownStep).dir`：shownStep 是 useCycle 取模后的格号，回卷到格 0 时
		// 取到的是 tickerDirAt(0) 的挂载兜底 down ⇒ 四步循环每轮回卷丢一次相位，n=2 时第 4 次
		// 切换本该 up、实渲染 down（真机表现为"连着三次都往下"）。下面两条把新写法**和**旧写法
		// 一起钉住：新写法必须在、旧写法必须不在。
		check("渲染层按 **tickerDirAt(单调切换序)** 切 class（类名 = 视觉方向）",
			/className: "gacha-cal-btn-flip " \+ \(flipDir === "up" \? "is-up" : "is-down"\)/.test(comp));
		check("渲染层的方向**不再**从 shownStep 反推（回卷到格 0 会丢相位 ⇒ 四步循环失效）",
			!/className: "gacha-cal-btn-flip " \+ \(stepAt\(shownStep\)/.test(comp)
			&& /const flipDir = tickerDirAt\(/.test(comp));
		// 行顺序（2026-10-25 五次定稿，**新增**）：渲染层必须**按方向交换两行**，不许再写死 [cur, prev]。
		// 这是"向上翻开场空白"的根因 —— 只改 keyframes 不改顺序，up 的起点仍会两层都跑到窗口下方。
		// 六次定稿：行数组改由纯函数 tickerFlipRenderLinesOf 给（落定时只给 cur 一行），
		// 方向交换的规则仍原样委托给 tickerFlipLinesOf（本函数的非落定分支）。
		check("渲染层行数组来自纯函数 tickerFlipRenderLinesOf(方向, 格号, 上一格, 是否落定) → 逐行 renderLine",
			/const flipLines = tickerFlipRenderLinesOf\(reduceMotion \? "down" : flipDir, shownStep, prevStep, flipSettled\);/.test(comp)
			&& /children: flipLines\.map\(\(l\) => renderLine\(l\.step, l\.slot\)\)/.test(comp));
		check("渲染层**不再**写死 [cur, prev]（旧写法：向上翻时两层都被推到窗口下方 ⇒ 开场空白）",
			!/children: \[tickerLine\(shownStep, "cur"\), tickerLine\(prevStep, "prev"\)\]/.test(comp));
		check("reduce（animation:none）时强制 down 顺序 —— 否则 up 顺序的第 1 行 prev 会常驻窗口",
			/reduceMotion \? "down" : flipDir/.test(comp));
		check("useCycleSteps 的 seq **单调递增不取模**（方向的分母），step 才是取模后的格号",
			/setSeq\(\(v\) => v \+ 1\)/.test(comp)
			&& /return \{ step: count > 0 \? seq % count : 0, seq \};/.test(comp));
		check("useCycle 退化成 useCycleSteps(...).step 的薄包装（留白卡 / 近期分页行为不变）",
			/function useCycle\(count, seconds, paused\) \{\s*\n\s*return useCycleSteps\(count, seconds, paused\)\.step;\s*\n\s*\}/.test(comp));
		check("取格子的 stepAt 有越界兜底（prevStep 可能已不在新序列里，不能抛）",
			/const stepAt = \(step\) => tickerSteps\[step\] \|\| \{ idx: 0, idle: true, slideIndex: -1, dir: "down" \};/.test(comp));
		check("tickerLine 按 slideIndex 取轮播条目（不再是 idx-1 的下标算术）",
			/const at = stepAt\(idx\);/.test(comp) && /const slide = at\.slideIndex >= 0 \? tickerSlides\[at\.slideIndex\] : null;/.test(comp));
		// 祖先层**不许**出现 transform/filter/contain/will-change（浮层 .gacha-cal-sched-rest 依赖包含块）
		const btnRules = [...styles.matchAll(/\.gacha-cal-btn[a-z-]*\{([^}]*)\}/g)].map((m) => m[1]);
		check("能取到 .gacha-cal-btn* 的各条规则（守卫自身没瞎）", btnRules.length >= 5, String(btnRules.length));
		check("按钮/窗口/行/图标格子的规则里没有 transform / filter / contain / will-change（动画只在 .gacha-cal-btn-flip 的 keyframes 里）",
			btnRules.every((b) => !/transform|will-change|filter|contain|perspective/.test(b)),
			btnRules.filter((b) => /transform|will-change|filter|contain|perspective/.test(b)).join(" | "));
		// 接线：CSS 类名必须在渲染层真的用上（否则"样式写了但没人用"这种死代码不会报错）
		for (const cls of ["gacha-cal-btn-txt", "gacha-cal-btn-line", "gacha-cal-btn-ic", "gacha-cal-btn-nm", "gacha-cal-btn-st"]) {
			check(`渲染层用了 .${cls}（样式不是死代码）`, comp.includes(`"${cls}"`));
		}
		// 翻转层的 className 是**拼接**出来的（基础类 + 方向类），普通 includes 会漏，单独守：
		check("渲染层用了 .gacha-cal-btn-flip（基础类在拼接串里）",
			comp.includes('"gacha-cal-btn-flip "'));
		for (const dirCls of ["is-up", "is-down"]) {
			check(`渲染层用得上方向类 ${dirCls}（样式不是死代码）`,
				comp.includes(`"${dirCls}"`), dirCls);
		}
		check("红点在渲染层**只剩窄侧栏降级**这一处（宽侧栏一律走轮播）",
			(comp.match(/"gacha-cal-dot"/g) || []).length === 1
			&& /wide === false[\s\S]{0,400}?gacha-cal-dot/.test(comp));

		// ── 「提醒」列（设置页游戏列表）：2026-10-26 起**暂时隐藏**（送达功能未实现）──────────
		// 这一列是给「到期提醒（送达）」预留的逐游戏白名单（`remindGames`）。送达还没做 ⇒ 勾了没有效果，
		// 所以用常量 `SHOW_REMIND_COLUMN = false` 把整列藏起来（**不是删除**：配置键 / schema /
		// CONFIG_KEYS / 纯函数 remindGameAllowed / 写入链路都保留，送达实现时改回 true 就能直接接上）。
		// 静态守卫因此从"列头文案必须叫「提醒」"改成"**false 时五处入口全部不可见**"。
		check("常量开关 SHOW_REMIND_COLUMN = false（注释写明「暂时隐藏：送达功能未实现」）",
			/const SHOW_REMIND_COLUMN = false;/.test(comp) && comp.includes("暂时隐藏：送达功能未实现"));
		// 列头在源码里是 `\u` 转义（`children: "\u63D0\u9192"`），比对**转义文本**（双反斜杠）。
		check("表头「提醒」列标题在 SHOW_REMIND_COLUMN 之后（false ⇒ 这一格不渲染）",
			comp.includes('SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\\u63D0\\u9192" }) : null')
			&& !comp.includes('(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\\u63D0\\u9192" }),'));
		check("每行「提醒」复选框也在开关之后（disabled 语义原样保留，恢复后即生效）",
			comp.includes('SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("label", {')
			&& /disabled:\s*!shownNow\(g\)/.test(comp));
		check("「全部提醒」按钮也在开关之后（文案 / title / onClick 原样保留）",
			comp.includes('SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("button", {')
			&& comp.includes('children: "全部提醒"')
			&& comp.includes("把所有展示中的游戏都加入「提醒」白名单")
			&& comp.indexOf("全部轮播") < 0);
		check("「全部提醒」写的是**展示中的 id 列表**（空数组 = 一个都不提醒，语义没变）",
			/allEntries\.filter\(\(g\) => shownNow\(g\)\)\.map\(\(g\) => g\.id\)/.test(comp));
		// 2026-10-28（用户要求）：表头上方那行操作提示**整行删掉**，两个分支都不再渲染。
		// 反向断言：源码里这句话彻底不存在（不是"改成空串 / 藏起来"，是真删）。
		check("表头上方那行操作提示已删（「展示」控制显示… 两个分支都不再出现）",
			comp.indexOf("「展示」控制显示") < 0
			&& comp.indexOf("取色器换主题色") < 0
			&& comp.indexOf("「提醒」到点通知") < 0);
		check("网格列宽走单一常量 SETTINGS_GAME_GRID（表头与数据行同源），隐藏分支**少一格 28px**",
			(comp.match(/gridTemplateColumns: SETTINGS_GAME_GRID/g) || []).length === 2
			&& comp.includes('"minmax(0,1.15fr) 28px 28px minmax(0,1fr) minmax(0,1fr) 34px 88px"')
			&& comp.includes('"minmax(0,1.15fr) 28px minmax(0,1fr) minmax(0,1fr) 34px 88px"'));
		check("一键恢复不用重写逻辑：配置键与写入链路都还在（remindGames / setEntryRemind / resetRemindAll / remindGameAllowed）",
			comp.includes('commit("remindGames"') && comp.includes("setEntryRemind")
			&& comp.includes("resetRemindAll") && comp.includes("remindGameAllowed("));
		check("旧提示语没有回来（「至少留一条」那套拒绝逻辑仍不存在）",
			comp.indexOf("至少留一条") < 0 && comp.indexOf("要全部关掉请把") < 0
			&& comp.indexOf("提醒：到点主动通知（尚未实现，先做预留）") < 0
			&& comp.indexOf("控制侧栏轮播") < 0);
	}

	// ── ⑨ 设置页新控件：开关 tickerOn（默认开）+ 范围 tickerHours（默认 72）──────────
	// 2026-10-25 三次定稿（用户要求）：原来只有一个 tickerHours（关闭/12/24/48，0 = 关闭），
	// 现在拆成**两个控件** —— 开关（开不开）+ 范围（提前多久）。默认：开 / 72 小时。
	{
		check("默认 tickerOn = true（开箱即用就是开的）", DEFAULT_SETTINGS.tickerOn === true,
			String(DEFAULT_SETTINGS.tickerOn));
		check("默认 tickerHours = 72（范围默认改成 72 小时，不再是 24）", DEFAULT_SETTINGS.tickerHours === 72,
			String(DEFAULT_SETTINGS.tickerHours));
		// 总开关的读取口径：只有**明确的 false** 才算关（老配置里没有这个键 ⇒ 必须是开）。
		check("tickerOnOf：只有明确的 false 才算关（undefined / null / 0 / \"\" 都算开）",
			tickerOnOf(void 0) === true && tickerOnOf(null) === true && tickerOnOf(true) === true
			&& tickerOnOf(false) === false && tickerOnOf(0) === true && tickerOnOf("") === true);
		// 范围的读取口径：老配置里残留的 0（当年「关闭」）不能被当成"关" —— 关闭现在归开关。
		// 若这里回落到 0，设置页会显示「范围 72 小时」而按钮一声不响（最难查的两套口径）。
		check("tickerRangeOf：只接受正数小时；缺失 / 0 / 负数 / 非数字一律回落默认 72",
			tickerRangeOf(void 0) === 72 && tickerRangeOf(null) === 72 && tickerRangeOf(0) === 72
			&& tickerRangeOf(-1) === 72 && tickerRangeOf("") === 72 && tickerRangeOf("abc") === 72
			&& tickerRangeOf(NaN) === 72 && tickerRangeOf(12) === 12 && tickerRangeOf(48) === 48
			&& tickerRangeOf("24") === 24);
		check("tickerRangeOf 的兜底就是 DEFAULT_SETTINGS.tickerHours（不是写死另一个数）",
			tickerRangeOf(0) === DEFAULT_SETTINGS.tickerHours);

		// 关掉开关 ⇒ 轮播清单为空 ⇒ 展开序列只有 idle（不轮播）、窄侧栏也不出红点。
		// 这里把渲染层那条门（tickerOn ? due : []）在数据层复刻一遍；
		// 渲染层用的是同一个 tickerOnOf（静态守卫见下）。
		const onGames = [{ id: "s1", name: "开关测试", banner: "池", startTs: NOW - H, endTs: NOW + 2 * H }];
		const dueWhen = (on) => (tickerOnOf(on)
			? tickerItemsOf(onGames, now, DEFAULT_SETTINGS.tickerHours)
			: []);
		check("tickerOn=false ⇒ 轮播清单为空（⇒ 不轮播、也不出红点）", dueWhen(false).length === 0);
		check("tickerOn=true ⇒ 清单照旧（同一组数据、默认 72 小时范围下有内容）",
			dueWhen(true).length === 1, String(dueWhen(true).length));
		check("tickerOn=false ⇒ 展开序列只有 1 格 idle（不滚动）",
			tickerStepsOf(tickerSlidesOf(dueWhen(false), NOW)).length === 1);
		check("tickerOn=true ⇒ 展开序列是 2 格（idle + 那一条）",
			tickerStepsOf(tickerSlidesOf(dueWhen(true), NOW)).length === 2);

		// 渲染层真的接了开关（关掉时 memo 直接给空数组，不做任何换算）
		const compAll = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		check("渲染层：开关关掉时直接把清单算成空（tickerOn ? tickerItemsOf(games, now, tickerHours) : []）",
			/\(tickerOn\s*\n\s*\? tickerItemsOf\(games, now, tickerHours\)\s*\n\s*: \[\]\)/.test(compAll),
			"见 80-components.js 的 tickerItems memo");
		// ── 反向守卫：轮播 memo **不读**逐游戏列表 ──────────────────────────────
		// 2026-10-25 定稿（用户纠正）：轮播 = 全局开关 + 范围，**不分游戏**。
		// 静态证据：memo 体与依赖数组里都不许出现 remindGames / remindGamesKey。
		{
			const memo = /const tickerItems = \(0, react\.useMemo\)\(([\s\S]*?)\);/.exec(compAll);
			const memoText = memo ? memo[1] : "";
			check("能定位到渲染层的 tickerItems memo（守卫自身没瞎）", !!memo && memoText.length > 0);
			check("轮播 memo 里**不出现** remindGames / remindGamesKey（逐游戏列表不进轮播链路）",
				!/remindGames/i.test(memoText), memoText.replace(/\s+/g, " ").slice(0, 160));
			check("轮播 memo 的依赖里没有逐游戏列表（只有 games / now / tickerOn / tickerHours）",
				/\[games, now, tickerOn, tickerHours\]/.test(memoText),
				memoText.replace(/\s+/g, " ").slice(-90));
		}
		check("渲染层读开关也走 tickerOnOf（两处口径只有一处实现）",
			(compAll.match(/tickerOnOf\(s\.tickerOn\)/g) || []).length === 2,
			String((compAll.match(/tickerOnOf\(s\.tickerOn\)/g) || []).length));
		check("按钮与设置页读范围都走 tickerRangeOf（老配置残留的 0 不会被当成「关闭」）",
			(compAll.match(/tickerRangeOf\(s\.tickerHours\)/g) || []).length === 2,
			String((compAll.match(/tickerRangeOf\(s\.tickerHours\)/g) || []).length));

		// 设置页：两个控件各自 commit 各自的键；文案是「按钮轮播」+「轮播范围」（不再是一个单行下拉）
		check("设置页两个控件分别写 tickerOn / tickerHours",
			compAll.includes('commit("tickerOn"') && compAll.includes('commit("tickerHours"'));
		check("设置页文案：「按钮轮播」开关 + 「轮播范围」下拉（旧的那个单行下拉已拆掉）",
			/children: "按钮轮播"/.test(compAll) && /children: "轮播范围"/.test(compAll));
		check("设置页「提醒」白名单写的是 remindGames（键名已从 tickerGames 改名）",
			compAll.includes('commit("remindGames"') && compAll.indexOf('commit("tickerGames"') < 0);

		// 键必须成套：DEFAULT_SETTINGS / schema / CONFIG_KEYS 三处都要有（漏了 = 设了不生效）
		{
			const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
			check("src/index.js schema：tickerOn = z.boolean().default(true).volatile()",
				/tickerOn:\s*z\.boolean\(\)\.default\(true\)\.volatile\(\)/.test(hostSrc));
			check("src/index.js schema：tickerHours 的 default 是 72（不再是 24）",
				/tickerHours:\s*z\.number\(\)\.default\(72\)\.volatile\(\)/.test(hostSrc));
			const cfgSrc = readFileSync(path.join(REPO, "src", "client", "10-config.js"), "utf8");
			const opts = /const TICKER_OPTIONS = \[([\s\S]*?)\];/.exec(cfgSrc);
			check("能解析出 TICKER_OPTIONS（守卫自身没瞎）", !!opts);
			const hours = opts ? [...opts[1].matchAll(/hours:\s*(\d+)/g)].map((m) => Number(m[1])) : [];
			check("范围选项 = 12 / 24 / 48 / 72（**没有 0**：关闭已由开关负责）",
				hours.join(",") === "12,24,48,72", hours.join(","));
			const ehSrc = readFileSync(path.join(REPO, "src", "client", "engine-head.js"), "utf8");
			check("engine-head.js 的 CONFIG_KEYS 里含 tickerOn（漏了会让设置页写了引擎读不到）",
				/"tickerOn"/.test(ehSrc));
			// 改名的键同样要成套：DEFAULT_SETTINGS 有 remindGames ⇒ CONFIG_KEYS 必须也有
			// （否则设置页写了、引擎读不到；见 test/cases-rule-lint.mjs 的"键必须都在 CONFIG_KEYS"守卫）。
			check("engine-head.js 的 CONFIG_KEYS 里含 remindGames（改名后不能只改一半）",
				/"remindGames"/.test(ehSrc) && !/"tickerGames"/.test(ehSrc));
		}
	}

	// ── ⑩ 轮播顺序「交叉」+ 翻页方向「四步循环」（2026-10-25 三次定稿 + 四次定稿修正）──
	// 用户要求：
	//   ① 每两条轮播条目之间插回一次原按钮 ⇒ 展开序列 [idle, 1, idle, 2, …]（长度 2n；n=0 只有 idle）；
	//   ② 方向按**切换次数**四步一循环 up,down,down,up（idx 0 = 挂载兜底 down），
	//      与条目数无关 ⇒ n=2 与 n=4 走 8 拍必须给出同一串方向；
	//   ③ 渲染层取方向用 tickerDirAt(单调切换序)，**不能**用 `stepAt(shownStep).dir`（回卷丢相位）。
	{
		const two = tickerSlidesOf([
			{ key: "a:gacha", gameId: "a", side: "gacha", name: "甲", title: "池甲", startTs: NOW - H, endTs: NOW + H, kind: "end" },
			{ key: "b:event", gameId: "b", side: "event", name: "乙", title: "活动乙", startTs: NOW + H, endTs: NOW + 2 * H, kind: "start" }
		], NOW);
		const steps2 = tickerStepsOf(two);
		check("交叉·n=2：展开成 4 格（= 2n），不是 3 格（idle / 条目1 / idle / 条目2）",
			steps2.length === 4, String(steps2.length));
		check("交叉·n=2：顺序是 [idle, 条目1, idle, 条目2]（slideIndex = -1,0,-1,1）",
			steps2.map((s) => s.slideIndex).join(",") === "-1,0,-1,1",
			steps2.map((s) => s.slideIndex).join(","));
		check("交叉·n=2：idle 标记 = [真,假,真,假]（每两条之间插回一次原按钮）",
			steps2.map((s) => (s.idle ? 1 : 0)).join(",") === "1,0,1,0",
			steps2.map((s) => s.idle).join(","));
		check("交叉·n=2：格号连续 0..3（渲染层拿它当 key / prevStep）",
			steps2.map((s) => s.idx).join(",") === "0,1,2,3", steps2.map((s) => s.idx).join(","));

		// 方向 4 步循环：格 1 up / 格 2 down / 格 3 down（第 4 格在 n=2 时不存在，回卷由推演覆盖）
		check("方向 4 步循环·n=2：第 1 格 up、第 2 格 down、第 3 格 down（不是「交替」）",
			steps2[1].dir === "up" && steps2[2].dir === "down" && steps2[3].dir === "down",
			steps2.map((s) => s.dir).join(","));
		check("方向 4 步循环·n=2：**每一格**都满足 tickerDirAt(格号)（四步循环，不再按 idle/条目分）",
			steps2.every((s) => (s.idx === 0 ? s.dir === "down" : s.dir === ["up", "down", "down", "up"][(s.idx - 1) % 4])),
			steps2.map((s) => (s.idle ? "idle:" : "item:") + s.dir).join(" "));
		check("方向 4 步循环·n=2：4 格方向 = down,up,down,down",
			steps2.map((s) => s.dir).join(",") === "down,up,down,down",
			steps2.map((s) => s.dir).join(","));
		check("方向 4 步循环·n=2：第 0 格（初始 idle）也有方向 down（DOM 上永远是 is-up / is-down 之一）",
			steps2[0].dir === "down");

		// n = 0：只有 idle、不滚动（长度 1）
		const steps0 = tickerStepsOf([]);
		check("交叉·n=0：只有 1 格（idle），不滚动",
			steps0.length === 1 && steps0[0].idle === true && steps0[0].slideIndex === -1,
			JSON.stringify(steps0));
		check("交叉·n=0：方向 down、脏输入（null / undefined / 非数组）也不抛",
			steps0[0].dir === "down"
			&& tickerStepsOf(null).length === 1
			&& tickerStepsOf(void 0).length === 1
			&& tickerStepsOf("nope").length === 1);

		// n = 1 / n = 3：长度 = 2n，条目下标 1 / 3 / 5
		check("交叉·n=1：展开成 2 格（idle / 条目1）",
			tickerStepsOf([{}]).length === 2
			&& tickerStepsOf([{}]).map((s) => s.slideIndex).join(",") === "-1,0");
		const steps3 = tickerStepsOf([{}, {}, {}]);
		check("交叉·n=3：展开成 6 格，条目下标 1 / 3 / 5、其余是 idle",
			steps3.length === 6
			&& steps3.map((s) => s.slideIndex).join(",") === "-1,0,-1,1,-1,2",
			steps3.map((s) => s.slideIndex).join(","));
		check("方向 4 步循环·n=3：6 格方向 = down,up,down,down,up,up",
			steps3.map((s) => s.dir).join(",") === "down,up,down,down,up,up",
			steps3.map((s) => s.dir).join(","));

		// ── 8 拍推演（2026-10-25 四次定稿，用户要求"必须自证"）──────────────────
		// 把 tickerStepsOf 的输出按**渲染层的推进方式**走 8 拍：
		//   step = seq % 展开长度（useCycleSteps 的 step：决定这一拍显示哪一格）
		//   dir  = tickerDirAt(seq)（同一拍的方向：按**切换次数**，不看回卷后的格号）
		// 期望：down,up,down,down,up,up,down,down（第 0 拍 down = 挂载兜底，没有"进入"动作）。
		// n=2（真机最常见的 4 格回卷）与 n=4（8 格）必须给出**同一串方向** —— 这正是
		// "方向与条目数无关"的含义，也是旧写法（按格号取方向）在 n=2 第 4 拍崩掉的地方。
		const walkCycle = (steps, beats) => {
			const out = [];
			for (let seq = 0; seq < beats; seq++) {
				const step = steps.length > 0 ? seq % steps.length : 0;
				const dir = tickerDirAt(seq);
				out.push({ seq, step, dir, cls: dir === "up" ? "is-up" : "is-down", slot: steps[step] });
			}
			return out;
		};
		const dirsOf = (w) => w.map((r) => r.dir).join(",");
		const show = (w) => w.map((r) => `${r.seq}:(${r.step},${r.dir},${r.cls})`).join(" ");

		// 方向规则本体：0 / 负数 / 非数字 = 挂载兜底 down；1..8 = up,down,down,up,up,down,down,up
		check("tickerDirAt：idx 0 / 负数 / 非数字 = down（挂载兜底）；1..8 = up,down,down,up,up,down,down,up",
			tickerDirAt(0) === "down" && tickerDirAt(-3) === "down" && tickerDirAt(NaN) === "down"
			&& [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tickerDirAt(i)).join(",") === "up,down,down,up,up,down,down,up",
			[1, 2, 3, 4, 5, 6, 7, 8].map((i) => tickerDirAt(i)).join(","));

		const w2 = walkCycle(steps2, 8);
		console.log("  推演 n=2（4 格回卷）seq:(step,dir,class) = " + show(w2));
		check("推演·n=2 走 8 拍 = down,up,down,down,up,up,down,down（回卷不丢相位）",
			dirsOf(w2) === "down,up,down,down,up,up,down,down", dirsOf(w2));
		check("推演·n=2：第 4 拍（回卷后第 1 次切换）必须是 up —— 旧写法这里是 down（tickerDirAt(0) 兜底）",
			w2[4].dir === "up" && w2[4].cls === "is-up" && w2[4].step === 0, show(w2));

		const four = tickerSlidesOf([
			{ key: "a:gacha", gameId: "a", side: "gacha", name: "甲", title: "池甲", startTs: NOW - H, endTs: NOW + H, kind: "end" },
			{ key: "b:event", gameId: "b", side: "event", name: "乙", title: "活动乙", startTs: NOW + H, endTs: NOW + 2 * H, kind: "start" },
			{ key: "c:gacha", gameId: "c", side: "gacha", name: "丙", title: "池丙", startTs: NOW - H, endTs: NOW + 3 * H, kind: "end" },
			{ key: "d:event", gameId: "d", side: "event", name: "丁", title: "活动丁", startTs: NOW + 2 * H, endTs: NOW + 4 * H, kind: "start" }
		], NOW);
		const steps4 = tickerStepsOf(four);
		check("交叉·n=4：展开成 8 格（= 2n）", steps4.length === 8, String(steps4.length));
		const w4 = walkCycle(steps4, 8);
		console.log("  推演 n=4（8 格，step 与 seq 一一对应）seq:(step,dir,class) = " + show(w4));
		check("推演·n=4 走 8 拍 = down,up,down,down,up,up,down,down",
			dirsOf(w4) === "down,up,down,down,up,up,down,down", dirsOf(w4));
		check("推演·n=4：每拍 dir 与展开序列自带的 dir 一致（首轮两种定义重合）",
			w4.every((r) => r.slot && r.slot.dir === r.dir), dirsOf(w4));
	}

	// ── ⑨ 翻页层两行顺序（2026-10-25 五次定稿）─────────────────────────────────
	// 消除"向上翻开场空白"的关键不是 easing，而是**行顺序**。窗口 22px 只露两层（各 22px）中的一层：
	//   · up   → [prev, cur]：起点 ty=0（keyframes 的 from）⇒ 第 1 行 **prev 占满窗口**；
	//            终点 ty=-50% = -22px ⇒ 第 2 行 cur 占满窗口（forwards 把终点保持住）；
	//   · down → [cur, prev]：起点 ty=-50% ⇒ 第 1 行 cur 在窗口上方、第 2 行 **prev 占满窗口**；
	//            终点 ty=0 ⇒ cur 占满窗口。
	// 两种方向的共同点 = **起点窗口里都有 prev（旧内容）** ⇒ 不存在空白帧，两个方向才像"同一种翻牌"。
	{
		const up = tickerFlipLinesOf("up", 5, 3);
		const down = tickerFlipLinesOf("down", 5, 3);
		check("tickerFlipLinesOf(\"up\") 的 DOM 顺序 = [prev, cur]（第 1 行是旧内容，起点不空白）",
			up.map((l) => l.slot).join(",") === "prev,cur" && up.map((l) => l.step).join(",") === "3,5",
			JSON.stringify(up));
		check("tickerFlipLinesOf(\"down\") 的 DOM 顺序 = [cur, prev]（第 1 行是新内容；起点 -50% 时旧内容占窗口）",
			down.map((l) => l.slot).join(",") === "cur,prev" && down.map((l) => l.step).join(",") === "5,3",
			JSON.stringify(down));
		check("两个方向都各保留 cur 与 prev 一行（只换顺序、内容不丢）",
			[up, down].every((ls) => ls.length === 2
				&& ls.map((l) => l.slot).sort().join(",") === "cur,prev"
				&& ls.map((l) => l.step).sort().join(",") === "3,5"));
		check("脏方向（空串 / null / undefined / 大小写不符 / 别的词）一律按 down —— 与 tickerDirAt 的挂载兜底一致",
			["", null, void 0, "UP", "up ", "down", "x"].every((d) => tickerFlipLinesOf(d, 5, 3)[0].slot === "cur"));
		check("挂载首帧（prevStep === shownStep）两个方向都只渲染同一份内容（不会抖出旧格）",
			tickerFlipLinesOf("up", 2, 2).every((l) => l.step === 2)
			&& tickerFlipLinesOf("down", 2, 2).every((l) => l.step === 2));
	}

	// ── ⑪ 翻页落定（2026-10-25 六次定稿）：动画播完 ⇒ 静态单行 + transform:none ────────
	// 用户要求：向上翻结束后不许再带着 translateY(-22px) 的持久 transform，两个方向的终点
	// 状态必须一致。做法 = onAnimationEnd（只认两条翻页 keyframes）⇒ flipSettled=true ⇒
	// 只渲染 cur 一行 + .is-settled{animation:none;transform:none}。
	// ⚠️ 落定只是"把 forwards 保持住的终点画面换成等价的静态画面"：不许有跳动/闪烁/文字位移。
	{
		// 纯函数：settled × 方向 = 4 种组合（落定时方向被忽略，恒为 [cur]）。
		const combo = [
			{ settled: false, dir: "up", want: "prev,cur" },
			{ settled: false, dir: "down", want: "cur,prev" },
			{ settled: true, dir: "up", want: "cur" },
			{ settled: true, dir: "down", want: "cur" }
		];
		const got = combo.map((c) => tickerFlipRenderLinesOf(c.dir, 5, 3, c.settled));
		const slotsOf = (ls) => ls.map((l) => l.slot).join(",");
		check("落定 × 方向 4 种组合：未落定按方向换序（up=[prev,cur] / down=[cur,prev]），落定后一律只有 [cur]",
			got.map(slotsOf).join(" | ") === "prev,cur | cur,prev | cur | cur",
			got.map(slotsOf).join(" | "));
		check("落定后只留 cur 一行：cur 的格号不变、prev 行**彻底消失**（不是只加个类、两行还留在 DOM 里）",
			got[2].length === 1 && got[2][0].step === 5 && got[2][0].slot === "cur"
			&& got[3].length === 1 && got[3][0].step === 5 && got[3][0].slot === "cur",
			JSON.stringify(got.slice(2)));
		check("落定与方向无关（同一 cur/prev 下 up / down 的落定结果逐项相同）",
			JSON.stringify(got[2]) === JSON.stringify(got[3]), JSON.stringify([got[2], got[3]]));
		check("脏 settled（undefined / null / 0 / 空串 / false）按未落定处理，只有真值才收敛成单行",
			[void 0, null, 0, "", false].every((v) => tickerFlipRenderLinesOf("up", 5, 3, v).length === 2)
			&& tickerFlipRenderLinesOf("down", 5, 3, "yes").length === 1);

		// 静态守卫：CSS / 组件 / 纯函数三处必须成套（少一处就是"写了但没接上"）。
		const styles2 = readFileSync(path.join(REPO, "src", "client", "70-styles.js"), "utf8");
		const comp2 = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		const helpers2 = readFileSync(path.join(REPO, "src", "client", "60-helpers.js"), "utf8");

		check(".is-settled 规则存在，且同时含 animation:none 与 transform:none（终点彻底回到静态）",
			/\.gacha-cal-btn-flip\.is-settled\{animation:none;transform:none\}/.test(styles2));
		const settleAt = styles2.indexOf(".gacha-cal-btn-flip.is-settled{animation:none;transform:none}");
		check(".is-settled 排在 .is-up / .is-down 之后（三者特异性相同，必须靠顺序胜出）",
			settleAt > styles2.indexOf(".gacha-cal-btn-flip.is-up{animation:gacha-cal-btn-flip ")
			&& settleAt > styles2.indexOf(".gacha-cal-btn-flip.is-down{animation:gacha-cal-btn-flip-down"),
			String(settleAt));

		check("翻页层接了 React 合成事件 onAnimationEnd",
			/const onAnimationEnd = \(e\) => \{/.test(comp2) && /onAnimationEnd,/.test(comp2));
		const onEndBlock = /const onAnimationEnd = \(e\) => \{([\s\S]*?)\n\t\t\t\};/.exec(comp2);
		check("onAnimationEnd 按 e.animationName 过滤两条翻页 keyframes（其它动画结束不落定）",
			!!onEndBlock
			&& /const name = e && e\.animationName;/.test(onEndBlock[1])
			&& /if \(name !== "gacha-cal-btn-flip" && name !== "gacha-cal-btn-flip-down"\) return;/.test(onEndBlock[1]),
			onEndBlock ? onEndBlock[1].trim() : "没取到 handler");
		check("落定是**本地 state**（flipSettled，初值 false）—— 组件一重挂载就回到未落定",
			/const \[flipSettled, setFlipSettled\] = \(0, react\.useState\)\(false\);/.test(comp2));
		check("落定后渲染的行数组来自纯函数（settled 为真 ⇒ 只有 cur 一行）",
			/const flipLines = tickerFlipRenderLinesOf\(reduceMotion \? "down" : flipDir, shownStep, prevStep, flipSettled\);/.test(comp2)
			&& /children: flipLines\.map\(\(l\) => renderLine\(l\.step, l\.slot\)\)/.test(comp2));
		check("落定类 .is-settled 只在 flipSettled 为真时拼上（未落定不带这个类）",
			/className: "gacha-cal-btn-flip " \+ \(flipDir === "up" \? "is-up" : "is-down"\) \+ \(flipSettled \? " is-settled" : ""\)/.test(comp2));
		check("每次换格重置：落定 state 所在子组件由父层 key={shownStep} 重挂载（等价于 key 重置）",
			/function TickerFlipLines\(\{ flipDir, shownStep, prevStep, reduceMotion, renderLine \}\)/.test(comp2)
			&& /react_jsx_runtime\.jsx\)\(TickerFlipLines, \{/.test(comp2)
			&& /key: shownStep,/.test(comp2));
		check("纯函数本体在 60-helpers.js：settled 为真时直接返回单行 [cur]（没有夹带 prev）",
			/if \(settled\) return \[\{ step: curStep, slot: "cur" \}\];/.test(helpers2)
			&& /function tickerFlipRenderLinesOf\(dir, curStep, prevStep, settled\)/.test(helpers2));
		// 负向：不许用"两行照留、只把动画关掉"冒充落定（视觉上被窗口裁掉，真机上会露馅），
		// 也不许在落定分支里再塞 prev 行。
		check("负向：不存在「落定时仍渲染两行」的写法（flipSettled 附近没有 prevStep / \"prev\"）",
			!/flipSettled[\s\S]{0,120}?(?:prevStep|"prev")/.test(comp2)
			&& !/children: \[tickerLine\(shownStep, "cur"\), tickerLine\(prevStep, "prev"\)\]/.test(comp2));
		check("负向：落定**不靠 useEffect 重置**（effect 在渲染之后才跑 ⇒ 换格那一帧会先渲染成旧的 settled）",
			!/useEffect\([\s\S]{0,160}?flipSettled/.test(comp2));
		// reduce 回归（现有断言已在上面保留）：animation:none ⇒ 收不到 animationend ⇒ 永不落定；
		// 而静态路径（父层强制 down 顺序、第 1 行恒为 cur）自己就是对的。
		check("reduce 分支不依赖落定：state 初值 false + 父层仍强制 down 顺序（第 1 行 cur）",
			/const \[flipSettled, setFlipSettled\] = \(0, react\.useState\)\(false\);/.test(comp2)
			&& /reduceMotion \? "down" : flipDir/.test(comp2)
			&& /@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none\}/.test(styles2));
	}
}
