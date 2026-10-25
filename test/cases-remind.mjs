// test/cases-remind.mjs —— 到期提醒（MVP，2026-10-25）
//
// 功能范围（用户定的 MVP）：**只有**侧栏按钮红点 + 「提前 N 小时」设置。不做系统通知、
// 不做弹窗/声音、不动刷新链路、不动缓存载荷结构。
//
// 本文件守两件事：
//   ① 判定口径（纯函数 `isExpiringSoon`，60-helpers.js）：
//      某侧"即将到期" = 该侧**已开始**（startTs <= now）且 **endTs 落在 (now, now + N 小时]**。
//      计划里的 ①~⑥ 六条全在第一节，逐条一个 check（未开始 / 已结束 / 刚起步 1 小时后结束 /
//      25 小时后结束 / N=0 关闭 / 缺 ts），另加两个闭区间边界。
//   ② 清单层（`remindDueOf`，80-components.js）：落盘的「源站墙钟文本 + tz」要能换算出**绝对**结束时刻
//      —— 这一层必须与运行环境时区无关（CI 跑 UTC、开发机跑 +08，两边都要绿）。
//      做法：断言 remindWindowOf 的 ts 等于 `sourceInstant(...)` 的独立算法结果，不写死本机偏移。
//
// ⚠️ 时刻全部显式传入（`now` 是参数，不是 Date.now()），所以本文件不随跑测那天漂移。

import { check, section } from "./harness.mjs";
import { T } from "./load.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

export default async function run() {
	section("到期提醒（侧栏红点 + 「提前 N 小时」）");
	const { isExpiringSoon, expiringSoonOf, remindWindowOf, remindDueOf, sourceInstant } = T;

	const NOW = Date.UTC(2026, 9, 25, 4, 0);   // 2026-10-25 12:00 +08 / 13:00 +09 / 04:00 UTC
	const now = new Date(NOW);
	const H = 3600000;

	// ── ① 判定口径（纯函数，六条 + 两个边界）──────────────────────────────────
	{
		// ① 未开始：已经满足"24 小时内结束"（endTs = now + 5h），但 startTs 还在未来 → **不算**
		check("① 未开始（startTs > now）→ 不算（哪怕 endTs 就在 5 小时后）",
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

	// ── ② 列表版（expiringSoonOf）：关闭时短路 + 顺序保持 ──────────────────────
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

	// ── ③ 清单层：落盘文本 + tz → 绝对窗口（与运行环境时区无关）──────────────
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
				// 未开始：源站 10-25 15:00（= 06:00Z，晚于 now）→ 不算
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
				event: "", eventDates: ""
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

		// 清单（N=24）：g1 卡池 + g1 活动 + g4 卡池 = 3 条；g2 两侧都不算、g3/custom 读不出
		{
			const due = remindDueOf(games, now, 24);
			check("N=24 的到期清单 = 3 条（g1 卡池 / g1 活动 / g4 卡池）",
				due.length === 3, JSON.stringify(due.map((x) => x.key)));
			check("清单按 endTs 升序（最近到期在前）",
				due.map((x) => x.key).join(",") === "g1:gacha,g1:event,g4:gacha", due.map((x) => x.key).join(","));
			check("清单带游戏名与到期标题（按钮悬停用）",
				due[0].name === "游戏甲" && due[0].title === "角色甲", JSON.stringify([due[0].name, due[0].title]));
			check("未开始的侧（g2 卡池）不在清单里",
				!due.some((x) => x.key === "g2:gacha"));
			check("25 小时后结束的侧（g2 活动）N=24 不在、N=48 才在",
				!remindDueOf(games, now, 24).some((x) => x.key === "g2:event")
				&& remindDueOf(games, now, 48).some((x) => x.key === "g2:event"));
		}

		// 关闭 = 空清单（红点不出现），且不再换算
		check("N=0（关闭）→ 空清单（红点不显示）",
			remindDueOf(games, now, 0).length === 0
			&& remindDueOf(games, now, -1).length === 0);
		check("N=12 → 只剩 endTs <= now + 12h 的（g1 两条 + g4 一条仍在 12h 内）",
			remindDueOf(games, now, 12).length === 3);
		check("脏输入不抛：games 非数组 / now 缺失 → 空清单",
			remindDueOf(null, now, 24).length === 0
			&& remindDueOf(games, null, 24).length === 0);
	}

	// ── ④ 红点样式：不许参与布局 + 70-styles.js 的模板字符串完整性 ────────────
	// 用户定下「不要改变按钮尺寸/布局（不能重演上次的按钮错位）」；而 70-styles.js 的 CSS 全藏在
	// 一个模板字符串里（"反引号必须恰好 2 个、注释必须配平"已经踩过两次）。这两条都是
	// **改错了不报错、只在真机上才发现**的病，所以用静态守卫钉住（读源码，不需要 DOM）。
	{
		const styles = readFileSync(path.join(REPO, "src", "client", "70-styles.js"), "utf8");
		const count = (sub) => styles.split(sub).length - 1;
		check("70-styles.js 的反引号恰好 2 个（模板字符串起止各一个）", count("`") === 2, String(count("`")));
		check("70-styles.js 的 /* */ 配平", count("/*") === count("*/"), `${count("/*")} / ${count("*/")}`);
		check("70-styles.js 的 { } 配平", count("{") === count("}"), `${count("{")} / ${count("}")}`);
		const dotRule = /\.gacha-cal-dot\{([^}]*)\}/.exec(styles);
		check("红点规则存在（.gacha-cal-dot）", !!dotRule, dotRule ? dotRule[1] : "没找到");
		check("红点是绝对定位（不进按钮的 flex 布局 ⇒ 不会挤动图标/文字）",
			!!dotRule && /position:\s*absolute/.test(dotRule[1]), dotRule ? dotRule[1] : "");
		check("红点不参与鼠标命中（悬停说明因此挂在按钮上）",
			!!dotRule && /pointer-events:\s*none/.test(dotRule[1]), dotRule ? dotRule[1] : "");
		check("按钮提供定位上下文（.gacha-cal-btn 带 position:relative，本身不影响布局）",
			/\.gacha-cal-btn\{[^}]*position:\s*relative/.test(styles));
	}
}
