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
//   ③ 设置页的节点档位输入（文本 → 归一化 / 预览 / 非法回落）：预览与写回必须走判定侧同一个
//      remindNodesOf（`remindNodesEditOf`），否则会出现"设置页说 2 小时、判定按 6 小时发"。
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
		remindOnOf, remindNodesOf, remindNodesEditOf, remindConfigOf, remindKeyOf, remindStateOf,
		remindWindowOf, remindItemsOf, remindTickOf, remindToastOf,
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
		check("空配置 → 默认开始节点 24/2", JSON.stringify(def.startNodes) === JSON.stringify([24, 2]), JSON.stringify(def.startNodes));
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

	// ── ③ 开始方向：用 startNodes 这一套节点，不跟结束方向混 ────────────────────────
	{
		const startItem = { gameId: "g3", side: "gacha", kind: "start", gameName: "游戏丙", T: NOW + 1 * H, startTs: NOW + 1 * H, endTs: NOW + 20 * H };
		const a = remindTickOf(NOW, [startItem], {}, {});
		check("开始方向：1 小时后开始 → 发 2 小时档（开始前 2 小时已过）",
			a.toNotify.length === 1 && a.toNotify[0].kind === "start" && a.toNotify[0].node === 2,
			JSON.stringify(a.toNotify.map((n) => [n.kind, n.node])));
		check("开始方向的状态键带 `start`（键不同 ⇒ 与结束方向互不干扰）",
			Object.keys(a.stateNext)[0] === "g3|gacha|start|" + (NOW + 1 * H), Object.keys(a.stateNext)[0]);
		const b = remindTickOf(NOW, [{ ...startItem, T: NOW + 20 * H }], {}, {});
		check("开始方向：20 小时后开始 → 只轮到 24 小时档（2 小时档还没到）",
			b.toNotify.length === 1 && b.toNotify[0].node === 24, JSON.stringify(b.toNotify.map((n) => n.node)));
		check("两套节点各自独立：把结束档改成空、开始档保持默认，开始方向照样工作",
			remindTickOf(NOW, [startItem], { remindEndNodes: "坏的" }, {}).toNotify[0].node === 2);
	}

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
		check("**不做自建 AUMID / 不改开始菜单**（应用名就用 Windows PowerShell）",
			!/DshGachaCalendar\.Reminder/.test(hostCode) && !/Start Menu/.test(hostCode));
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

	// ── ⑪ 设置页「提醒」节点档位（2026-10-28）：两个文本框 + 实时预览 + 归一化写回 ────────
	// 需求：文本输入（不是 chips）、预览与判定侧同口径、非法只提示不拦输入、
	// 失焦/回车归一化写回、空或全非法写回默认值（**绝不写空串**）。
	// 这里分两层钉：①纯函数 remindNodesEditOf（65-remind.js，判定侧同一个 remindNodesOf）；
	// ②设置页接线（静态：两个输入框 / 键名 / 预览来源 / 非法提示 / 不拦输入）。
	{
		const D_END = [72, 24, 6, 2];
		const D_START = [24, 2];
		const editOf = (v, fb) => remindNodesEditOf(v, fb);

		// ① 纯函数：输入字符串 → { text（该写回什么）, nodes（实际生效档位）, invalid（要不要标红）}
		{
			const e = editOf("8,12", D_END);
			check("节点编辑视图：正常输入 \"8,12\" → 归一化 \"12,8\"、档位降序、不算非法",
				e.text === "12,8" && JSON.stringify(e.nodes) === JSON.stringify([12, 8]) && e.invalid === false,
				JSON.stringify(e));
		}
		{
			const e = editOf("6 ， 2", D_END);
			check("节点编辑视图：中文逗号 / 空白 → \"6,2\"（与判定侧同一套分隔符）",
				e.text === "6,2" && e.invalid === false, JSON.stringify(e));
		}
		{
			const e = editOf("6 ， 2 ,abc", D_END);
			check("节点编辑视图：夹非法项 → 只丢非法项写 \"6,2\"，**不**算非法（不回落默认）",
				e.text === "6,2" && JSON.stringify(e.nodes) === JSON.stringify([6, 2]) && e.invalid === false,
				JSON.stringify(e));
		}
		{
			const e = editOf("", D_END);
			check("节点编辑视图：空串 → 非法，写回默认 \"72,24,6,2\"（不是空字符串）",
				e.invalid === true && e.text === "72,24,6,2" && JSON.stringify(e.nodes) === JSON.stringify(D_END),
				JSON.stringify(e));
		}
		{
			const e = editOf("全部坏掉", D_START);
			check("节点编辑视图：全非法 → 非法 + 写回**该方向**的默认 \"24,2\"",
				e.invalid === true && e.text === "24,2" && JSON.stringify(e.nodes) === JSON.stringify(D_START),
				JSON.stringify(e));
		}
		{
			const zero = editOf("0", D_END);
			const neg = editOf("-1,-2", D_END);
			const mixed = editOf("0,-1,3", D_END);
			check("节点编辑视图：0 / 负数一律不算有效档（0 档 = 每一轮都发，负数更没意义），按非法回落默认",
				zero.invalid === true && neg.invalid === true
				&& zero.text === "72,24,6,2" && neg.text === "72,24,6,2",
				JSON.stringify([zero, neg]));
			check("节点编辑视图：0/负数与有效档混写 → 只留有效档（不因为夹了 0 就回落默认）",
				mixed.text === "3" && mixed.invalid === false, JSON.stringify(mixed));
		}
		{
			const e = editOf("2,2,2", D_END);
			check("节点编辑视图：去重（\"2,2,2\" → \"2\"）", e.text === "2" && e.nodes.length === 1, JSON.stringify(e));
		}
		{
			// 关键不变量：写回的字符串再解析一次 == 实际生效的档位（设置页写回与判定不会分叉）
			const samples = ["8,12", "6 ， 2 ,abc", "", "全部坏掉", "0,-1,3", "2,2,2"];
			check("节点编辑视图：写回的字符串再解析 == 实际生效档位（写回与判定同一口径）",
				samples.every((v) => {
					const e = editOf(v, D_END);
					return JSON.stringify(remindNodesOf(e.text, [])) === JSON.stringify(e.nodes);
				}),
				samples.map((v) => JSON.stringify(editOf(v, D_END).text)).join(" / "));
			check("节点编辑视图：与判定侧读同一份配置的结果一致（remindConfigOf，含非法值）",
				JSON.stringify(remindConfigOf({ remindEndNodes: "6 ， 2 ,abc" }).endNodes) === JSON.stringify(editOf("6 ， 2 ,abc", D_END).nodes)
				&& JSON.stringify(remindConfigOf({ remindEndNodes: "" }).endNodes) === JSON.stringify(editOf("", D_END).nodes));
		}
		{
			const bad = editOf("", ["坏的", 0, -1]);
			check("节点编辑视图：fallback 本身也坏 → 仍是出厂结束档（永不返回空串）",
				bad.invalid === true && bad.text === "72,24,6,2", JSON.stringify(bad));
		}

		// ② 设置页接线（静态）
		const compSrc = readFileSync(path.join(REPO, "src", "client", "80-components.js"), "utf8");
		check("设置页有两行节点输入（「结束节点」/「开始节点」），各写回各自的键",
			compSrc.includes('remindNodeRow("end", "结束节点"') && compSrc.includes('remindNodeRow("start", "开始节点"'));
		check("commit 的两个键名正确：remindEndNodes / remindStartNodes（写的是归一化后的 edit.text）",
			compSrc.includes('commit("remindEndNodes", edit.text)') && compSrc.includes('commit("remindStartNodes", edit.text)'));
		check("预览用的是 remindNodesEditOf（内部即判定侧 remindNodesOf；设置页没有另写一份解析）",
			/remindEndEdit = remindNodesEditOf\(remindEndText, REMIND_DEFAULT_END_NODES\)/.test(compSrc)
			&& /remindStartEdit = remindNodesEditOf\(remindStartText, REMIND_DEFAULT_START_NODES\)/.test(compSrc)
			&& compSrc.includes('"解析为：" + edit.nodes.map(remindNodeText).join(" / ")')
			&& !/remindEndNodes[\s\S]{0,40}?\.split\(/.test(compSrc)
			&& !/remindStartNodes[\s\S]{0,40}?\.split\(/.test(compSrc));
		check("非法时边框变红 + 一行提示（提示说明保存后会回落默认值）",
			compSrc.includes("borderColor: edit.invalid ? remindErrorColor : void 0")
			&& compSrc.includes("没识别出有效小时数，保存后会用默认值"));
		check("非法**不阻止输入**：节点输入框没有 disabled / maxLength / pattern",
			!/maxLength/.test(compSrc) && !/pattern:/.test(compSrc)
			&& /onChange: \(e\) => setRemindNodesDraft\(\(p\) => \(\{ \.\.\.p, \[which\]: e\.target\.value \}\)\)/.test(compSrc));
		check("失焦写回 + 回车写回（回车 = 立刻失焦，写入只走 onBlur 一处、不会写两笔）",
			/onBlur: onCommit/.test(compSrc)
			&& /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); e\.currentTarget\.blur\(\); \}/.test(compSrc));
		check("空/非法写回默认值的分支在 65-remind.js（设置页不硬编码那两个默认字符串）",
			/const nodes = remindNodesOf\(fallback, REMIND_DEFAULT_END_NODES\);/.test(
				readFileSync(path.join(REPO, "src", "client", "65-remind.js"), "utf8"))
			&& !/commit\("remindEndNodes", "/.test(compSrc) && !/commit\("remindStartNodes", "/.test(compSrc));
		check("没改过输入（TAB 经过）不写盘：草稿为 null 时直接返回",
			compSrc.includes("if (remindNodesDraft.end === null) return;")
			&& compSrc.includes("if (remindNodesDraft.start === null) return;"));
		check("逐游戏「提醒」列保持隐藏（SHOW_REMIND_COLUMN 仍为 false，本次不动）",
			/const SHOW_REMIND_COLUMN = false;/.test(compSrc));
	}
}
