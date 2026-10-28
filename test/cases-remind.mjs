// test/cases-remind.mjs —— 到期提醒（送达）：判定纯函数 + 设置键三处齐 + 宿主接线静态守卫
//
// ── 为什么需要它 ──
// 送达是**唯一一条在用户不看 DSH 时也生效**的链路，出问题的表现是"该响的时候没响"或"响一堆"，
// 而且**没有界面可以看出来**（日志在 %LOCALAPPDATA%\dsh-gacha-calendar\remind.log）。
// 所以这里把两类最容易悄悄坏掉的东西钉死：
//   ① 判定规则（纯函数，65-remind.js）：同一件事多档到期**只发最紧急那一档**、再跑不重发、
//      T 过作废并清状态、配置读坏回落默认、开始方向用另一套节点；
//   ② 接线（静态）：三个设置键必须同时出现在 DEFAULT_SETTINGS / CONFIG_KEYS / 宿主的 schema 里；
//      宿主要真有定时器、真在 disposer 里清理、真的**不依赖 tools/ 目录**（那是原型，不进插件）。
//   ③ 设置页的节点档位**胶囊**（chips，2026-10-28 改版）：可选集合固定 = 出厂档位，点一下写回
//      归一化串（降序、逗号分隔），全部取消 ⇒ 写**空串** ⇒ 判定侧空档（该方向不提醒）。
//      "显式空串（用户主动关）"与"缺失 / 非法（配置读坏）"必须分开 —— 这条语义在本文件钉死，
//      两边的实现是同一个 remindNodesOf（`remindNodesToggleOf` 也用它），否则会出现
//      "设置页说 2 小时、判定按 6 小时发"或"关了还在提醒"。
//
// ⚠️ 时刻全部显式传入（`now` 是参数），与本机时区无关 —— CI 跑 UTC、开发机跑 +08 都必须绿。
// ⚠️ 判定代码与宿主用的是**同一份源码**（build.mjs 把 65-remind.js 原样拼成 lib/remind-core.mjs），
//    这里有两类断言分别走两条路：`T.remindXxx`（客户端产物）与 `R.remindXxx`（宿主那份 ESM）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { T } from "./load.mjs";
import * as R from "../lib/remind-core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const H = 3600000;

// 固定时刻：2026-10-27 14:48 +08 / 06:48 UTC（与内容无关，纯粹为了可复现）
const NOW = Date.UTC(2026, 9, 27, 6, 48);

export default async function run() {
	section("到期提醒（送达）：判定纯函数 + 设置键三处齐 + 宿主接线");

	const {
		remindOnOf, remindIdentityOf, notifyShortcutPickOf, notifyIdentityCacheOf, notifyIdentityFallbackOf, remindNodesOf, remindNodesToggleOf, remindConfigOf, remindKeyOf, remindStateOf,
		remindTestToastOf, remindWindowOf, remindItemsOf, remindTickOf, remindToastOf,
		dueWindowOf, sourceInstant, DEFAULT_SETTINGS, SOURCES
	} = T;

	// ── ① 同一件事多个节点同时到期 ⇒ **只发最紧急那档**（本轮的核心规则）──────────
	{
		// T = 1 小时后结束，默认节点 72/24/6/2 ⇒ 72、24、6、2 四档全都已到期（T-2h 也在过去）
		const item = { gameId: "g1", side: "gacha", kind: "end", title: "池甲", gameName: "游戏甲", T: NOW + 1 * H, startTs: NOW - 10 * H, endTs: NOW + 1 * H };
		const res = remindTickOf(NOW, [item], {}, {});
		check("多档同时到期 → 只产生 **1 条**通知（不刷屏）", res.toNotify.length === 1, String(res.toNotify.length));
		check("这条通知发的是**最紧急那档**（n 最小 = 2 小时）", res.toNotify[0].node === 2, String(res.toNotify[0] && res.toNotify[0].node));
		check("其余到期档（72/24/6）一并标成已发（下次不再补发）",
			JSON.stringify(res.toNotify[0].nodesMarked) === JSON.stringify([2, 6, 24, 72]),
			JSON.stringify(res.toNotify[0].nodesMarked));
		const key = remindKeyOf(item);
		check("状态键 = `gameId|side|kind|T`", key === "g1|gacha|end|" + (NOW + 1 * H), key);
		check("状态里记的是**节点小时数**（不是时间戳），四档都在",
			JSON.stringify(res.stateNext[key] && res.stateNext[key].fired) === JSON.stringify([72, 24, 6, 2]),
			JSON.stringify(res.stateNext[key]));

		// 再跑一轮（模拟 30 分钟后的下一次定时）→ 一条都不发
		const again = remindTickOf(NOW + 30 * 60000, [item], {}, res.stateNext);
		check("**再跑不重发**：紧接着的下一轮 0 条", again.toNotify.length === 0, String(again.toNotify.length));
		check("再跑时状态原样保留（不因为没发就丢记录）",
			JSON.stringify(again.stateNext) === JSON.stringify(res.stateNext));

		// T 过 ⇒ 整条作废：不发、状态里的键清掉（规则⑤）
		const passed = remindTickOf(NOW + 2 * H, [item], {}, res.stateNext);
		check("T 已过 → 不再发（整条作废）", passed.toNotify.length === 0, String(passed.toNotify.length));
		check("T 已过 → 状态里的键被清掉（不留下永不清理的死记录）",
			Object.keys(passed.stateNext).length === 0, JSON.stringify(passed.stateNext));
		check("T 已过：**即使条目已经不在本轮数据里**，光凭键里的 T 也会清掉",
			Object.keys(remindTickOf(NOW + 2 * H, [], {}, res.stateNext).stateNext).length === 0);

		// 只到 72 档时只发 72（不是"一到期就发")
		const only72 = remindTickOf(NOW + 1 * H, [{ ...item, T: NOW + 73 * H }], {}, {});
		check("只为 72 小时档到期时，就发 72 档（24 小时档还没到）",
			only72.toNotify.length === 1 && only72.toNotify[0].node === 72 && only72.toNotify[0].nodesMarked.length === 1,
			JSON.stringify(only72.toNotify.map((n) => [n.node, n.nodesMarked])));
	}

	// ── ② 配置解析：字符串为主，读坏了回落默认（不许抛、不许停摆）──────────────────
	{
		const def = remindConfigOf({});
		check("空配置 → 默认结束节点 72/24/6/2", JSON.stringify(def.endNodes) === JSON.stringify([72, 24, 6, 2]), JSON.stringify(def.endNodes));
		check("空配置 → 结束节点仍取默认；开始节点暂时置空（2026-10-28 起基本不可用）", JSON.stringify(def.endNodes) === JSON.stringify([72, 24, 6, 2]) && JSON.stringify(def.startNodes) === JSON.stringify([]), JSON.stringify(def));
		check("空配置：null / 非对象 / 缺键 都不抛且回落默认",
			JSON.stringify(remindConfigOf(null)) === JSON.stringify(def)
			&& JSON.stringify(remindConfigOf(void 0)) === JSON.stringify(def)
			&& JSON.stringify(remindConfigOf("72,1")) === JSON.stringify(def));
		check("字符串 \"12,8\" → 降序 [12,8]（顺序由解析器归一，不依赖用户写法）",
			JSON.stringify(remindConfigOf({ remindEndNodes: "8,12" }).endNodes) === JSON.stringify([12, 8]));
		check("容错：空白 / 中文逗号 / 0 / 负数 / 非数字一律丢弃，只剩有效档",
			JSON.stringify(remindNodesOf(" 6 ， 2 ,abc, 0, -1 ", [72])) === JSON.stringify([6, 2]),
			JSON.stringify(remindNodesOf(" 6 ， 2 ,abc, 0, -1 ", [72])));
		check("解析不出任何有效档 ⇒ 回落默认（不抛、不让提醒停摆）",
			JSON.stringify(remindNodesOf("全部坏掉", [72, 24])) === JSON.stringify([72, 24])
			&& JSON.stringify(remindNodesOf(null, [72])) === JSON.stringify([72])
			&& JSON.stringify(remindNodesOf([], [72])) === JSON.stringify([72]));

		// ⚠️ 2026-10-28 定的语义（设置页胶囊"全部取消"就是靠它）：
		//   **显式空串 ⇒ 空档 = 该方向不提醒**（不回落默认）；
		//   **字段缺失 / 内容非法 ⇒ 回落默认**（配置读坏了，不该让提醒停摆）。
		// 两者混成一个返回值，就会出现"用户明明关掉了，到点还是弹"或"配置坏了不再提醒"。
		check("显式空串 ⇒ 空档（[]），**不**回落默认（\"\" / 全空白 / 只有逗号都算）",
			remindNodesOf("", [72, 24]).length === 0
			&& remindNodesOf("   ", [72]).length === 0
			&& remindNodesOf(" , ，", [72]).length === 0,
			JSON.stringify([remindNodesOf("", [72]), remindNodesOf("   ", [72]), remindNodesOf(" , ，", [72])]));
		check("字段缺失（undefined / null / 空数组）⇒ 仍回落默认（不是空档）",
			JSON.stringify(remindNodesOf(void 0, [72])) === JSON.stringify([72])
			&& JSON.stringify(remindNodesOf(null, [72])) === JSON.stringify([72])
			&& JSON.stringify(remindNodesOf([], [72])) === JSON.stringify([72]),
			JSON.stringify([remindNodesOf(void 0, [72]), remindNodesOf(null, [72]), remindNodesOf([], [72])]));
		check("内容非法（非数字 / 0 / 负数）⇒ 仍回落默认（不是空档）",
			JSON.stringify(remindNodesOf("坏的", [72])) === JSON.stringify([72])
			&& JSON.stringify(remindNodesOf("0,-1", [72])) === JSON.stringify([72]),
			JSON.stringify([remindNodesOf("坏的", [72]), remindNodesOf("0,-1", [72])]));
		check("remindConfigOf：显式空串 ⇒ 该方向 []，另一个方向不受影响",
			JSON.stringify(remindConfigOf({ remindEndNodes: "" }).endNodes) === JSON.stringify([])
			&& JSON.stringify(remindConfigOf({ remindEndNodes: "" }).startNodes) === JSON.stringify([]),
			JSON.stringify(remindConfigOf({ remindEndNodes: "" })));
		{
			// 空档真的进判定：结束方向关掉 ⇒ 一条都不发（不是"回落默认后照发"）
			const offItem = { gameId: "g8", side: "gacha", kind: "end", gameName: "游戏辛", T: NOW + 1 * H, startTs: NOW - 9 * H, endTs: NOW + 1 * H };
			const endOff = remindTickOf(NOW, [offItem], { remindEndNodes: "" }, {});
			check("判定侧：结束方向空串 ⇒ **0 条**通知、也不留状态键",
				endOff.toNotify.length === 0 && Object.keys(endOff.stateNext).length === 0,
				JSON.stringify([endOff.toNotify.length, endOff.stateNext]));
			// 2026-10-28 起开始档位暂时置空（多数来源不提供未来档期），所以传 start 条目也不该发
			const startOff = remindTickOf(NOW, [{ ...offItem, gameId: "g9", kind: "start" }], { remindEndNodes: "" }, {});
			check("判定侧：开始档位已暂时置空 ⇒ 传入 start 条目也不发通知",
				startOff.toNotify.length === 0, JSON.stringify(startOff.toNotify.map((x) => x.key)));
			check("判定侧：两个方向都空串 ⇒ 一条都不发（两个方向都关掉是合法状态）",
				remindTickOf(NOW, [offItem, { ...offItem, kind: "start" }], { remindEndNodes: "", remindStartNodes: "" }, {}).toNotify.length === 0);
		}
		check("也接受数组 / 单个数字（历史配置可能是数组）",
			JSON.stringify(remindNodesOf(["72", "24"], [1])) === JSON.stringify([72, 24])
			&& JSON.stringify(remindNodesOf(12, [1])) === JSON.stringify([12]));
		check("去重：\"2,2,2\" → [2]", JSON.stringify(remindNodesOf("2,2,2", [1])) === JSON.stringify([2]));

		// 节点配置真的进判定：把结束档改成只剩 1 小时 ⇒ 2 小时后结束这件事现在**还不该发**
		const item = { gameId: "g2", side: "event", kind: "end", gameName: "游戏乙", T: NOW + 2 * H };
		const cfg1 = { remindEndNodes: "1" };
		check("节点配置进判定：只留 1 小时档时，2 小时后结束才轮到 1 小时档（此刻 0 条）",
			remindTickOf(NOW, [item], cfg1, {}).toNotify.length === 0);
		check("同一件事换成默认档（含 2 小时）→ 立刻发最紧急的 2 小时档",
			remindTickOf(NOW, [item], {}, {}).toNotify[0].node === 2);
	}

					// ── ③ 开始方向已暂时置空（2026-10-28：多数来源不提供未来档期，用例随实现一起移除）

// ── ④ 脏输入 / 幂等 / 不改进参 ─────────────────────────────────────────────────
	{
		check("now 不是有限数字 → 抛 TypeError（这是编程错误，不该静默）", (() => {
			try { remindTickOf(NaN, [], {}, {}); return false; } catch (e) { return e instanceof TypeError; }
		})());
		check("条目不是数组 / 数组里夹 null / 状态不是对象 → 不抛",
			remindTickOf(NOW, null, {}, {}).toNotify.length === 0
			&& remindTickOf(NOW, [null, void 0, 1, "x"], {}, {}).toNotify.length === 0
			&& Object.keys(remindTickOf(NOW, [], {}, "坏状态").stateNext).length === 0);
		check("同一个 key 在 items 里出现两次 → 只算一次（不重复发）",
			remindTickOf(NOW, [{ gameId: "g4", side: "gacha", kind: "end", T: NOW + H }, { gameId: "g4", side: "gacha", kind: "end", T: NOW + H }], {}, {}).toNotify.length === 1);
		check("T 不是数字的条目直接跳过（不硬凑）",
			remindTickOf(NOW, [{ gameId: "g5", side: "gacha", kind: "end", T: "明天" }], {}, {}).toNotify.length === 0);
		check("多条同时到期：按 T 升序（最紧迫的在前）",
			remindTickOf(NOW, [
				{ gameId: "b", side: "gacha", kind: "end", T: NOW + 30 * 60000 },
				{ gameId: "a", side: "event", kind: "end", T: NOW + 10 * 60000 }
			], {}, {}).toNotify.map((n) => n.gameId).join(",") === "a,b");
		// 幂等 + 不改进参
		const items = [{ gameId: "g6", side: "gacha", kind: "end", gameName: "丁", T: NOW + H }];
		const state = { ["g6|gacha|end|" + (NOW + H)]: { fired: [72] } };
		const itemsCopy = JSON.stringify(items);
		const stateCopy = JSON.stringify(state);
		const r1 = remindTickOf(NOW, items, {}, state);
		const r2 = remindTickOf(NOW, items, {}, state);
		check("同样的入参调两遍 → 返回值完全一致（纯函数）", JSON.stringify(r1) === JSON.stringify(r2));
		check("入参一概不被改写（items / state 原文不变）",
			JSON.stringify(items) === itemsCopy && JSON.stringify(state) === stateCopy);
		check("状态里的 fired 参与判定：72 已发过 ⇒ 这次只发 2 档（其余档也到期）",
			r1.toNotify[0].node === 2 && r1.toNotify[0].nodesMarked.join(",") === "2,6,24",
			JSON.stringify(r1.toNotify[0].nodesMarked));

		// 状态归一：垃圾键 / 空 fired 丢掉，fired 去重降序
		const norm = remindStateOf({
			"g1|gacha|end|123": { fired: [24, 24, 72] },
			"garbage": { fired: [1] },
			"g2|event|start|456": { fired: [] },
			"g3|gacha|end|789": { fired: ["6", 0, -2, null] }
		});
		check("状态归一：只留合法键 + 非空 fired，且去重降序",
			Object.keys(norm).join(",") === "g1|gacha|end|123,g3|gacha|end|789"
			&& norm["g1|gacha|end|123"].fired.join(",") === "72,24"
			&& norm["g3|gacha|end|789"].fired.join(",") === "6",
			JSON.stringify(norm));
		check("状态归一：null / 数组 / 字符串 → 空对象（不抛）",
			JSON.stringify(remindStateOf(null)) === "{}" && JSON.stringify(remindStateOf([])) === "{}" && JSON.stringify(remindStateOf("x")) === "{}");
	}

	// ── ⑤ 档期文本 + 源站 tz → 绝对窗口（与面板 dueWindowOf **同一口径**）────────────
	// 这是整套提醒的地基：源站给的是**墙钟**（如 `10-21 11:00`，JST），必须先按源站 tz 换成绝对毫秒，
	// "还剩多久"才是真值。这里用 sourceInstant 独立算一遍来对照 ⇒ 断言在 UTC / +08 下都成立。
	{
		const tz = "Asia/Tokyo";
		const text = "10-21 11:00 ~ 10-28 10:59";
		const w = remindWindowOf(text, NOW, tz);
		check("文本 + tz → 绝对窗口（与 sourceInstant 独立算法一致）",
			!!w && w.startTs === sourceInstant(2026, 10, 21, 11, 0, tz) && w.endTs === sourceInstant(2026, 10, 28, 10, 59, tz),
			JSON.stringify([w && w.startTs, sourceInstant(2026, 10, 21, 11, 0, tz)]));
		// 与面板外显那条链（dueWindowOf）逐字段对齐 —— 提醒和面板"还剩 X"必须是同一件事
		const panel = dueWindowOf({ bannerDates: text, tz }, true, new Date(NOW));
		check("与面板 dueWindowOf 逐字段一致（提醒不会和面板说两个时间）",
			!!w && !!panel && w.startTs === panel.startTs && w.endTs === panel.endTs,
			JSON.stringify([w, panel]));
		for (const [tzName, sample] of [
			["UTC", "10-24 00:00 ~ 11-01 23:59"],
			["+540", "10-23 05:00 ~ 10-30 05:00"],
			["America/New_York", "03-07 12:00 ~ 03-10 12:00"]    // 跨美国 DST 切换
		]) {
			const a = remindWindowOf(sample, NOW, tzName);
			const b = dueWindowOf({ bannerDates: sample, tz: tzName }, true, new Date(NOW));
			check(`与面板同口径：${tzName} ${sample}`,
				!!a && !!b && a.startTs === b.startTs && a.endTs === b.endTs,
				JSON.stringify([a, b]));
		}
		// 跨年档期（`12-30 ~ 01-05`）**故意不与面板对比**：面板那条链会先把档期换算成本机文本，
		// 跨年时 fmtWindow 给两端补上年份，而 parseDisplayRange 读不出带年份的文本 ⇒ 面板在部分本机时区下
		// 直接判"读不出"（既有行为，不是本次引入）。提醒这一侧只按源站 tz 算，与运行环境时区无关，
		// 所以这里用 sourceInstant 独立对照（CI 跑 UTC、开发机跑 +08 都必须绿）。
		{
			const crossText = "12-30 10:00 ~ 01-05 10:00";
			const w = remindWindowOf(crossText, NOW, "Asia/Shanghai");
			check("跨年档期：结束月 < 开始月 ⇒ 结束年 +1（12-30 ~ 次年 01-05）",
				!!w && w.startTs === sourceInstant(2026, 12, 30, 10, 0, "Asia/Shanghai")
				&& w.endTs === sourceInstant(2027, 1, 5, 10, 0, "Asia/Shanghai"),
				JSON.stringify([w && new Date(w.startTs).toISOString(), w && new Date(w.endTs).toISOString()]));
			check("跨年档期的结果与本机时区无关（同一段文本在任何 TZ 下都算出同一个绝对窗口）",
				JSON.stringify(remindWindowOf(crossText, NOW, "Asia/Shanghai")) === JSON.stringify(w));
		}
		// 跨年档期在抓取契约里是**两端带年份**的（test/README 的契约）；面板那边读不出（会退化成原文），
		// 提醒这一侧按契约读得出来 —— 这是**有意的差异**，两条都钉住，免得哪天被"对齐"掉：
		const yearText = "2026-10-26 15:00 ~ 2027-01-31 23:59";
		check("带年份的跨年档期：提醒侧读得出绝对窗口（按抓取契约）",
			!!remindWindowOf(yearText, NOW, tz) && remindWindowOf(yearText, NOW, tz).endTs === sourceInstant(2027, 1, 31, 23, 59, tz));
		check("同一段文本：面板 dueWindowOf 读不出（提醒侧是有意的补充，不是分叉）",
			dueWindowOf({ bannerDates: yearText, tz }, true, new Date(NOW)) === null);

		check("读不出来的档期一律 null（绝不硬凑一个猜的时刻）",
			remindWindowOf("版本更新后 ~ 10-21 11:59", NOW, tz) === null
			&& remindWindowOf("10-21 00:00 ~ 00:00", NOW, tz) === null
			&& remindWindowOf("10/25 12:00 ～ 11/26 11:59", NOW, tz) === null
			&& remindWindowOf("", NOW, tz) === null
			&& remindWindowOf(null, NOW, tz) === null
			&& remindWindowOf("01-05 00:00 ~ 01-04 00:00", NOW, tz) === null   // 结束早于开始 = 脏数据
		);
		check("没声明 tz 的条目按本机时区解释（与面板「读不出就按本机显示」一致）",
			!!remindWindowOf("10-21 11:00 ~ 10-28 10:59", NOW, null));
	}

	// ── ⑥ lastData → 条目（每个游戏侧最多两条：结束 / 开始）────────────────────────
	{
		const tz = "Asia/Tokyo";
		const games = {
			"g1": {
				name: "游戏甲",
				banner: "池甲", bannerDates: "10-21 11:00 ~ 10-28 10:59",
				event: "活动甲", eventDates: "10-20 11:00 ~ 10-26 10:59"   // 已经结束 ⇒ 不派生
			},
			"g2": {
				name: "游戏乙",
				// 还没开始 ⇒ 派生 start，不派生 end
				banner: "池乙", bannerDates: "10-29 11:00 ~ 11-05 10:59",
				event: "", eventDates: ""
			},
			"custom-1": { name: "自定义", banner: "自定池", bannerDates: "10-21 11:00 ~ 10-28 10:59" },
			"g3": { name: "游戏丙", banner: "池丙", bannerDates: "版本更新后 ~ 10-21 11:59" }
		};
		const items = remindItemsOf(games, NOW, { "custom-1": tz });
		const keys = items.map((it) => it.key);
		check("条目派生：每个游戏侧最多两条 —— g1 卡池只剩 end（已开始）、g2 卡池 start + end（整段都在未来）、"
			+ "自定义条目 end（共 4 条）",
			items.length === 4, JSON.stringify(keys));
		check("未来才开始的档期同时派生 start 与 end（两条各自按自己的 T 判节点）",
			items.some((it) => it.gameId === "g2" && it.kind === "start") && items.some((it) => it.gameId === "g2" && it.kind === "end"));
		check("条目带 gameName / sideLabel / title（通知文案直接用它）",
			items[0].gameName === "游戏甲" && items[0].sideLabel === "卡池" && items[0].title === "池甲",
			JSON.stringify([items[0].gameName, items[0].sideLabel, items[0].title]));
		check("已经过去的方向不派生（g1 的活动已结束 ⇒ 没有它）",
			!items.some((it) => it.gameId === "g1" && it.side === "event"));
		check("读不出绝对档期的来源不派生（g3 的「版本更新后」）",
			!items.some((it) => it.gameId === "g3"));
		check("自定义条目的 tz 由 extraTzById 提供（否则读不出窗口）",
			items.some((it) => it.gameId === "custom-1" && it.kind === "end"));
		check("条目里的 T 与绝对窗口对得上（end=T=endTs / start=T=startTs）",
			items.every((it) => (it.kind === "end" ? it.T === it.endTs : it.T === it.startTs)));
		check("脏输入不抛：games 非对象 / null / now 缺失 → 空数组",
			remindItemsOf(null, NOW).length === 0 && remindItemsOf("x", NOW).length === 0 && remindItemsOf(games, NaN).length === 0);
	}

	// ── ⑦ 时区表：必须是 SOURCES[].tz 的**完整副本**（宿主读不到 SOURCES，只能带一份）────
	{
		const table = R.REMIND_TZ_BY_ID;
		const missing = SOURCES.filter((s) => !(s.id in table)).map((s) => s.id);
		const wrong = SOURCES.filter((s) => s.id in table && table[s.id] !== s.tz).map((s) => s.id + "=" + table[s.id] + "≠" + s.tz);
		const extra = Object.keys(table).filter((id) => !SOURCES.some((s) => s.id === id));
		check("时区表覆盖全部来源（新增来源时忘了同步会红）", missing.length === 0, "缺：" + missing.join(","));
		check("时区表与 SOURCES[].tz 逐项一致", wrong.length === 0, wrong.join(" "));
		check("时区表没有多余条目（删来源时忘了同步也会红）", extra.length === 0, extra.join(","));
	}

	// ── ⑧ 通知文案（纯函数）：标题分方向、正文有还剩多久与档位 ────────────────────────
	{
		const notify = {
			kind: "end", gameId: "g1", gameName: "游戏甲", side: "gacha", sideLabel: "卡池",
			title: "池甲", T: NOW + 2 * H, node: 24, startTs: NOW - 10 * H, endTs: NOW + 2 * H
		};
		const toast = remindToastOf(notify, NOW);
		check("标题按方向加前缀（结束 / 开始）",
			toast.title === "即将结束 · 游戏甲" && remindToastOf({ ...notify, kind: "start" }, NOW).title === "即将开始 · 游戏甲",
			toast.title);
		check("正文三行：事项名 / 档期 / 还剩多久 + 档位",
			toast.lines.length === 3 && toast.lines[0] === "卡池「池甲」" && toast.lines[2].indexOf("还剩 2 小时") === 0,
			JSON.stringify(toast.lines));
		check("正文里带档位说明（24 小时提醒）", toast.lines[2].indexOf("（24 小时提醒）") > 0, toast.lines[2]);
		check("开始方向说「还有」不说「还剩」",
			remindToastOf({ ...notify, kind: "start" }, NOW).lines[2].indexOf("还有 2 小时") === 0,
			remindToastOf({ ...notify, kind: "start" }, NOW).lines[2]);
		check("缺 title / gameName 时兜底，不产出 undefined",
			remindToastOf({ kind: "end", T: NOW + H, node: 2 }, NOW).title.indexOf("undefined") < 0
			&& remindToastOf(null, NOW).lines.length > 0);
		check("已经过点的时刻不产出负数文案（<1 分钟说「不到 1 分」）",
			remindToastOf({ ...notify, T: NOW - H }, NOW).lines[2].indexOf("不到 1 分") > 0,
			remindToastOf({ ...notify, T: NOW - H }, NOW).lines[2]);
	}

	// ── ⑨ 设置键**三处齐**：DEFAULT_SETTINGS / schema / CONFIG_KEYS（漏一处就是"设了不生效"）──
	{
		check("DEFAULT_SETTINGS.remindOn 默认 true（开箱即用）", DEFAULT_SETTINGS.remindOn === true, String(DEFAULT_SETTINGS.remindOn));
		check("DEFAULT_SETTINGS.remindEndNodes = \"72,24,6,2\"", DEFAULT_SETTINGS.remindEndNodes === "72,24,6,2", String(DEFAULT_SETTINGS.remindEndNodes));
		check("DEFAULT_SETTINGS.remindStartNodes = \"24,2\"", DEFAULT_SETTINGS.remindStartNodes === "24,2", String(DEFAULT_SETTINGS.remindStartNodes));
		check("remindOnOf：只有明确的 false 才算关（缺失 / 其它值一律当开）",
			remindOnOf(false) === false && remindOnOf(true) === true && remindOnOf(void 0) === true && remindOnOf(0) === true);

		// 引擎 CONFIG_KEYS（engine-head.js）—— 与 cases-rule-lint 同一套解析口径
		const ehText = readFileSync(path.join(REPO, "src", "client", "engine-head.js"), "utf8");
		const j = ehText.indexOf("const CONFIG_KEYS = [");
		const cfgBlock = j >= 0 ? ehText.slice(j, ehText.indexOf("];", j)) : "";
		const cfgKeys = [...cfgBlock.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]);
		check("引擎 CONFIG_KEYS 含 remindOn / remindEndNodes / remindStartNodes",
			["remindOn", "remindEndNodes", "remindStartNodes"].every((k) => cfgKeys.includes(k)),
			cfgKeys.join(","));

		// 宿主 schema（src/index.js）：三个键都必须 .volatile() + 默认值与 DEFAULT_SETTINGS 一致
		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		const schemaOf = (name) => {
			const m = new RegExp("\\b" + name + ":\\s*z\\.[\\s\\S]{0,200}?\\.default\\(([^)]*)\\)\\.volatile\\(\\)").exec(hostSrc);
			return m ? m[1] : null;
		};
		check("宿主 schema 有 remindOn: z.boolean().default(true).volatile()", schemaOf("remindOn") === "true", String(schemaOf("remindOn")));
		check("宿主 schema 有 remindEndNodes: z.string().default(\"72,24,6,2\").volatile()",
			schemaOf("remindEndNodes") === JSON.stringify("72,24,6,2"), String(schemaOf("remindEndNodes")));
		check("宿主 schema 有 remindStartNodes: z.string().default(\"24,2\").volatile()",
			schemaOf("remindStartNodes") === JSON.stringify("24,2"), String(schemaOf("remindStartNodes")));
		check("三处默认值能对上：schema → DEFAULT_SETTINGS → 解析后的节点",
			remindConfigOf({ remindEndNodes: DEFAULT_SETTINGS.remindEndNodes, remindStartNodes: DEFAULT_SETTINGS.remindStartNodes }).endNodes.join(",") === "72,24,6,2");
	}

	// ── ⑩ 宿主接线（静态）：定时器 / disposer / 不依赖 tools/ / 生成物真的是同一份源码 ─────
	{
		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		// 「不许出现 X」这类断言只扫**生产代码**：注释里会引用被禁的写法来解释历史（那是好事）。
		// 两种注释都要剥：整行 `//` 与 `/** … */` 块（JSDoc 的行首是 ` *`，只滤 `//` 会漏）。
		const hostCode = hostSrc.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
		const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
		const buildSrc = readFileSync(path.join(REPO, "build.mjs"), "utf8");
		const compSrc = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");

		check("宿主从 lib/remind-core.mjs 复用判定（不是自己再写一套）",
			/from "\.\/remind-core\.mjs"/.test(hostSrc) && /\bremindTickOf\b/.test(hostSrc) && /\bremindItemsOf\b/.test(hostSrc));
		check("宿主注册了**定时器**（setInterval + 启动后先来一轮的 setTimeout）",
			/\bsetInterval\(/.test(hostSrc) && /\bsetTimeout\(/.test(hostSrc));
		check("定时器挂在 ctx.effect 里（卸载 / 改设置重载才会走到清理）",
			/ctx\.effect\(\(\) => \{[\s\S]{0,900}?\}, "gacha-calendar: remind timer"\)/.test(hostSrc));
		check("disposer 里**真的清掉**了两种定时器（漏清 = 每次改设置多叠一个）",
			/return \(\) => \{[\s\S]{0,300}?clearTimeout\(first\);[\s\S]{0,120}?clearInterval\(timer\);/.test(hostSrc));
		check("送达走 powershell.exe（Windows PowerShell 5.1 的绝对路径，不是 pwsh）",
			/WindowsPowerShell/.test(hostSrc) && /powershell\.exe/.test(hostSrc));
		check("送达用 -EncodedCommand 内联脚本（不落地 .ps1、不经过 argv 引号）",
			/-EncodedCommand/.test(hostSrc) && /utf16le/.test(hostSrc));
		// 注释里会解释"为什么不依赖 tools/"（那是好事），所以只扫上面那份**生产代码**。
		check("**不引用 tools/ 目录**（那是原型，不属于插件运行时；注释里的说明不算）",
			!/tools\//.test(hostCode) && !/install\.ps1/.test(hostCode) && !/toast\.ps1/.test(hostCode));
		// 2026-10-28 需求变更：AUMID 从"绝不自建"改成**用户可选**（设置页一个按钮，见 ⑫）。
		// 边界仍然要守：宿主里只在 POST 路由里建/删快捷方式，启动 / 安装时不偷偷改开始菜单。
		check("开始菜单路径只有一处（notifyShortcutDir），不在各处散落",
			(hostSrc.match(/"Start Menu"/g) || []).length === 1,
			String((hostSrc.match(/"Start Menu"/g) || []).length));
		check("建 / 删快捷方式只由 POST 路由触发（enable / disable 脚本各只有一处调用点）",
			(hostSrc.match(/runNotifyPowerShell\(notifyIdentityEnableScript\(/g) || []).length === 1
			&& (hostSrc.match(/runNotifyPowerShell\(notifyIdentityDisableScript\(/g) || []).length === 1);
		check("去重状态落 %LOCALAPPDATA% 且原子写（.tmp → rename）",
			/LOCALAPPDATA/.test(hostSrc) && /host-state\.json/.test(hostSrc) && /renameSync\(tmp, file\)/.test(hostSrc));
		check("关掉开关就真的不干活（remindOnOf 判定在读 lastData 之前）",
			/if \(!remindOnOf\(plain\.remindOn\)\) return;/.test(hostSrc));
		check("宿主读配置时**解包 volatile 引用**（直接读 cfg.remindOn 会永远失效且不报错）",
			/Symbol\.for\("cosmokit\.volatile\.write"\)/.test(hostCode)
			&& /function configValueOf\(/.test(hostCode)
			&& /configValueOf\(cfg, "lastData"\)/.test(hostCode)
			&& !/typeof cfg\.lastData === "string"/.test(hostCode));
		check("宿主侧的判定输入来自 lastData + 源站 tz（不是猜的）",
			/configValueOf\(cfg, "lastData"\)/.test(hostCode) && /remindItemsOf\(games, now, customTzByIdOf/.test(hostCode));

		// 三处入口齐：产物 / 发布包 / 构建脚本
		check("package.json 的 files 带上 lib/remind-core.mjs（漏了 = 装完插件一 import 就失败）",
			Array.isArray(pkg.files) && pkg.files.includes("lib/remind-core.mjs"), JSON.stringify(pkg.files));
		check("build.mjs 生成并校验 lib/remind-core.mjs", /lib\/remind-core\.mjs/.test(buildSrc) && /OUT_REMIND/.test(buildSrc));
		const chunk = readFileSync(path.join(REPO, "src", "client", "65-remind.js"), "utf8");
		const built = readFileSync(path.join(REPO, "lib", "remind-core.mjs"), "utf8");
		check("lib/remind-core.mjs 的前半段**逐字节等于** src/client/65-remind.js（同一份源码，不是抄一份）",
			built.startsWith(chunk));
		check("生成物导出了宿主 import 的每个函数（import 列表 vs 实际 export）", (() => {
			const m = /import \{([\s\S]*?)\} from "\.\/remind-core\.mjs"/.exec(hostSrc);
			const imported = m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
			return imported.length > 0 && imported.every((name) => new RegExp("\\b" + name + "\\b").test(R && Object.keys(R).join(" ")));
		})());
		// 两条路（客户端产物 / 宿主那份 ESM）判定结果必须一致
		const items = [{ gameId: "g7", side: "gacha", kind: "end", gameName: "戊", T: NOW + H }];
		check("客户端与宿主两份判定**结果一致**（同一份源码的两条装载路径）",
			JSON.stringify(remindTickOf(NOW, items, {}, {})) === JSON.stringify(R.remindTickOf(NOW, items, {}, {})));

		// 设置页：总开关这一行在，且读写走 recallOnOf（与宿主同一处口径）
		check("设置页有「提醒」开关，并写回 remindOn",
			/commit\("remindOn", e\.target\.checked\)/.test(compSrc) && /children: "提醒"/.test(compSrc));
		check("设置页的开关状态走 remindOnOf（与宿主同口径，缺省 = 开）",
			/const remindOn = remindOnOf\(s\.remindOn\);/.test(compSrc));
	}

	// ── ⑪ 设置页「提醒」档位 = 胶囊（chips，2026-10-28 改版）────────────────────────
	// 需求（用户 2026-10-28）：文本框 / "解析为：…" 预览 / 红框提示**全部删掉**，换成两排圆角小按钮；
	// 可选集合固定 = 出厂档位（结束 72/24/6/2、开始 24/2），**不做自定义输入**；
	// 点一下立即写回归一化串（降序、逗号分隔、无空格）；**全部取消 ⇒ 写空串** ⇒ 判定侧空档。
	// 这里分两层钉：①纯函数 remindNodesToggleOf（65-remind.js，用的就是判定侧同一个 remindNodesOf）；
	// ②设置页接线（静态：一行胶囊 / 可选集合 / 键名 / 没有输入框与预览 / 点击不被往返吞掉）。
	{
		const D_END = [72, 24, 6, 2];
		const D_START = [24, 2];
		const toggle = (v, n, fb) => remindNodesToggleOf(v, n, fb);

		// ① 纯函数：点一下某档 → 该写回的字符串（格式 = 判定侧归一化后的那一份）
		check("胶囊可选集合 = 出厂档位（结束 [72,24,6,2] / 开始 [24,2]，常量同一处）",
			JSON.stringify(R.REMIND_DEFAULT_END_NODES) === JSON.stringify(D_END)
			&& JSON.stringify(R.REMIND_DEFAULT_START_NODES) === JSON.stringify(D_START),
			JSON.stringify([R.REMIND_DEFAULT_END_NODES, R.REMIND_DEFAULT_START_NODES]));
		check("点掉一档 → 降序、逗号分隔、无空格（\"72,24,6,2\" 点掉 6 → \"72,24,2\"）",
			toggle("72,24,6,2", 6, D_END) === "72,24,2", toggle("72,24,6,2", 6, D_END));
		check("点上一档 → 按降序插进去（\"72,2\" 点 6 → \"72,6,2\"）",
			toggle("72,2", 6, D_END) === "72,6,2", toggle("72,2", 6, D_END));
		check("**全部取消 ⇒ 空串**（不是默认值）：开始方向 24/2 依次点掉",
			toggle("24,2", 24, D_START) === "2" && toggle("2", 2, D_START) === "",
			JSON.stringify([toggle("24,2", 24, D_START), toggle("2", 2, D_START)]));
		check("从空串（该方向关着）点回一档 → 只有那一档（不是默认全集）",
			toggle("", 24, D_START) === "24", toggle("", 24, D_START));
		check("写回格式永远归一：没有空格 / 中文逗号 / 重复档",
			["", "72,2", " 6 ， 2 ", "2,2,2", "坏的"].every((v) => /^$|^\d+(,\d+)*$/.test(toggle(v, 24, D_END)))
			&& toggle(" 6 ， 2 ", 24, D_END) === "24,6,2"
			&& toggle("2,2,2", 6, D_END) === "6,2",
			toggle(" 6 ， 2 ", 24, D_END));
		check("value 读坏了（\"坏的\"）时以默认档为基准再切换（与用户眼前那几颗胶囊一致）",
			toggle("坏的", 2, D_END) === "72,24,6", toggle("坏的", 2, D_END));
		check("node 不是正数 → 只归一化、不切换（脏参数不写坏档位）",
			toggle("72,24", 0, D_END) === "72,24" && toggle("72,24", "x", D_END) === "72,24",
			JSON.stringify([toggle("72,24", 0, D_END), toggle("72,24", "x", D_END)]));
		check("写回的串再解析 ⇒ 正好是点完之后该生效的档位（写回与判定不分叉；空串 ⇒ 空档）",
			remindNodesOf(toggle("72,24,6,2", 6, D_END), D_END).join(",") === "72,24,2"
			&& remindNodesOf(toggle("24,2", 24, D_START), D_START).join(",") === "2"
			&& remindNodesOf(toggle("2", 2, D_START), D_START).length === 0);
		check("宿主那份 ESM（lib/remind-core.mjs）里的胶囊函数与客户端产物**同一份源码**",
			typeof R.remindNodesToggleOf === "function"
			&& R.remindNodesToggleOf("72,24,6,2", 6, D_END) === toggle("72,24,6,2", 6, D_END)
			&& R.remindNodesToggleOf("2", 2, D_START) === "");

		// ② 设置页接线（静态）
		const compSrc = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		const styleSrc = readFileSync(path.join(REPO, "src", "client", "70-styles.js"), "utf8");
		check("胶囊行：结束提醒保留、开始提醒已注释（2026-10-28 搁置），可选集合直接取出厂常量（不另抄一份）",
			compSrc.includes('remindChipRow("end", "结束提醒", remindEndSavedText, REMIND_DEFAULT_END_NODES, "remindEndNodes"')
			&& compSrc.includes('remindChipRow("end", "结束提醒"') && /\/\/[^\n]*remindChipRow\([^\n]*开始提醒/.test(compSrc));
		check("文本框 / 预览 / 红框提示**全部删掉**（没有 remindNodeRow、没有\"解析为：\"、没有 aria-invalid）",
			!/remindNodeRow/.test(compSrc) && !/remindNodesEditOf/.test(compSrc)
			&& !compSrc.includes("解析为：") && !compSrc.includes("没识别出有效小时数")
			&& !/remindErrorColor/.test(compSrc) && !/aria-invalid/.test(compSrc)
			&& !/onBlur: onCommit/.test(compSrc) && !/maxLength/.test(compSrc));
		check("胶囊是 <button>：aria-pressed 报选中态、点击走 toggleRemindNode",
			compSrc.includes('"aria-pressed": on ? "true" : "false"')
			&& compSrc.includes('className: "gacha-cal-chip" + (on ? " gacha-cal-chip--on" : "")')
			&& compSrc.includes("onClick: () => toggleRemindNode(which, keyName, savedText, fallbackNodes, n)"));
		check("选中态直接来自判定侧口径（remindNodesOf；显式空串 ⇒ 一颗都不选中）",
			compSrc.includes("const nodes = remindNodesOf(remindNodesValue(which, savedText), fallbackNodes);"));
		check("点击写回走 remindNodesToggleOf（设置页不另写一份解析 / 归一化），键名按方向各写各的",
			compSrc.includes("const text = remindNodesToggleOf(base, node, fallbackNodes);")
			&& compSrc.includes("await commit(keyName, text);")
			&& !/commit\("remindEndNodes"/.test(compSrc) && !/commit\("remindStartNodes"/.test(compSrc));
		check("点击不被宿主往返吞掉：草稿优先显示 + 写入排成一条串行链（目标文本在点击时算好）",
			compSrc.includes("const remindNodesWriteChain = (0, react.useRef)(Promise.resolve());")
			&& compSrc.includes("remindNodesWriteChain.current = run.catch(() => {});")
			&& compSrc.includes('remindNodesDraft[which] === null ? String(savedText || "") : remindNodesDraft[which]'));
		check("宿主追上后草稿会让位（比较解析后的档位，空串写法差异不留住草稿）",
			compSrc.includes("const remindNodesKeyOf = (text, fallbackNodes) => remindNodesOf(text, fallbackNodes).join(\",\");"));
		check("两行不挤：标签与胶囊 8px、胶囊之间 6px、字号 12px（都在 remindChipRow 里）",
			(() => {
				const i = compSrc.indexOf("const remindChipRow = (");
				const chipSrc = i < 0 ? "" : compSrc.slice(i, i + 1600);
				return /gap: 8, flexWrap: "wrap"/.test(chipSrc)
					&& /gap: 6, flexWrap: "wrap"/.test(chipSrc)
					&& /fontSize: 12/.test(chipSrc);
			})());
		check("胶囊样式：圆角 999/小高度 + 选中=实色主题底配白字 / 未选中=灰描边配次级字色 + 两档 hover + cursor:pointer",
			/\.gacha-cal-chip\{[^}]*height:24px[^}]*border-radius:999px[^}]*color:var\(--dsw-alias-label-secondary[^}]*cursor:pointer/.test(styleSrc)
			&& /\.gacha-cal-chip\{[^}]*border:1px solid var\(--dsw-alias-border-l2/.test(styleSrc)
			&& /\.gacha-cal-chip--on\{[^}]*background:var\(--dsw-alias-state-business-primary[^}]*color:#fff/.test(styleSrc)
			&& /\.gacha-cal-chip:hover\{/.test(styleSrc)
			&& /\.gacha-cal-chip--on:hover\{/.test(styleSrc));
		check("逐游戏「提醒」列保持隐藏（SHOW_REMIND_COLUMN 仍为 false，本次不动）",
			/const SHOW_REMIND_COLUMN = false;/.test(compSrc));
	}

	// ── ⑫ 通知身份（可选 AUMID）：判定纯函数 4 组合 + 宿主两条路由 + 设置页按钮 ─────────────
	// 2026-10-28 需求：把"启用二游日历通知身份"做成**可选项**（设置页一个按钮）。
	// 这里钉五件事：
	//   ① 判定纯函数（remindIdentityOf）：只有「快捷方式存在 **且** AUMID 正确」才算启用，
	//      其余三种组合 + 脏探测结果一律回退 —（身份问题绝不能让提醒发不出去）；
	//   ①b 探测**按 AUMID 扫描开始菜单顶层 .lnk**（真机事故：改名重建失败后文件名还是旧的，
	//      按 `<当前名字>.lnk` 拼路径会找不到自己的身份 ⇒ 横幅退回「Windows PowerShell」）；
	//   ② 宿主两条路由（GET 读状态 / POST 建删）+ 非 Windows 的 `windows-only` 分支；
	//   ③ 快捷方式确实用 wscript.exe 当身份载体、无参数（不额外落文件）+ 内联 C# 写 AUMID + 注册表起名；
	//   ④ 设置页那一行（启用/移除按钮、GET 读 / POST 写、失败原因小字）。
	{
		const expected = "DshGachaCalendar.Reminder";
		const identityOf = (probe) => remindIdentityOf(probe, expected);
		// 4 种组合：存在 × AUMID 正确 / 错误（期望值固定 = 宿主常量）
		const combos = [
			{ probe: { exists: true, aumid: expected }, enabled: true, label: "快捷方式存在 + AUMID 正确 ⇒ 启用" },
			{ probe: { exists: true, aumid: "SomeoneElse.App" }, enabled: false, label: "快捷方式存在但 AUMID 是别的 ⇒ 不启用（回退）" },
			{ probe: { exists: false, aumid: null }, enabled: false, label: "快捷方式缺失 ⇒ 不启用（回退）" },
			// 这一条防"只看 AUMID、不看存在性"：残留的探测结果（系统里快捷方式已被删）不能算启用
			{ probe: { exists: false, aumid: expected }, enabled: false, label: "快捷方式缺失但 AUMID 正确 ⇒ 仍不启用（必须真的存在）" }
		];
		for (const c of combos) {
			const r = identityOf(c.probe);
			check(c.label,
				r.enabled === c.enabled && (c.enabled ? r.useAumid === expected : r.useAumid === null),
				JSON.stringify(r));
		}
		check("探测结果读坏（null / 空对象 / aumid 非字符串）⇒ 一律回退、不抛",
			identityOf(null).enabled === false && identityOf(null).useAumid === null
			&& identityOf({}).enabled === false
			&& identityOf({ exists: true, aumid: 123 }).enabled === false,
			JSON.stringify([identityOf(null), identityOf({}), identityOf({ exists: true, aumid: 123 })]));
		check("期望 AUMID 为空 / 非字符串 ⇒ 永远不启用（避免\"空 == 空\"误判）",
			remindIdentityOf({ exists: true, aumid: "" }, "").enabled === false
			&& remindIdentityOf({ exists: true, aumid: "x" }, null).enabled === false
			&& remindIdentityOf({ exists: true, aumid: "x" }, void 0).enabled === false);
		check("宿主那份 ESM（lib/remind-core.mjs）与客户端产物是**同一个判定**",
			typeof R.remindIdentityOf === "function"
			&& JSON.stringify(R.remindIdentityOf({ exists: true, aumid: expected }, expected)) === JSON.stringify(identityOf({ exists: true, aumid: expected }))
			&& R.remindIdentityOf({ exists: true, aumid: "x" }, expected).enabled === false);

		// ①b 按 AUMID 挑快捷方式（纯函数 notifyShortcutPickOf）—— 2026-10-28 真机教训的直接产物：
		//    用户改名后重建失败 ⇒ 文件还叫旧名字、配置是新名字。按 `<名字>.lnk` 找会漏掉自己的身份，
		//    所以只认 AUMID（名字只是文件名）。四条边界都在这里钉住。
		const candidates = [
			{ path: "C:\\…\\二游日历.lnk", aumid: "SomeoneElse.App" },
			{ path: "C:\\…\\旧名字.lnk", aumid: expected },
			{ path: "C:\\…\\另一个.lnk", aumid: expected }
		];
		check("notifyShortcutPickOf：命中（按 AUMID 认，旧名字的 .lnk 也能认出是我们那条）",
			typeof notifyShortcutPickOf === "function" && notifyShortcutPickOf(candidates, expected) === candidates[1],
			JSON.stringify(notifyShortcutPickOf(candidates, expected)));
		check("notifyShortcutPickOf：多个命中取**第一个**（多条我们自己的 .lnk 时行为确定）",
			notifyShortcutPickOf(candidates, expected).path === "C:\\…\\旧名字.lnk",
			notifyShortcutPickOf(candidates, expected).path);
		check("notifyShortcutPickOf：都不匹配 / 空数组 / 脏入参 ⇒ null（不抛）",
			notifyShortcutPickOf([{ path: "x.lnk", aumid: "SomeoneElse.App" }], expected) === null
			&& notifyShortcutPickOf([], expected) === null
			&& notifyShortcutPickOf([{ path: "x.lnk", aumid: "" }], expected) === null
			&& notifyShortcutPickOf(null, expected) === null
			&& notifyShortcutPickOf(candidates, "") === null
			&& notifyShortcutPickOf(candidates, void 0) === null);
		check("宿主那份 ESM（lib/remind-core.mjs）导出并复用**同一个**挑选函数",
			typeof R.notifyShortcutPickOf === "function"
			&& R.notifyShortcutPickOf(candidates, expected) === candidates[1]
			&& notifyShortcutPickOf({}, expected) === R.notifyShortcutPickOf({}, expected));

		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		const compSrc = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		const aumidHits = hostSrc.match(/DshGachaCalendar\.Reminder/g) || [];

		check("AUMID 在宿主里**只写一份**（NOTIFY_AUMID），toast 脚本的 $Aumid 由运行时传进去（不写死第二份）",
			/const NOTIFY_AUMID = "DshGachaCalendar\.Reminder";/.test(hostSrc)
			&& aumidHits.length === 1
			&& /\$Aumid = " \+ psQuote\(aumid \|\| POWERSHELL_AUMID\)/.test(hostSrc),
			String(aumidHits.length));
		// import 漏一项不会在静态检查里红，只会在真机上 ReferenceError（本轮实测踩过）——
		// 所以这里显式核对宿主 import 列表里有判定函数。
		check("宿主 import 列表里有 remindIdentityOf（漏了 = 运行时 ReferenceError）",
			(() => {
				const m = /import \{([\s\S]*?)\} from "\.\/remind-core\.mjs"/.exec(hostSrc);
				return !!m && /\bremindIdentityOf\b/.test(m[1]);
			})());

		check("两条路由都注册在 webServer（同一 prefix、同一个 handler 按 method 分流）",
			/const NOTIFY_IDENTITY_PREFIX = "\/api\/gacha-calendar-notify-identity";/.test(hostSrc)
			&& /path: NOTIFY_IDENTITY_PREFIX,\s*handler: \(req, res\) => notifyIdentityHandler\(req, res, ctx, config\)/.test(hostSrc)
			&& /if \(req\.method === "GET" \|\| req\.method === "HEAD"\)/.test(hostSrc)
			&& /if \(req\.method !== "POST"\)/.test(hostSrc));
		check("GET 返回 { enabled, name, aumid, shortcutPath, iconPath }（字段名与设置页/预留图标接口对齐）",
			/enabled,\s*name: shownName,\s*aumid: NOTIFY_AUMID,\s*shortcutPath,\s*iconPath: notifyIconPath\(\)/.test(hostSrc));
		check("GET 的 enabled 用「开始菜单里 AUMID 正确的那条存在」判定（探测 → remindIdentityOf → 落盘记录）",
			/function identityStateOf\(probe, cfgName\) \{[\s\S]{0,300}?remindIdentityOf\(probe, NOTIFY_AUMID\)\.enabled === true/.test(hostSrc)
			&& /sendJson\(res, 200, identityBodyOf\(cached\.state, cfgName\)\)/.test(hostSrc));
		check("GET 的 name **优先用记录里的快捷方式名**，没有才用配置名（改名重建失败时显示真实生效的名字）",
			/const detected = enabled && typeof state\.name === "string" \? state\.name\.trim\(\) : "";/.test(hostSrc)
			&& /const shownName = detected === "" \? cfgName : notifyNameOf\(detected\);/.test(hostSrc)
			&& /shortcutPath = enabled && typeof state\.shortcutPath === "string"/.test(hostSrc));
		check("POST 只认布尔 enabled（脏值 400，不能被当成\"启用\"去改用户开始菜单）",
			/typeof parsed\.enabled !== "boolean"/.test(hostSrc) && /error: "enabled-must-be-boolean"/.test(hostSrc));
		check("非 Windows ⇒ { ok: false, error: \"windows-only\" }（同一句也用于 PowerShell 找不到时）",
			/process\.platform !== "win32"/.test(hostSrc)
			&& /error: "windows-only"/.test(hostSrc));
		check("失败是**结构化错误**（{ ok:false, error } 交回设置页；没权限 / C# 编译失败都走这条）",
			/ok: false, error: String\(r\.error \|\| "shortcut-failed"\)/.test(hostSrc));

		check("建快捷方式：wscript.exe 当身份载体、**不带参数**（不额外落文件）",
			/wscript\.exe/.test(hostSrc)
			&& /\$Sc = \$Shell\.CreateShortcut\(\$Lnk\)/.test(hostSrc)
			&& /\$Sc\.TargetPath = \$Target/.test(hostSrc)
			&& !/\$Sc\.Arguments/.test(hostSrc)
			&& !/remind-run\.vbs/.test(hostSrc));
		check("AUMID 走内联 C# IPropertyStore（PROPVARIANT 显式 Size = 24）",
			/IPropertyStore/.test(hostSrc) && /Size = 24/.test(hostSrc)
			&& /9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3/.test(hostSrc));
		check("写 HKCU\\Software\\Classes\\AppUserModelId\\<AUMID> 的 DisplayName（起名用）",
			hostSrc.includes("HKCU:\\\\Software\\\\Classes\\\\AppUserModelId\\\\") && /DisplayName/.test(hostSrc));
		check("启用后回读 AUMID 确认（Save() 成功 ≠ AUMID 写进去了）",
			/\$ReadBack = \[GachaNotifyShortcut\]::Get\(\$Lnk\)/.test(hostSrc) && /\$ReadBack -ne \$Aumid/.test(hostSrc));
		check("停用：**按 AUMID** 删开始菜单快捷方式（不按文件名 —— 改名失败时按名字删不掉），注册表键保留并写明理由",
			/function notifyIdentityDisableScript\(\)[\s\S]{0,600}?notifyAumidCleanupLines\(\)/.test(hostSrc)
			&& (() => {
				const i = hostSrc.indexOf("function notifyIdentityDisableScript(");
				const body = i < 0 ? "" : hostSrc.slice(i, hostSrc.indexOf("\n}", i));
				// 停用脚本里**不许**再出现按名字拼路径 / 删名字：判据只有 AUMID
				return body.length > 0 && !body.includes("notifyShortcutPath") && !/Remove-Item -LiteralPath \$Lnk/.test(body);
			})()
			&& /注册表键/.test(hostSrc) && /保留/.test(hostSrc));
		check("图标是**预留接口**：NOTIFY_SHORTCUT_ICON + 「项目有正式 .ico 后改这里即可」注释在常量之前",
			hostSrc.includes("const NOTIFY_SHORTCUT_ICON = \"%SystemRoot%\\\\System32\\\\timedate.cpl,0\";")
			&& hostSrc.indexOf("项目有正式 .ico 后改这里即可") >= 0
			&& hostSrc.indexOf("项目有正式 .ico 后改这里即可") < hostSrc.indexOf("const NOTIFY_SHORTCUT_ICON"));

		check("toast 的 AUMID 有**启用 / 回退**两条路径，且每轮只读一次缓存（没有缓存才探测一次；name 同一处解析）",
			/async function notifyToastTargetOf\(name\)[\s\S]{0,1200}?const cached = readIdentityState\(\);[\s\S]{0,600}?remindIdentityOf\(identityProbeOfState\(state\), NOTIFY_AUMID\)[\s\S]{0,300}?aumid: enabled \? NOTIFY_AUMID : POWERSHELL_AUMID/.test(hostSrc)
			&& /const target = await notifyToastTargetOf\(plain\.notifyName\);/.test(hostSrc)
			&& /sendToastScript\(toastScriptOf\(title, lines, target\.aumid, target\.name\)\)/.test(hostSrc)
			&& /function toastScriptOf\(title, lines, aumid, appName\)/.test(hostSrc));
		check("身份探测**永不抛**（探测失败 = 当未启用，回退 PowerShell）",
			/async function notifyIdentityProbe\(\)[\s\S]{0,4000}?catch \(err\) \{[\s\S]{0,200}?exists: false, aumid: null/.test(hostSrc)
			&& /async function notifyIdentityProbe\(\)[\s\S]{0,200}?process\.platform !== "win32"/.test(hostSrc));
		// 2026-10-28 真机修复：探测**按 AUMID 扫描开始菜单顶层 .lnk**，不再拿 `<当前名字>.lnk` 拼路径
		// （改名重建失败时文件名还是旧的 ⇒ 按名字找不到自己的身份 ⇒ 静默回退 PowerShell）。
		check("探测按 **AUMID 扫描开始菜单顶层** .lnk（`notifyShortcutFiles` + 一次批量读 + 按 AUMID 挑）",
			/function notifyShortcutFiles\(\)[\s\S]{0,400}?readdirSync\(dir\)/.test(hostSrc)
			&& hostSrc.includes("/\\.lnk$/i")
			&& /function notifyIdentityProbeScript\(lnkPaths\)/.test(hostSrc)
			&& /notifyShortcutPickOf\(entries, NOTIFY_AUMID\)/.test(hostSrc)
			&& (() => {
				const i = hostSrc.indexOf("async function notifyIdentityProbe(");
				const body = i < 0 ? "" : hostSrc.slice(i, hostSrc.indexOf("\n}", i));
				// 探测函数里**一个** notifyShortcutPath 都不许有：路径只用于"建"，不用于"认"
				return body.length > 0 && !body.includes("notifyShortcutPath");
			})(),
			"探测里仍按文件名找，或没走 notifyShortcutPickOf");
		check("探测先过滤：目录里没有 .lnk 就**短路**（默认路径不启动 PowerShell；设置页打开不卡）",
			/const lnks = notifyShortcutFiles\(\);\s*if \(lnks\.length === 0\) return \{ exists: false, aumid: null, error: null \};/.test(hostSrc));
		check("AUMID 读取是**一次 PowerShell 批量读完**（候选路径一次性传进去，不是每个文件起一个进程）",
			(hostSrc.match(/notifyIdentityProbeScript\(lnks\)/g) || []).length === 1
			&& /function notifyIdentityProbeScript\(lnkPaths\)/.test(hostSrc)
			&& /"\$Paths = " \+ psArray\(lnkPaths\)/.test(hostSrc)
			&& /foreach \(\$P in \$Paths\)/.test(hostSrc),
			String((hostSrc.match(/notifyIdentityProbeScript\(lnks\)/g) || []).length));

		check("设置页有「通知身份」一行 + 启用/移除按钮（当前身份两种文案都在）",
			compSrc.includes('children: "通知身份"')
			&& /notifyIdentity\.enabled \? "移除" : "启用"/.test(compSrc)
			&& compSrc.includes("当前：")
			&& compSrc.includes("PowerShell（默认）"));
		check("设置页状态读 GET（默认 GET；不在渲染里轮询）",
			compSrc.includes('const NOTIFY_IDENTITY_API = "/api/gacha-calendar-notify-identity";')
			&& /fetch\(NOTIFY_IDENTITY_API, \{ headers: \{ Accept: "application\/json" \} \}\)/.test(compSrc)
			&& /react\.useEffect\)\(\(\) => \{\s*let alive = true;/.test(compSrc));
		check("设置页按钮 POST { enabled, name }（name 每次都带；失败原因写小字、不弹窗）",
			/method: "POST"/.test(compSrc)
			&& /body: JSON\.stringify\(\{ enabled: enabled === true, name: notifyNameOf\(name\) \}\)/.test(compSrc)
			&& compSrc.includes("启用失败：") && compSrc.includes("移除失败：")
			&& !/alert\(/.test(compSrc));
		check("设置页把宿主错误码翻成人话（windows-only ⇒ 「仅 Windows 可用」）",
			/if \(text === "windows-only"\) return "仅 Windows 可用";/.test(compSrc));
	}

	// ── ⑬ 发送测试通知：正文纯函数 + 宿主 POST 路由（同口径守卫、不写状态）+ 设置页按钮 ──────
	// 2026-10-28 需求：设置页「通知身份」旁加「发送测试通知」，点了立刻弹一条系统通知。
	// 这里钉住六件事（任何一条悄悄坏掉，用户看到的是"点了没反应"或"提醒不响了"）：
	//   ① 正文纯函数（remindTestToastOf）：标题固定、正文三行、发送者随身份、时间到秒（本机时区）；
	//   ② 宿主路由存在且注册（前缀常量 + handler 挂到 webServer）；
	//   ③ 守卫与 /api/gacha-calendar-notify-identity **同口径**（isLoopback + 拒绝 cross-site + 只 POST）；
	//   ④ 与真实提醒**隔离**：路由里没有任何状态文件读写，也不读 lastData / 不跑判定；
	//   ⑤ 复用而不是复制：身份走 notifyIdentityProbe + remindIdentityOf（收敛在 notifyToastTargetOf），
	//      发送走现有的 toastScriptOf + sendToastScript；
	//   ⑥ 设置页：POST 同一个路径字面量、busy 文案、成功/失败两行小字、不弹窗不轮询。
	{
		// ① 纯函数：时刻显式传入；"时间"按**本机时区**格式化 ⇒ 断言用同一个 Date 现算，
		//    CI 跑 UTC、开发机跑 +08 都必须绿（与文件开头的时间口径一致）。
		const pad2 = (n) => (n < 10 ? "0" : "") + n;
		const localClock = (ts) => {
			const d = new Date(ts);
			return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
				+ " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
		};
		const appToast = remindTestToastOf(NOW, "app");
		const psToast = remindTestToastOf(NOW, "powershell");
		check("测试通知标题 = 「二游日历 · 通知测试」", appToast.title === "二游日历 · 通知测试", appToast.title);
		check("正文**三行**（发送者 / 时间 / 说明）",
			Array.isArray(appToast.lines) && appToast.lines.length === 3, JSON.stringify(appToast.lines));
		check("发送者行：identity \"app\" ⇒ 「二游日历」/ 其它 ⇒ 「Windows PowerShell」",
			appToast.lines[0] === "发送者：二游日历"
			&& psToast.lines[0] === "发送者：Windows PowerShell"
			&& remindTestToastOf(NOW, void 0).lines[0] === "发送者：Windows PowerShell",
			JSON.stringify([appToast.lines[0], psToast.lines[0], remindTestToastOf(NOW, void 0).lines[0]]));
		check("时间行 = yyyy-MM-dd HH:mm:ss（本机时区，与 Date 现算逐字一致）",
			appToast.lines[1] === "时间：" + localClock(NOW), appToast.lines[1]);
		check("第三行是「看到这条说明系统通知链路是通的」",
			appToast.lines[2] === "看到这条说明系统通知链路是通的", appToast.lines[2]);
		check("时刻非法 ⇒ 不抛、时间行留空（坏在时间上也不该拖垮设置页）",
			(() => {
				const t = remindTestToastOf(Number.NaN, "app");
				return t.lines.length === 3 && t.lines[1] === "时间：";
			})());
		check("宿主那份 ESM（lib/remind-core.mjs）与客户端是**同一个文案函数**",
			typeof R.remindTestToastOf === "function"
			&& JSON.stringify(R.remindTestToastOf(NOW, "app")) === JSON.stringify(appToast));

		// ②-⑤ 宿主静态
		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		const compSrc = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		const bodyOf = (name) => {
			const i = hostSrc.indexOf("async function " + name + "(");
			const j = i < 0 ? -1 : hostSrc.indexOf("\n}", i);
			return i < 0 ? "" : (j < 0 ? hostSrc.slice(i) : hostSrc.slice(i, j));
		};
		const testBody = bodyOf("notifyTestHandler");
		const identityBody = bodyOf("notifyIdentityHandler");
		check("守卫自身没瞎：两个 handler 都定位到了",
			testBody.length > 0 && identityBody.length > 0, `test=${testBody.length} identity=${identityBody.length}`);
		check("路由常量存在 + 已注册到 webServer",
			/const NOTIFY_TEST_PREFIX = "\/api\/gacha-calendar-notify-test";/.test(hostSrc)
			&& /path: NOTIFY_TEST_PREFIX,\s*handler: \(req, res\) => notifyTestHandler\(req, res, ctx, config\)/.test(hostSrc));
		// 逐字比对两条守卫：不是"看起来相似"，而是与 identity 路由同一行文本（同口径）
		const GUARD_LOOPBACK = 'if (!isLoopback(req)) { sendJson(res, 403, { error: "loopback-only" }); return; }';
		const GUARD_CROSS = 'if (String(req.headers?.["sec-fetch-site"] || "") === "cross-site") {';
		check("守卫与 /api/gacha-calendar-notify-identity **同口径**（isLoopback + 拒绝 cross-site，逐字相同）",
			testBody.includes(GUARD_LOOPBACK) && identityBody.includes(GUARD_LOOPBACK)
			&& testBody.includes(GUARD_CROSS) && identityBody.includes(GUARD_CROSS)
			&& testBody.includes('sendJson(res, 403, { error: "cross-site-not-allowed" });'));
		check("只接受 POST（其它方法 405），**不提供**读状态的能力",
			testBody.includes('if (req.method !== "POST") { sendJson(res, 405, { error: "method-not-allowed" }); return; }')
			&& !/req\.method === "GET"/.test(testBody));
		check("非 Windows ⇒ { ok: false, error: \"windows-only\" }（与 identity 路由同一句）",
			/process\.platform !== "win32"[\s\S]{0,120}?ok: false, error: "windows-only"/.test(testBody));
		check("**不写状态**：路由里没有状态文件读写（writeRemindState / readRemindState / host-state.json / appendFileSync）",
			!/writeRemindState|readRemindState|remindStatePath|host-state\.json|appendFileSync|writeFileSync/.test(testBody)
			&& !/lastData/.test(testBody)
			&& !/remindTickOf|remindStateOf|remindItemsOf/.test(testBody),
			testBody.slice(0, 120));
		check("身份选择**复用**现有判定（缓存 → identityProbeOfState → remindIdentityOf，收敛在 notifyToastTargetOf 一处）",
			/async function notifyToastTargetOf\(name\)[\s\S]{0,1200}?remindIdentityOf\(identityProbeOfState\(state\), NOTIFY_AUMID\)/.test(hostSrc)
			&& /const target = await notifyToastTargetOf\(appName\);/.test(testBody)
			// 真实提醒那一轮走的也是同一个出口（判定只有一处，没有第二套 AUMID 逻辑）
			&& /const target = await notifyToastTargetOf\(plain\.notifyName\);[\s\S]{0,400}?sendToastScript\(toastScriptOf\(title, lines, target\.aumid, target\.name\)\)/.test(hostSrc));
		check("发送复用**现有的** toast 发送器（toastScriptOf + sendToastScript），不另写一套",
			/function toastScriptOf\(title, lines, aumid, appName\)/.test(hostSrc)
			&& /function sendToastScript\(script\)/.test(hostSrc)
			&& /const sent = await sendToastScript\(toastScriptOf\(title, lines, target\.aumid, target\.name\)\);/.test(testBody));
		check("正文来自 core 的纯函数 remindTestToastOf（宿主不自己拼三行；应用名也一起传进去）",
			/\{ title, lines \} = remindTestToastOf\(Date\.now\(\), target\.identity, target\.name\)/.test(testBody)
			&& (() => {
				const m = /import \{([\s\S]*?)\} from "\.\/remind-core\.mjs"/.exec(hostSrc);
				return !!m && /\bremindTestToastOf\b/.test(m[1]);
			})());
		check("响应形状：成功 { ok:true, aumid, identity, name, detail } / 失败 { ok:false, error }",
			/ok: true, aumid: target\.aumid, identity: target\.identity, name: target\.name, detail: String\(sent\.detail \|\| ""\)/.test(testBody)
			&& /ok: false, error: String\(sent\.detail \|\| "send-failed"\)/.test(testBody));

		// ⑥ 设置页
		const hostPath = (/const NOTIFY_TEST_PREFIX = "([^"]+)";/.exec(hostSrc) || [])[1];
		const clientPath = (/const NOTIFY_TEST_API = "([^"]+)";/.exec(compSrc) || [])[1];
		check("前后端 POST 路径字面量**一致**（改一处忘另一处 = 按钮永远 404）",
			hostPath === "/api/gacha-calendar-notify-test" && clientPath === hostPath,
			String(hostPath) + " / " + String(clientPath));
		const sendFnAt = compSrc.indexOf("async function sendNotifyTest() {");
		const sendFnEnd = sendFnAt < 0 ? -1 : compSrc.indexOf("\n\t\t}", sendFnAt);
		const sendFn = sendFnAt < 0 ? "" : (sendFnEnd < 0 ? compSrc.slice(sendFnAt) : compSrc.slice(sendFnAt, sendFnEnd));
		check("发送函数只 POST（不带 body、不轮询、不弹窗）",
			/fetch\(NOTIFY_TEST_API, \{ method: "POST" \}\)/.test(sendFn)
			&& !/setInterval|setTimeout/.test(sendFn)
			&& !/alert\(/.test(sendFn),
			String(sendFn.length));
		const identityRowAt = compSrc.indexOf('children: "通知身份"');
		const testBtnAt = compSrc.indexOf('children: notifyTestBusy ? "发送中…" : "发送测试通知"');
		check("按钮「发送测试通知」就在「通知身份」那一行（同一行按钮组里，不用翻页找）",
			identityRowAt >= 0 && testBtnAt > identityRowAt && testBtnAt - identityRowAt < 1600,
			`identityRow=${identityRowAt} testBtn=${testBtnAt}`);
		check("busy 期间按钮禁用 + 文字变「发送中…」",
			/disabled: notifyTestBusy,/.test(compSrc)
			&& /children: notifyTestBusy \? "发送中…" : "发送测试通知"/.test(compSrc));
		check("成功时不显示任何提示文字（只有失败才显示原因）",
			compSrc.includes('notifyTest && !notifyTest.ok ?'));
		check("失败文案「发送失败：<原因>」（宿主错误码翻人话，不弹窗）",
			compSrc.includes('"发送失败：" + notifyIdentityErrorText'));
		check("按钮点击走 sendTestNotify（POST 一次就结束，不轮询）",
			/onClick: sendTestNotify,/.test(compSrc));
	}

	// ── ⑭ 通知身份**名**可自定义（`notifyName`）：清洗纯函数 + 三处齐 + 路由带 name + 设置页一行 ──
	// 2026-10-28 需求：应用名不再写死「二游日历」，改成设置项 `notifyName`（默认仍是「二游日历」）。
	// 这里钉五件事：
	//   ① 清洗（notifyNameOf，纯函数）：非法文件名字符换空格、首尾点/空白去掉、空 ⇒ 默认、
	//      超长按码点截到 40 字、Windows 保留设备名 ⇒ 默认；宿主 / core / 设置页共用这一处；
	//   ② 配置键**三处齐**（DEFAULT_SETTINGS / 引擎 CONFIG_KEYS / 宿主 schema 且 .volatile()）；
	//   ③ 路由：GET 带 name；POST 的 name 决定快捷方式**文件名** + Description + DisplayName，
	//      启用时**先删旧再建**，且只删 AUMID 等于我们的那条 .lnk（不误删别人的）；
	//   ④ toast 的 attribution 行 / 测试通知的发送者行都吃传进来的 name（缺省仍「二游日历」）；
	//   ⑤ 设置页那一行：只有一个输入框、绑定 notifyName、失焦/回车提交**清洗后**的值、没有那两句说明文字。
	{
		const { notifyNameOf } = T;
		check("notifyNameOf 在客户端产物里（设置页与宿主共用同一份源码）", typeof notifyNameOf === "function");
		check("宿主那份 ESM（lib/remind-core.mjs）也导出同一个清洗函数，行为逐项一致",
			typeof R.notifyNameOf === "function"
			&& ["", "  ", "a/b", "名字", "x".repeat(100), "CON", void 0].every((v) => R.notifyNameOf(v) === notifyNameOf(v)),
			JSON.stringify(["a/b", "x".repeat(100), "CON"].map((v) => R.notifyNameOf(v))));
		check("默认名 = 「二游日历」（非字符串 / 空 / 全空白 / 全是非法字符都回落它）",
			notifyNameOf(void 0) === "二游日历" && notifyNameOf(null) === "二游日历" && notifyNameOf(123) === "二游日历"
			&& notifyNameOf("") === "二游日历" && notifyNameOf("   ") === "二游日历"
			&& notifyNameOf("\\/:*?\"<>|") === "二游日历",
			JSON.stringify([notifyNameOf(void 0), notifyNameOf(null), notifyNameOf(123), notifyNameOf(""), notifyNameOf("   "), notifyNameOf('\\/:*?"<>|')]));
		check("合法名字原样保留（中文 / 半角空格 / 全角标点都不动）",
			notifyNameOf("二游日历") === "二游日历" && notifyNameOf("我的 日历") === "我的 日历" && notifyNameOf("A：B") === "A：B",
			JSON.stringify([notifyNameOf("二游日历"), notifyNameOf("我的 日历"), notifyNameOf("A：B")]));
		check("非法文件名字符与控制字符 ⇒ 换成空格，再压空白、去首尾（\\ / : * ? \" < > | + 换行 / 制表）",
			notifyNameOf("a/b:c*d?e\"f<g>h|i") === "a b c d e f g h i"
			&& notifyNameOf("二游/日历") === "二游 日历"
			&& notifyNameOf("  a\nb\tc  ") === "a b c",
			JSON.stringify([notifyNameOf('a/b:c*d?e"f<g>h|i'), notifyNameOf("二游/日历"), notifyNameOf("  a\nb\tc  ")]));
		check("首尾的点也去掉（Windows 文件名不许以点结尾，`名字..lnk` 也难看）",
			notifyNameOf("...名字...") === "名字" && notifyNameOf(" 名字 ") === "名字",
			JSON.stringify([notifyNameOf("...名字..."), notifyNameOf(" 名字 ")]));
		check("超长截断到 40 字（按**码点**切，emoji 不会被切成半个代理对）",
			notifyNameOf("字".repeat(80)) === "字".repeat(40)
			&& Array.from(notifyNameOf("🎮".repeat(60))).length === 40
			&& !/[\uD800-\uDBFF]$/.test(notifyNameOf("🎮".repeat(60))),
			String(Array.from(notifyNameOf("🎮".repeat(60))).length));
		check("Windows 保留设备名（CON / NUL / COM1 …）⇒ 默认名（`CON.lnk` 根本建不出来）",
			notifyNameOf("CON") === "二游日历" && notifyNameOf("nul") === "二游日历"
			&& notifyNameOf("COM1") === "二游日历" && notifyNameOf("CONSOLE") === "CONSOLE",
			JSON.stringify([notifyNameOf("CON"), notifyNameOf("nul"), notifyNameOf("COM1"), notifyNameOf("CONSOLE")]));

		// ② 配置键三处齐
		check("DEFAULT_SETTINGS.notifyName = 「二游日历」（10-config.js）", DEFAULT_SETTINGS.notifyName === "二游日历", String(DEFAULT_SETTINGS.notifyName));
		{
			const ehText = readFileSync(path.join(REPO, "src", "client", "engine-head.js"), "utf8");
			const ci = ehText.indexOf("const CONFIG_KEYS = [");
			const cfgBlock = ci >= 0 ? ehText.slice(ci, ehText.indexOf("];", ci)) : "";
			const cfgKeys = [...cfgBlock.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]);
			check("引擎 CONFIG_KEYS 含 notifyName（漏了 = 设置页写了、面板与宿主读不到）", cfgKeys.includes("notifyName"), cfgKeys.join(","));
		}
		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		check("宿主 schema 有 notifyName: z.string().default(\"二游日历\").volatile()",
			/notifyName: z\.string\(\)\.default\("二游日历"\)\.volatile\(\)/.test(hostSrc));
		check("宿主 import 列表里有 notifyNameOf（漏了 = 运行时 ReferenceError）",
			(() => {
				const m = /import \{([\s\S]*?)\} from "\.\/remind-core\.mjs"/.exec(hostSrc);
				return !!m && /\bnotifyNameOf\b/.test(m[1]);
			})());

		// ③ 路由带 name：GET 读记录（name 优先用真实快捷方式名）/ POST 的 name 决定文件名、Description、DisplayName
		check("GET 的 name 从配置读并清洗（空 / 非法 ⇒ 默认「二游日历」），但**记录里的快捷方式名优先**",
			/const cfgName = notifyNameOf\(configValueOf\(liveConfigOf\(ctx, fallbackConfig\), "notifyName"\)\);/.test(hostSrc)
			&& /const shownName = detected === "" \? cfgName : notifyNameOf\(detected\);/.test(hostSrc)
			&& /name: shownName,/.test(hostSrc));
		check("POST 的 name：body 里有就用 body（设置页改完名字可立刻重建），否则用配置",
			/const name = notifyNameOf\(typeof parsed\.name === "string" \? parsed\.name : cfgName\);/.test(hostSrc));
		check("快捷方式文件名 = `<清洗后的 name>.lnk`（notifyShortcutPath 只按 name 拼路径）",
			/function notifyShortcutPath\(name\) \{\s*return path\.join\(notifyShortcutDir\(\), notifyNameOf\(name\) \+ "\.lnk"\);/.test(hostSrc));
		check("Description 与注册表 DisplayName 都用传进来的 $Name（不再写死「二游日历」）",
			/\$Sc\.Description = \$Name \+ /.test(hostSrc)
			&& /New-ItemProperty -Path \$Key -Name 'DisplayName' -Value \$Name -PropertyType String -Force/.test(hostSrc));
		check("启用时**先删旧的、再建新的**（删的动作出现在 CreateShortcut 之前）",
			(() => {
				const i = hostSrc.indexOf("function notifyIdentityEnableScript(");
				const body = i < 0 ? "" : hostSrc.slice(i, hostSrc.indexOf("\n}", i));
				const atRemove = body.indexOf("notifyAumidCleanupLines()");
				const atCreate = body.indexOf("$Shell.CreateShortcut($Lnk)");
				return atRemove >= 0 && atCreate > atRemove;
			})(),
			"没找到删除 / 创建语句");
		check("只删**我们自己**那条：判据是 AUMID 相等（不是文件名）⇒ 别人的 .lnk 一律不碰",
			/\$OldId = \$null[\s\S]{0,200}?if \(\$OldId -eq \$Aumid\)[\s\S]{0,120}?Remove-Item -LiteralPath \$Old\.FullName -Force/.test(hostSrc));
		check("名字被别人的快捷方式占了 ⇒ **不覆盖**、**一个文件都不动**，回结构化错误 shortcut-name-taken",
			(() => {
				const i = hostSrc.indexOf("function notifyIdentityEnableScript(");
				const body = i < 0 ? "" : hostSrc.slice(i, hostSrc.indexOf("\n}", i));
				const atTaken = body.indexOf("if ($Taken -ne $Aumid) { throw 'shortcut-name-taken' }");
				const atRemove = body.indexOf("notifyAumidCleanupLines()");
				// 占用检查必须在删除循环**之前**：否则"旧名字已删、新名字又建不出来"⇒ 用户两头空
				return atTaken >= 0 && atRemove > atTaken;
			})(),
			"没找到占用检查 / 顺序不对");

		// ④ 署名行 / 发送者行都吃传进来的 name（缺省值仍是「二游日历」）
		check("toast 的 attribution 用传入的 name：$AppName = psQuote(app)，app = notifyNameOf(appName)",
			/function toastScriptOf\(title, lines, aumid, appName\) \{[\s\S]{0,300}?const app = notifyNameOf\(appName\);/.test(hostSrc)
			&& /\$AppName = " \+ psQuote\(app\)/.test(hostSrc)
			&& /'<text placement=\\"attribution\\">' \+ \(& \$Esc \$AppName\)/.test(hostSrc));
		check("真实提醒的文案函数收 name（宿主传 target.name；缺省仍是「二游日历」）",
			/remindToastOf\(notify, now, target\.name\)/.test(hostSrc)
			&& remindToastOf({ side: "gacha", kind: "end", T: NOW + H }, NOW, "我的日历").title === "即将结束 · 我的日历"
			&& remindToastOf({ side: "gacha", kind: "end", T: NOW + H }, NOW).title === "即将结束 · 二游日历"
			&& JSON.stringify(remindToastOf({ gameId: "g1", gameName: "游戏甲", side: "gacha", kind: "end", T: NOW + H }, NOW)) ===
				JSON.stringify(remindToastOf({ gameId: "g1", gameName: "游戏甲", side: "gacha", kind: "end", T: NOW + H }, NOW, "别的名字")),
			remindToastOf({ side: "gacha", kind: "end", T: NOW + H }, NOW, "我的日历").title);
		check("测试通知的发送者行跟着 name 走（identity=app ⇒ 传入名；回退 PowerShell 时不变）",
			remindTestToastOf(NOW, "app", "我的日历").lines[0] === "发送者：我的日历"
			&& remindTestToastOf(NOW, "app").lines[0] === "发送者：二游日历"
			&& remindTestToastOf(NOW, "powershell", "我的日历").lines[0] === "发送者：Windows PowerShell"
			&& R.remindTestToastOf(NOW, "app", "我的日历").lines[0] === "发送者：我的日历",
			JSON.stringify([remindTestToastOf(NOW, "app", "我的日历").lines[0], remindTestToastOf(NOW, "app").lines[0]]));

		// ⑤ 设置页那一行
		const compSrc = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		const rowAt = compSrc.indexOf("// ── 通知身份（可选）：**一行**");
		const rowEnd = compSrc.indexOf("// ── 实验特性开关", rowAt);
		const row = rowAt < 0 || rowEnd < 0 ? "" : compSrc.slice(rowAt, rowEnd);
		check("设置页「通知身份」那一行能定位到（守卫自身没瞎）", row.length > 0, String(row.length));
		{
			const inputs = row.match(/\("input", \{/g) || [];
			check("整行**只有一个**输入框（不拆成两个、不额外加行）", inputs.length === 1, String(inputs.length));
		}
		check("输入框绑定 notifyName：受控值是清洗后的已保存值 + 本地草稿（value: notifyNameShown）",
			/value: notifyNameShown,/.test(row) && /onChange: \(e\) => setNotifyNameDraft\(e\.target\.value\)/.test(row));
		check("失焦提交、回车也提交（回车 = 先 blur，走同一条 commitNotifyName，不会提交两次）",
			/onBlur: \(\) => \{ void commitNotifyName\(\); \}/.test(row)
			&& /onKeyDown: \(e\) => \{ if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); e\.currentTarget\.blur\(\); \} \}/.test(row));
		check("提交的是**清洗后的值**（先过 notifyNameOf 再 commit(\"notifyName\", …)；空 ⇒ 由它兜默认）",
			/const next = notifyNameOf\(notifyNameDraft === null \? notifyNameSaved : notifyNameDraft\);/.test(compSrc)
			&& /await commit\("notifyName", next\);/.test(compSrc));
		check("已启用时改名**顺便重建**快捷方式（POST { enabled:true, name }，先删旧再建）",
			/if \(notifyIdentity && notifyIdentity\.enabled\) \{[\s\S]{0,400}?await writeNotifyIdentity\(true, next\)/.test(compSrc));
		check("窄输入框约 110px + 整行 flexWrap（720px 卡片放得下，窄窗口允许换行）",
			/width: 110/.test(row) && /flexWrap: "wrap"/.test(row));
		check("那两句说明文字**已删掉**、信息挪进按钮 title",
			!compSrc.includes("更改系统通知的发送者为") && !compSrc.includes("需要在开始菜单创建无害的快捷方式文件")
			&& compSrc.includes("title: \"更改系统通知的发送者：会在开始菜单建一条无害的快捷方式（可随时移除）\"")
			&& compSrc.includes("title: \"立刻弹一条系统通知，确认通知链路通不通\""));
		check("状态文字保留（「当前：…」两种文案都在），且显示的是 GET 回来的名字（探测到的真实名字，缺省配置名）",
			row.includes("当前：") && row.includes("PowerShell（默认）") && /notifyIdentity\.enabled \? notifyIdentity\.name/.test(row));
	}

	// ── ⑮ 通知身份状态缓存（identity.json）：设置页 / 提醒轮次的 1 秒瓶颈修复 ────────────────
	// 2026-10-28 用户报「设置页加载慢（约 1 秒）」：`GET /api/gacha-calendar-notify-identity` 每次都要
	// 起一次 PowerShell 批量读开始菜单所有 .lnk 的 AUMID（实测 29 个 lnk ≈1 秒），设置页挂载就卡在
	// 「读取中…」；提醒轮次也每 30 分钟白付一次。修法：探测结果落盘 identity.json，GET / 提醒轮次
	// 先读文件（毫秒级）；只有"没有文件 / 字段不全 / 读坏"才探测一次并写回；超过 24h 或缓存说启用而
	// 快捷方式已被手工删掉时，**本次仍回文件内容**、只在后台补探一次纠正。这里钉四件事：
	//   ① 纯函数 notifyIdentityCacheOf：没有文件 / 新鲜 / 过期 / 字段不全 / 脏值；
	//   ② identity.json 的**原子写**（tmp → rename）与三个写点（GET 慢路径 / POST 成功 / 后台刷新）；
	//   ③ **GET 毫秒路径上没有同步等待探测**（先 readIdentityState()，命中就 return）；
	//   ④ 提醒轮次复用同一条缓存路径（不再每轮探测）。
	{
		const expected = "DshGachaCalendar.Reminder";
		const MAX_AGE = R.NOTIFY_IDENTITY_MAX_AGE_MS;
		const REC_PATH = "C:\\…\\二游日历.lnk";
		const rec = (over) => JSON.stringify(Object.assign({
			enabled: true,
			aumid: expected,
			shortcutPath: REC_PATH,
			name: "二游日历",
			checkedAt: NOW - 1000
		}, over || {}));
		const cacheOf = (raw, now, maxAge) => notifyIdentityCacheOf(
			raw,
			now === void 0 ? NOW : now,
			maxAge === void 0 ? MAX_AGE : maxAge,
			expected
		);

		// ① 纯函数
		check("缓存有效期常量 = 24h（只在 core 里写一份，宿主 import 同一个）",
			MAX_AGE === 24 * H, String(MAX_AGE));
		const fresh = cacheOf(rec());
		check("新鲜记录（checkedAt 在 24h 内）⇒ useCached / 不刷新 / 字段原样",
			fresh.useCached === true && fresh.shouldRefresh === false && !!fresh.state
			&& fresh.state.enabled === true && fresh.state.aumid === expected
			&& fresh.state.shortcutPath === REC_PATH && fresh.state.name === "二游日历"
			&& fresh.state.checkedAt === NOW - 1000,
			JSON.stringify(fresh));
		const edgeFresh = cacheOf(rec({ checkedAt: NOW - MAX_AGE }));
		check("边界：正好 24h ⇒ 仍算新鲜（没越过 TTL 就不刷新）",
			edgeFresh.useCached === true && edgeFresh.shouldRefresh === false, JSON.stringify(edgeFresh));
		const stale = cacheOf(rec({ checkedAt: NOW - MAX_AGE - 1 }));
		check("过期（>24h）⇒ **仍 useCached=true**（先回文件内容）+ shouldRefresh=true（后台补探）",
			stale.useCached === true && stale.shouldRefresh === true && !!stale.state,
			JSON.stringify(stale));
		const future = cacheOf(rec({ checkedAt: NOW + 5 * H }));
		check("时钟往回调（checkedAt 在未来）⇒ 按 0 岁算、不刷新（否则未来时间戳会钉住它反复探测）",
			future.useCached === true && future.shouldRefresh === false, JSON.stringify(future));

		const misses = {
			"空串（没有文件）": "",
			"纯空白": "   ",
			"非字符串 null": null,
			"非字符串 数字": 123,
			"非字符串 对象": {},
			"不是合法 JSON": "{\"enabled\":true,",
			"JSON 是数组": "[1,2]",
			"JSON 是 null": "null",
			"JSON 是数字": "123",
			"缺 enabled": rec({ enabled: void 0 }),
			"缺 aumid": rec({ aumid: void 0 }),
			"缺 name": rec({ name: void 0 }),
			"缺 shortcutPath": rec({ shortcutPath: void 0 }),
			"缺 checkedAt": rec({ checkedAt: void 0 })
		};
		const missHits = Object.entries(misses)
			.filter(([, raw]) => {
				const r = cacheOf(raw);
				return r.useCached !== false || r.shouldRefresh !== true || r.state !== null;
			})
			.map(([label]) => label);
		check("没有文件 / 读坏 / 字段不全 ⇒ useCached=false + shouldRefresh=true + state=null（走探测慢路径）",
			missHits.length === 0, missHits.join("、"));
		check("脏值：enabled 不是布尔（\"true\" / 1 / null）、aumid 不等于期望、name 空、shortcutPath 非字符串 ⇒ 作废",
			cacheOf(rec({ enabled: JSON.parse("\"true\"") })).useCached === false
			&& cacheOf(rec({ enabled: 1 })).useCached === false
			&& cacheOf(rec({ enabled: null })).useCached === false
			&& cacheOf(rec({ aumid: "SomeoneElse.App" })).useCached === false
			&& cacheOf(rec({ aumid: 123 })).useCached === false
			&& cacheOf(rec({ name: 123 })).useCached === false
			&& cacheOf(rec({ name: "   " })).useCached === false
			&& cacheOf(rec({ shortcutPath: 123 })).useCached === false,
			JSON.stringify([cacheOf(rec({ aumid: "SomeoneElse.App" })), cacheOf(rec({ name: "   " }))]));
		check("checkedAt 脏值（0 / 负数 / 字符串 / null）⇒ 作废（不能把\"从没检查过\"当新鲜）",
			cacheOf(rec({ checkedAt: 0 })).useCached === false
			&& cacheOf(rec({ checkedAt: -1 })).useCached === false
			&& cacheOf(rec({ checkedAt: "1793000000000" })).useCached === false
			&& cacheOf(rec({ checkedAt: null })).useCached === false);
		check("启用却记了空 shortcutPath ⇒ 字段不全（没法核对是哪条 .lnk）",
			cacheOf(rec({ shortcutPath: "" })).useCached === false);
		const off = cacheOf(rec({ enabled: false, shortcutPath: "", checkedAt: NOW }));
		check("未启用记录（enabled=false + 空路径）⇒ **可以直接用**（身份关着时 GET 也必须是毫秒级）",
			off.useCached === true && off.shouldRefresh === false && !!off.state && off.state.enabled === false,
			JSON.stringify(off));
		check("期望 AUMID 为空 / 与记录不符 ⇒ 作废（身份常量改了，旧文件不能被信）",
			notifyIdentityCacheOf(rec(), NOW, MAX_AGE, "").useCached === false
			&& notifyIdentityCacheOf(rec(), NOW, MAX_AGE, void 0).useCached === false
			&& notifyIdentityCacheOf(rec(), NOW, MAX_AGE, "Other.App").useCached === false
			&& cacheOf(rec()).useCached === true);
		check("maxAge 脏值（0 / 负数 / NaN）⇒ 仍 useCached、但要求后台刷新（不确定新鲜就别当新鲜）",
			[0, -1, Number.NaN].every((v) => {
				const r = cacheOf(rec(), NOW, v);
				return r.useCached === true && r.shouldRefresh === true;
			}));
		const nowBad = cacheOf(rec(), Number.NaN);
		check("now 脏值（NaN）⇒ 不抛、不当新鲜（useCached=true / shouldRefresh=true）",
			nowBad.useCached === true && nowBad.shouldRefresh === true, JSON.stringify(nowBad));
		check("宿主那份 ESM（lib/remind-core.mjs）与客户端是**同一个判定**",
			typeof R.notifyIdentityCacheOf === "function"
			&& JSON.stringify(R.notifyIdentityCacheOf(rec(), NOW, MAX_AGE, expected)) === JSON.stringify(fresh)
			&& R.notifyIdentityCacheOf(rec({ checkedAt: NOW - MAX_AGE - 1 }), NOW, MAX_AGE, expected).shouldRefresh === true
			&& R.notifyIdentityCacheOf("", NOW, MAX_AGE, expected).useCached === false
			&& R.NOTIFY_IDENTITY_MAX_AGE_MS === MAX_AGE);
		check("最大年龄可以省略（默认就是 24h 常量，宿主显式传同一个值，不各写一份）",
			notifyIdentityCacheOf(rec(), NOW, void 0, expected).shouldRefresh === false
			&& notifyIdentityCacheOf(rec({ checkedAt: NOW - MAX_AGE - 1 }), NOW, void 0, expected).shouldRefresh === true);

		// ②③④ 宿主静态
		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		const bodyOfFn = (name) => {
			const i = hostSrc.indexOf("function " + name + "(");
			const j = i < 0 ? -1 : hostSrc.indexOf("\n}", i);
			return i < 0 ? "" : hostSrc.slice(i, j < 0 ? hostSrc.length : j);
		};
		const readBody = bodyOfFn("readIdentityState");
		const writeBody = bodyOfFn("writeIdentityState");
		const probeBody = bodyOfFn("probeIdentityState");
		const refreshBody = bodyOfFn("refreshIdentityState");
		const stateBody = bodyOfFn("identityStateOf");
		const targetBody = bodyOfFn("notifyToastTargetOf");
		const handlerBody = bodyOfFn("notifyIdentityHandler");

		check("守卫自身没瞎：缓存相关的函数都定位到了",
			[readBody, writeBody, probeBody, refreshBody, stateBody, targetBody, handlerBody].every((b) => b.length > 0),
			[readBody, writeBody, probeBody, refreshBody, stateBody, targetBody, handlerBody].map((b) => b.length).join(","));
		check("缓存文件 = %LOCALAPPDATA%\\dsh-gacha-calendar\\identity.json（与 host-state.json / remind.log 同目录）",
			/function notifyIdentityPath\(\) \{\s*return path\.join\(remindDir\(\), "identity\.json"\);/.test(hostSrc));
		check("identity.json **原子写**（同目录 .tmp → rename，与去重状态同一套）",
			writeBody.includes('const tmp = file + ".tmp"')
			&& /renameSync\(tmp, file\)/.test(writeBody)
			&& /writeFileSync\(tmp, JSON\.stringify\(state, null, 2\)/.test(writeBody));
		check("读缓存只读文件 + 一次 existsSync，**绝不起 PowerShell**（GET 的毫秒路径就是它）",
			/readFileSync\(notifyIdentityPath\(\), "utf8"\)/.test(readBody)
			&& /existsSync\(state\.shortcutPath\)/.test(readBody)
			&& !/notifyIdentityProbe|runNotifyPowerShell|execFile/.test(readBody));
		check("读不到 / 读坏 ⇒ 返回 null（= 慢路径），不在这里猜\"未启用\"",
			/if \(!decision\.useCached \|\| !decision\.state\) return null;/.test(readBody)
			&& /return null;/.test(readBody));
		check("慢路径：探测一次并**写回** identity.json（写失败只记日志，不影响本次返回）",
			/const state = identityStateOf\(await notifyIdentityProbe\(\), cfgName\);/.test(probeBody)
			&& /writeIdentityState\(state\)/.test(probeBody) && /catch \(err\)/.test(probeBody));
		check("后台刷新：**不阻塞调用方**（void async）+ 单飞 + 永不抛（探测失败保留旧文件）",
			/if \(identityRefreshRunning\) return;/.test(refreshBody)
			&& /void \(async \(\) => \{/.test(refreshBody)
			&& /writeIdentityState\(next\)/.test(refreshBody)
			&& /catch \(err\)/.test(refreshBody) && /finally/.test(refreshBody));
		check("记录形状：enabled / aumid / shortcutPath / name / checkedAt（enabled 由 remindIdentityOf 判定）",
			/\benabled,/.test(stateBody) && /aumid: NOTIFY_AUMID,/.test(stateBody)
			&& /shortcutPath:/.test(stateBody)
			&& /name: detected === "" \? notifyNameOf\(cfgName\) : notifyNameOf\(detected\),/.test(stateBody)
			&& /checkedAt: Date\.now\(\)/.test(stateBody));

		// GET 分支 = 从 `if (req.method === "GET" …)` 到 `if (req.method !== "POST")` 之前。
		// 2026-10-28 第二次修复后这条分支**一个 await 都没有**：没有缓存也立刻回保守值（见 ⑯）。
		const getStart = handlerBody.indexOf('if (req.method === "GET" || req.method === "HEAD") {');
		const getEnd = getStart >= 0 ? handlerBody.indexOf('if (req.method !== "POST")', getStart) : -1;
		const getBranch = getStart >= 0 && getEnd > getStart ? handlerBody.slice(getStart, getEnd) : "";
		check("守卫自身没瞎：GET 分支定位到了", getBranch.length > 0, String(getBranch.length));
		// 注释里写着"这里不允许 await probe…"（说明文字本身带这些词），断言前先把整行注释剥掉，
		// 否则守卫会被自己的说明绊倒 —— 被测的是**代码**。
		const getCode = getBranch.replace(/\/\/[^\n]*/g, "");
		check("GET **先读 identity.json**（readIdentityState），命中就立刻 sendJson + return",
			/const cached = readIdentityState\(\);/.test(getCode)
			&& /if \(cached\) \{/.test(getCode)
			&& /sendJson\(res, 200, identityBodyOf\(cached\.state, cfgName\)\);\s*return;/.test(getCode));
		check("**整条 GET 分支里没有任何同步等待**（没有 await / notifyIdentityProbe / runNotifyPowerShell / execFile）",
			getCode.length > 0 && !/\bawait\b/.test(getCode)
			&& !/notifyIdentityProbe|runNotifyPowerShell|execFile/.test(getCode),
			getCode.slice(0, 200));
		check("过期 / 快捷方式被删只**排后台刷新**、不阻塞（`if (cached.stale) void refreshIdentityState(cfgName);`）",
			/if \(cached\.stale\) void refreshIdentityState\(cfgName\);/.test(getCode)
			&& !/await refreshIdentityState/.test(hostSrc));
		check("没有缓存 ⇒ 立刻回**保守值** + `void` 后台探测（先排探测，再 sendJson，没有 await）",
			/void refreshIdentityState\(cfgName\);\s*sendJson\(res, 200, identityFallbackBodyOf\(cfgName\)\);\s*return;/.test(getCode));
		const postStart = handlerBody.indexOf('if (req.method !== "POST")');
		const postText = postStart >= 0 ? handlerBody.slice(postStart) : "";
		check("POST：**成功之后**才写缓存（`if (r.ok !== true) { … return; }` 在前，`probeIdentityState(name)` 在后）",
			(() => {
				const failAt = postText.indexOf("if (r.ok !== true) {");
				const probeAt = postText.indexOf("const state = await probeIdentityState(name);");
				return failAt >= 0 && probeAt > failAt;
			})());
		check("POST 的探测结果写回缓存（probeIdentityState 内含 writeIdentityState），之后 GET 不必再从零探测",
			/probeIdentityState\(name\)/.test(postText) && /writeIdentityState\(state\)/.test(probeBody));
		check("提醒轮次复用同一条缓存路径（notifyToastTargetOf 先 readIdentityState，没缓存才 probeIdentityState）",
			/const cached = readIdentityState\(\);/.test(targetBody)
			&& /probeIdentityState\(appName\)/.test(targetBody)
			&& !/notifyIdentityProbe/.test(targetBody),
			targetBody.slice(0, 160));
		check("提醒轮次的身份判定仍然只有一处（identityProbeOfState → remindIdentityOf，没有第二套 AUMID 逻辑）",
			/remindIdentityOf\(identityProbeOfState\(state\), NOTIFY_AUMID\)/.test(targetBody)
			&& /const target = await notifyToastTargetOf\(plain\.notifyName\);/.test(hostSrc));

		// 设置页：GET 毫秒级之后「读取中…」只在首次 / 无缓存时短暂出现，且不挡住其它行
		const compSrc = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		check("设置页只在**那一行**显示「读取中…」，不挡住其它行（没有整页 early return）",
			compSrc.includes('notifyIdentity === null ? "读取中…"')
			&& !/if \(notifyIdentity === null\) return/.test(compSrc)
			&& /const \[notifyIdentity, setNotifyIdentity\] = \(0, react\.useState\)\(null\)/.test(compSrc));
	}

	// ── ⑯ GET **永不阻塞在 PowerShell 上** + 启动预热（2026-10-28 第二次性能修复）────────────
	// 用户第二次反馈「通知身份那行的状态读取还是慢」。根因：`identity.json` 只有"探测过一次"之后才存在，
	// **从没启用过身份的用户没有这个文件** ⇒ 每次 GET 都走冷路径，真跑一次 PowerShell 扫开始菜单
	// （实测 0.87 秒）。这里把新契约钉死：
	//   ① GET handler 里**绝不允许出现任何 `await probe…`**（一旦 await 就回到 0.87 秒）；
	//   ② 没有缓存 ⇒ 立刻回**保守值**（纯函数 notifyIdentityFallbackOf）+ `void` 后台探测（单飞共享）；
	//   ③ `apply()` 里有**启动预热**且是 `void`（不 await、不拖慢插件加载；失败只记日志）；
	//   ④ 设置页拿到保守值后还能更新：点「发送测试通知」会再 GET 一次并刷新那一行。
	{
		const expected = "DshGachaCalendar.Reminder";
		const fb = (cfgName, aumid) => notifyIdentityFallbackOf(cfgName, aumid === void 0 ? expected : aumid);

		// ① 纯函数：无缓存时回什么（保守值）
		const plain = fb("二游日历");
		check("保守值：enabled=false / name=配置名 / aumid=期望值 / shortcutPath=空串（**不声称**知道哪条 .lnk）",
			plain.enabled === false && plain.name === "二游日历"
			&& plain.aumid === expected && plain.shortcutPath === "",
			JSON.stringify(plain));
		check("保守值字段与宿主正常响应同形（只有 enabled / name / aumid / shortcutPath，iconPath 由宿主补）",
			Object.keys(plain).sort().join(",") === "aumid,enabled,name,shortcutPath",
			Object.keys(plain).join(","));
		check("保守值的 name 过 notifyNameOf（空 / 非法 / 保留设备名 / 超长都按同一处规则兜底）",
			fb("").name === "二游日历" && fb("   ").name === "二游日历"
			&& fb("a/b:c").name === "a b c" && fb("CON").name === "二游日历"
			&& fb("名".repeat(60)).name.length === 40,
			JSON.stringify([fb("").name, fb("a/b:c").name, fb("CON").name, fb("名".repeat(60)).name.length]));
		check("保守值的 aumid：字符串原样 / 非字符串 ⇒ 空串（拿不准就不声称是哪个身份）",
			fb("x", "Other.App").aumid === "Other.App"
			&& notifyIdentityFallbackOf("x", 123).aumid === ""
			&& notifyIdentityFallbackOf("x", null).aumid === ""
			&& notifyIdentityFallbackOf("x", void 0).aumid === "");
		check("宿主那份 ESM（lib/remind-core.mjs）与客户端是**同一个保守值**",
			typeof R.notifyIdentityFallbackOf === "function"
			&& JSON.stringify(R.notifyIdentityFallbackOf("a/b:c", expected)) === JSON.stringify(fb("a/b:c"))
			&& JSON.stringify(R.notifyIdentityFallbackOf("", 123)) === JSON.stringify(fb("", 123)));

		// ② 宿主静态：GET 不许等探测
		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		const bodyOfFn = (name) => {
			const i = hostSrc.indexOf("function " + name + "(");
			const j = i < 0 ? -1 : hostSrc.indexOf("\n}", i);
			return i < 0 ? "" : hostSrc.slice(i, j < 0 ? hostSrc.length : j);
		};
		const handlerBody = bodyOfFn("notifyIdentityHandler");
		const getStart = handlerBody.indexOf('if (req.method === "GET" || req.method === "HEAD") {');
		const getEnd = getStart >= 0 ? handlerBody.indexOf('if (req.method !== "POST")', getStart) : -1;
		const getBranch = getStart >= 0 && getEnd > getStart ? handlerBody.slice(getStart, getEnd) : "";
		check("守卫自身没瞎：GET 分支定位到了", getBranch.length > 0, String(getBranch.length));
		// 同理先剥注释（说明文字里就有「await probe…」这几个字，别让守卫绊在自己的注释上）。
		const getCode = getBranch.replace(/\/\/[^\n]*/g, "");
		check("GET handler 里**没有 `await probe…`**（钉死这条：GET 一旦等探测就回到 0.87 秒）",
			!/\bawait\b/.test(getCode)
			&& !/probeIdentityState|notifyIdentityProbe/.test(getCode),
			getCode.slice(0, 200));
		check("无缓存分支：先 `void` 后台探测、再 sendJson 保守值、return（顺序与\"不阻塞\"都在）",
			/void refreshIdentityState\(cfgName\);\s*sendJson\(res, 200, identityFallbackBodyOf\(cfgName\)\);\s*return;/.test(getCode));
		check("保守值由 core 纯函数生成、宿主只补 iconPath（形状与正常响应一致）",
			/\.\.\.notifyIdentityFallbackOf\(cfgName, NOTIFY_AUMID\)/.test(bodyOfFn("identityFallbackBodyOf"))
			&& /iconPath: notifyIconPath\(\)/.test(bodyOfFn("identityFallbackBodyOf")));
		check("POST 仍然**真探测**（建 / 删之后要回读系统真相，写回缓存）",
			/const state = await probeIdentityState\(name\);/.test(handlerBody));

		// ③ 启动预热
		const applyAt = hostSrc.indexOf("export function apply(ctx, config = {}) {");
		const applyEnd = applyAt < 0 ? -1 : hostSrc.indexOf("\n}", applyAt);
		const applyBody = applyAt < 0 ? "" : hostSrc.slice(applyAt, applyEnd < 0 ? hostSrc.length : applyEnd);
		const warmBody = bodyOfFn("warmIdentityState");
		check("`apply()` 里有**启动预热**、且是 `void` 调用（不 await ⇒ 不拖慢插件加载）",
			applyBody.length > 0
			&& /void warmIdentityState\(configValueOf\(liveConfigOf\(ctx, config\), "notifyName"\)\);/.test(applyBody)
			&& !/await warmIdentityState/.test(hostSrc),
			applyBody.slice(0, 160));
		check("预热只在**没有缓存 / 已 stale** 时才探测（新鲜缓存直接跳过，不白起 PowerShell）",
			/const cached = readIdentityState\(\);/.test(warmBody)
			&& /if \(cached && !cached\.stale\) return false;/.test(warmBody)
			&& /refreshIdentityState\(cfgName\);/.test(warmBody));
		check("预热**永不抛**：整段 try/catch + 失败只记日志（之后 GET 的兜底探测会再试），自己也不 await",
			/function warmIdentityState\(cfgName\) \{\s*try \{/.test(warmBody)
			&& /catch \(err\)/.test(warmBody) && /logRemind\(/.test(warmBody)
			&& !/\bawait\b/.test(warmBody));
		check("启动预热 / GET 兜底 / stale 刷新**共用同一个单飞函数**（refreshIdentityState 的守卫仍在）",
			/if \(identityRefreshRunning\) return;/.test(bodyOfFn("refreshIdentityState"))
			&& (hostSrc.match(/refreshIdentityState\(cfgName\)/g) || []).length >= 3,
			String((hostSrc.match(/refreshIdentityState\(cfgName\)/g) || []).length));
		// 探针实测（2026-10-28）：`notifyIdentityProbe` 的同步前缀是一次 readdirSync 扫开始菜单顶层
		// （80~120ms），它发生在第一个 await 之前 ⇒ 直接在 GET / apply 的栈里跑，GET 会从 0.5ms 变成 81ms、
		// apply 从 0.2ms 变成 115ms。所以后台探测必须**下一拍**再真跑（setTimeout(0)）。
		check("后台探测**推迟到下一拍**（setTimeout(0)）：probe 的同步前缀不落在 GET / apply 的调用栈里",
			/identityRefreshRunning = true;[\s\S]{0,600}?setTimeout\(\(\) => \{[\s\S]{0,80}?void \(async \(\) => \{/.test(bodyOfFn("refreshIdentityState")));

		// ④ 设置页：拿到保守值后要能更新（点「发送测试通知」顺手再 GET 一次）
		const compSrc = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		check("设置页有 refreshNotifyIdentity（GET 一次 + setNotifyIdentity，失败保持原显示）",
			/const refreshNotifyIdentity = async \(\) => \{[\s\S]{0,400}?setNotifyIdentity\(notifyIdentityOfBody\(body\)\)/.test(compSrc));
		check("点「发送测试通知」成功后**再 GET 一次身份**并刷新那一行（保守值不会一直挂着）",
			/await sendNotifyTest\(\);[\s\S]{0,300}?await refreshNotifyIdentity\(\);/.test(compSrc));
	}
}
