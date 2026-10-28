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
		remindOnOf, remindIdentityOf, remindNodesOf, remindNodesToggleOf, remindConfigOf, remindKeyOf, remindStateOf,
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
			(hostSrc.match(/runNotifyPowerShell\(notifyIdentityEnableScript\(\)\)/g) || []).length === 1
			&& (hostSrc.match(/runNotifyPowerShell\(notifyIdentityDisableScript\(\)\)/g) || []).length === 1);
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
	// ②设置页接线（静态：两行胶囊 / 可选集合 / 键名 / 没有输入框与预览 / 点击不被往返吞掉）。
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
	// 这里钉四件事：
	//   ① 判定纯函数（remindIdentityOf）：只有「快捷方式存在 **且** AUMID 正确」才算启用，
	//      其余三种组合 + 脏探测结果一律回退 —（身份问题绝不能让提醒发不出去）；
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
			&& /webServer\.register\(\{ kind: "prefixes", path: NOTIFY_IDENTITY_PREFIX, handler: notifyIdentityHandler \}\)/.test(hostSrc)
			&& /if \(req\.method === "GET" \|\| req\.method === "HEAD"\)/.test(hostSrc)
			&& /if \(req\.method !== "POST"\)/.test(hostSrc));
		check("GET 返回 { enabled, aumid, shortcutPath, iconPath }（字段名与设置页/预留图标接口对齐）",
			/enabled: identity\.enabled,\s*aumid: NOTIFY_AUMID,\s*shortcutPath: notifyShortcutPath\(\),\s*iconPath: notifyIconPath\(\)/.test(hostSrc));
		check("GET 的 enabled 用「快捷方式存在 + AUMID 正确」判定（remindIdentityOf，不是只看文件在不在）",
			/const identity = remindIdentityOf\(await notifyIdentityProbe\(\), NOTIFY_AUMID\);[\s\S]{0,200}?enabled: identity\.enabled/.test(hostSrc));
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
		check("停用：删开始菜单快捷方式（Remove-Item $Lnk），注册表键保留并写明理由",
			/\$Out = \[ordered\]@\{ ok = \$false; error = \$null; existed = \$false \}/.test(hostSrc)
			&& /Remove-Item -LiteralPath \$Lnk -Force/.test(hostSrc)
			&& /注册表键/.test(hostSrc) && /保留/.test(hostSrc));
		check("图标是**预留接口**：NOTIFY_SHORTCUT_ICON + 「项目有正式 .ico 后改这里即可」注释在常量之前",
			hostSrc.includes("const NOTIFY_SHORTCUT_ICON = \"%SystemRoot%\\\\System32\\\\timedate.cpl,0\";")
			&& hostSrc.indexOf("项目有正式 .ico 后改这里即可") >= 0
			&& hostSrc.indexOf("项目有正式 .ico 后改这里即可") < hostSrc.indexOf("const NOTIFY_SHORTCUT_ICON"));

		check("toast 的 AUMID 有**启用 / 回退**两条路径，且每轮只探测一次",
			/async function notifyToastTargetOf\(\)[\s\S]{0,300}?remindIdentityOf\(await notifyIdentityProbe\(\), NOTIFY_AUMID\)[\s\S]{0,300}?aumid: enabled \? NOTIFY_AUMID : POWERSHELL_AUMID/.test(hostSrc)
			&& /const target = await notifyToastTargetOf\(\);/.test(hostSrc)
			&& /sendToastScript\(toastScriptOf\(title, lines, target\.aumid\)\)/.test(hostSrc)
			&& /function toastScriptOf\(title, lines, aumid\)/.test(hostSrc));
		check("身份探测**永不抛**（探测失败 = 当未启用，回退 PowerShell）",
			/async function notifyIdentityProbe\(\)[\s\S]{0,800}?catch \(err\) \{[\s\S]{0,200}?exists: false, aumid: null/.test(hostSrc)
			&& /async function notifyIdentityProbe\(\)[\s\S]{0,200}?process\.platform !== "win32"/.test(hostSrc));
		check("快捷方式不存在时**短路**（默认路径不启动 PowerShell；设置页打开不卡）",
			/if \(!existsSync\(notifyShortcutPath\(\)\)\) return \{ exists: false, aumid: null, error: null \};/.test(hostSrc));

		check("设置页有「通知身份」一行 + 启用/移除按钮（当前身份两种文案都在）",
			compSrc.includes('children: "通知身份"')
			&& /notifyIdentity\.enabled \? "移除" : "启用"/.test(compSrc)
			&& compSrc.includes("当前：")
			&& compSrc.includes("PowerShell（默认）"));
		check("设置页状态读 GET（默认 GET；不在渲染里轮询）",
			compSrc.includes('const NOTIFY_IDENTITY_API = "/api/gacha-calendar-notify-identity";')
			&& /fetch\(NOTIFY_IDENTITY_API, \{ headers: \{ Accept: "application\/json" \} \}\)/.test(compSrc)
			&& /react\.useEffect\)\(\(\) => \{\s*let alive = true;/.test(compSrc));
		check("设置页按钮 POST { enabled }，失败原因写小字（不弹窗）",
			/method: "POST"/.test(compSrc)
			&& /body: JSON\.stringify\(\{ enabled: enabled === true \}\)/.test(compSrc)
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
			&& /webServer\.register\(\{ kind: "prefixes", path: NOTIFY_TEST_PREFIX, handler: notifyTestHandler \}\)/.test(hostSrc));
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
		check("身份选择**复用**现有判定（notifyIdentityProbe + remindIdentityOf，收敛在 notifyToastTargetOf 一处）",
			/async function notifyToastTargetOf\(\)[\s\S]{0,200}?remindIdentityOf\(await notifyIdentityProbe\(\), NOTIFY_AUMID\)/.test(hostSrc)
			&& /const target = await notifyToastTargetOf\(\);/.test(testBody)
			// 真实提醒那一轮走的也是同一个出口（判定只有一处，没有第二套 AUMID 逻辑）
			&& /const target = await notifyToastTargetOf\(\);[\s\S]{0,400}?sendToastScript\(toastScriptOf\(title, lines, target\.aumid\)\)/.test(hostSrc));
		check("发送复用**现有的** toast 发送器（toastScriptOf + sendToastScript），不另写一套",
			/function toastScriptOf\(title, lines, aumid\)/.test(hostSrc)
			&& /function sendToastScript\(script\)/.test(hostSrc)
			&& /const sent = await sendToastScript\(toastScriptOf\(title, lines, target\.aumid\)\);/.test(testBody));
		check("正文来自 core 的纯函数 remindTestToastOf（宿主不自己拼三行）",
			/\{ title, lines \} = remindTestToastOf\(Date\.now\(\), target\.identity\)/.test(testBody)
			&& (() => {
				const m = /import \{([\s\S]*?)\} from "\.\/remind-core\.mjs"/.exec(hostSrc);
				return !!m && /\bremindTestToastOf\b/.test(m[1]);
			})());
		check("响应形状：成功 { ok:true, aumid, identity, detail } / 失败 { ok:false, error }",
			/ok: true, aumid: target\.aumid, identity: target\.identity, detail: String\(sent\.detail \|\| ""\)/.test(testBody)
			&& /ok: false, error: String\(sent\.detail \|\| "send-failed"\)/.test(testBody));
		check("identity 字段只可能是 \"app\" / \"powershell\"（设置页文案用同一套字面量）",
			/identity: enabled \? "app" : "powershell"/.test(hostSrc)
			&& /body\.identity === "app" \? "二游日历" : "Windows PowerShell"/.test(compSrc));

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
		check("成功文案「已发送（发送者：…）」按宿主回传的 identity 选名字（不猜）",
			compSrc.includes('"已发送（发送者：" + (body.identity === "app" ? "二游日历" : "Windows PowerShell") + "）"'));
		check("失败文案「发送失败：<原因>」（宿主错误码翻人话，不弹窗）",
			compSrc.includes('"发送失败：" + notifyIdentityErrorText'));
		check("按钮点击走 sendTestNotify（POST 一次就结束，不轮询）",
			/onClick: sendTestNotify,/.test(compSrc));
	}
}
