// test/cases-display-name.mjs —— 外显名（`lastData` 里的 `banner` / `event`）三类文字问题
//
// 背景（2026-11-18 全量审计，61 条真实条目）：
//   ① 源站体裁尾巴：`【战前补给】现已开启` / `…開催中！` / `…のお知らせ`（3+ 条）
//   ② 泛名：`限时招募` / `往期复刻` / `ピックアップガチャ` / `70%UP` …（11 条）
//   ③ 过长：>26 字（11 条，最长 uma-kr 62 字）
//
// 三件事的共同口径（也是本文件的断言主线）：
//   **只改外显名**（`banner` / `event` 与数组主条的 `show`）。
//   数组条目的 `title` / `raw`、`bannerHover` / `eventHover`、`roles` 一律是源站原文，
//   悬停 / 复制 / 回归 oracle 读的是它们 ⇒ 每段都有一条"原文不动"的断言。
//   应用点 = `50-refresh.js` 的 `mergeEntryRecord`；纯函数在 `60-helpers.js`（两个产物都包含）。
//
// 分段与三个 commit 对齐：① 尾巴归一 / ② 泛名让位 / ③ 超长截断。

import { check, section } from "./harness.mjs";
import { T } from "./load.mjs";
import { createEngine } from "../packages/core/core.mjs";

const TZ_CN = "Asia/Shanghai";
// 固定时刻：2026-11-18 12:00 +08（与审计用的真 lastData 同一时段）
const NOW = Date.parse("2026-11-18T04:00:00Z");
const DAY = 864e5;
const makeStore = () => {
	const m = new Map();
	return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
// 只测 `mergeEntryRecord`（不抓网络）：transport 故意抛错，调用到就是用例写错了。
const engineAt = () => createEngine({
	transport: { async fetchRaw() { throw new Error("本文件不联网"); } },
	storage: makeStore(),
	now: () => NOW,
	timer: { setTimeout, clearTimeout }
});
const SRC = "fixture";
const merge = (data) => engineAt().__test.mergeEntryRecord({ data }, null, NOW, { id: SRC, tz: TZ_CN });
// 数组条目：形状 = `50-refresh.js` 数据层数组契约（key 由 mergeEntryRecord 重发，这里给空）
const arrItem = (o) => Object.assign({
	key: "", title: "", show: "", roles: [],
	startTs: NOW - DAY, endTs: NOW + DAY, tz: TZ_CN,
	raw: "11-17 12:00 ~ 11-19 12:00", source: "primary"
}, o || {});

export default function runDisplayName() {
	// ══════════════════════════════════════════════════════════════════════════
	section("外显名 ①：源站体裁尾巴归一（纯函数 + mergeEntryRecord；数组与悬停不动）");
	{
		// ── 纯函数：白名单尾巴逐条剥掉（含「已/将」两种形态、中日繁体）──────────────
		const STRIP = [
			["【战前补给】现已开启", "【战前补给】"],
			["某活动现已开启！", "某活动"],
			["某活动现已开始！", "某活动"],
			["某活动即将开始！", "某活动"],
			["某活动即将开启", "某活动"],
			["某活动即将上线！", "某活动"],
			["某活动上线预告", "某活动"],
			["某活动举办预告！", "某活动"],
			["イベント「因子研究」開催中！", "イベント「因子研究」"],
			["イベント「因子研究」開催中", "イベント「因子研究」"],
			["活動「愛麗速子」舉辦中！", "活動「愛麗速子」"],
			["「Z」举办中", "「Z」"],
			["某活动開催！", "某活动"],
			["某活动开启！", "某活动"],
			["某活动举办！", "某活动"],
			["某活动のお知らせ", "某活动"],
			// 反复剥：先剥「開催中」再剥「開催中！」——剥完仍 ≥3 码点才继续
			["活动甲開催中！開催中", "活动甲"]
		];
		const badStrip = STRIP.filter(([input, want]) => T.stripDisplayTailOf(input) !== want);
		check("剥掉白名单尾巴（15 条逐个；含反复剥 + 全/半角感叹号）",
			badStrip.length === 0,
			JSON.stringify(badStrip.map(([i]) => [i, T.stripDisplayTailOf(i)])));

		// ── 纯函数：白名单之外的尾巴 / 没有尾巴 ⇒ **逐字不变**（反向守卫）────────────
		const KEEP = [
			"「空白的稚梦」",
			"開催予定",
			"活动开放中",                      // 「开放中」不在白名单
			"活动的公告",                      // 只有「公告」，没有「举办预告」
			"培育賽馬娘&支援卡片新登場！特選轉蛋舉辦公告！",  // 尾巴「舉辦公告！」不在白名单
			"「坏灭肇始之时」",
			"十天衆戦記",
			"支线故事：时间啊，向前！",          // 以「！」结尾但不是白名单尾巴
			"活动开启",                        // 「开启」必须带「！」才算尾巴
			""
		];
		const badKeep = KEEP.filter((s) => T.stripDisplayTailOf(s) !== s);
		check("白名单之外的文字逐字不变（反向守卫 10 条：不含尾巴 / 尾巴不在白名单 / 半截尾巴）",
			badKeep.length === 0,
			JSON.stringify(badKeep.map((s) => [s, T.stripDisplayTailOf(s)])));

		// ── 纯函数：剥完不足 3 个码点 ⇒ 不剥（不许把名字剥空 / 剥成两字名）──────────
		const GUARD = ["开启！", "開催中！", "活动开启！", "活动举办！"];
		const badGuard = GUARD.filter((s) => T.stripDisplayTailOf(s) !== s);
		check("剥完剩余 < 3 码点 ⇒ 保持原样（含「开启！」这种会剥空的名字）",
			badGuard.length === 0,
			JSON.stringify(badGuard.map((s) => [s, T.stripDisplayTailOf(s)])));

		// ── mergeEntryRecord：gf2 活动「【战前补给】现已开启」→ 外显「【战前补给】」──
		const GF2_EVENT = "【战前补给】现已开启";
		const GF2_HOVER = "【战前补给】   11-08 10:00 ~ 11-20 03:59";
		const gf2 = merge({
			event: GF2_EVENT,
			eventDates: "11-08 10:00 ~ 11-20 03:59",
			eventDatesRaw: "2026年11月8日 10:00 ~ 11月20日 03:59",
			eventHover: GF2_HOVER,
			events: [arrItem({
				key: SRC + ":event:0", title: GF2_EVENT, show: GF2_EVENT,
				startTs: Date.parse("2026-11-08T02:00:00Z"), endTs: Date.parse("2026-11-19T19:59:00Z"),
				raw: "2026年11月8日 10:00 ~ 11月20日 03:59", source: "primary"
			})]
		});
		check("mergeEntryRecord：活动外显「【战前补给】现已开启」⇒「【战前补给】」",
			gf2.event === "【战前补给】", JSON.stringify(gf2.event));
		check("mergeEntryRecord：数组主条 title / show / raw **仍是源站原文**（数组一个字没动）",
			gf2.events.length === 1 && gf2.events[0].title === GF2_EVENT
			&& gf2.events[0].raw === "2026年11月8日 10:00 ~ 11月20日 03:59"
			&& gf2.events[0].show === GF2_EVENT,
			JSON.stringify(gf2.events[0]));
		check("mergeEntryRecord：悬停原文（eventHover）**一个字未改**",
			gf2.eventHover === GF2_HOVER, JSON.stringify(gf2.eventHover));

		// ── mergeEntryRecord：卡池侧尾巴（gf2 横幅「…限时概率UP活动现已开启！」）──────
		const GF2_BANNER = "破坏者、克罗丽科、纳美西丝限时概率UP活动现已开启！";
		const gf2g = merge({
			banner: GF2_BANNER, roles: "",
			bannerDates: "11-08 10:00 ~ 11-20 03:59",
			bannerDatesRaw: "2026年11月8日 10:00 ~ 11月20日 03:59",
			bannerHover: GF2_BANNER + "\n11-08 10:00 ~ 11-20 03:59",
			gacha: [arrItem({ key: SRC + ":gacha:0", title: GF2_BANNER, show: GF2_BANNER, roles: [] })]
		});
		check("mergeEntryRecord：卡池外显「…活动现已开启！」⇒「…活动」（数组 title 不动）",
			gf2g.banner === "破坏者、克罗丽科、纳美西丝限时概率UP活动"
			&& gf2g.gacha[0].title === GF2_BANNER
			&& gf2g.gacha[0].show === GF2_BANNER,
			JSON.stringify([gf2g.banner, gf2g.gacha[0].title, gf2g.gacha[0].show]));
		check("mergeEntryRecord：卡池悬停原文（bannerHover）**一个字未改**",
			gf2g.bannerHover === GF2_BANNER + "\n11-08 10:00 ~ 11-20 03:59", JSON.stringify(gf2g.bannerHover));

		// ── 反向：没有尾巴的名字经过 mergeEntryRecord 后逐字不变 ─────────────────────
		const PLAIN = "「星际和平盛典：成名之路」";
		const plain = merge({ event: PLAIN, eventDates: "11-10 10:00 ~ 11-20 03:59", events: [] });
		check("反向守卫：不含尾巴的外显名经 mergeEntryRecord 后逐字不变",
			plain.event === PLAIN, JSON.stringify(plain.event));
	}
}