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
// 分段与两个 commit 对齐：① 尾巴归一 / ② 泛名让位 / ③ 2026-11-26 过长名的**有源站措辞证据**归一
// （③ 仍**不做程序截断**：只剥加长体裁尾巴、剥「新登場」领句、取「」里的真名）。
// （③ 超长截断曾实现后按用户 2026-11-18 要求回退：本文件已无 ③ 的用例。）

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
const merge = (data, id) => engineAt().__test.mergeEntryRecord({ data }, null, NOW, { id: id || SRC, tz: TZ_CN });
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
			// 2026-11-18 追加：公告体裁尾巴「…舉辦公告！」（uma-tw 实测）。
			// **已批准差异**：这条真字符串原先在下面的 KEEP 里（当时「舉辦公告！」不在白名单，断言"逐字不变"）；
			// 现在它属于白名单 ⇒ 从 KEEP 移到 STRIP，期望值 = 剥掉尾巴后的名字（不是放宽，是把断言改到新口径）。
			["培育賽馬娘&支援卡片新登場！特選轉蛋舉辦公告！", "培育賽馬娘&支援卡片新登場！特選轉蛋"],
			// 简繁 × 舉辦/举行/舉行/举办 四词各带「！」与不带两式（对称覆盖）
			["某活动舉辦公告！", "某活动"],
			["某活动舉辦公告", "某活动"],
			["某活动举办公告！", "某活动"],
			["某活动举办公告", "某活动"],
			["某活动舉行公告！", "某活动"],
			["某活动舉行公告", "某活动"],
			["某活动举行公告！", "某活动"],
			["某活动举行公告", "某活动"],
			// 反复剥：先剥「開催中」再剥「開催中！」——剥完仍 ≥3 码点才继续
			["活动甲開催中！開催中", "活动甲"]
		];
		const badStrip = STRIP.filter(([input, want]) => T.stripDisplayTailOf(input) !== want);
		check("剥掉白名单尾巴（24 条逐个；含反复剥 + 全/半角感叹号 + 简繁「舉辦公告！」四式）",
			badStrip.length === 0,
			JSON.stringify(badStrip.map(([i]) => [i, T.stripDisplayTailOf(i)])));

		// ── 纯函数：白名单之外的尾巴 / 没有尾巴 ⇒ **逐字不变**（反向守卫）────────────
		// ⚠️ **已批准差异**（2026-11-18）：「培育賽馬娘&支援卡片新登場！特選轉蛋舉辦公告！」原先在本表里
		//    （那时「舉辦公告！」不在白名单，断言"逐字不变"）；现在它被正式收进白名单 ⇒ 这条断言移到上面 STRIP
		//    的**正向表**（期望值逐字写死）。KEEP 表**没有放宽**：仍是"白名单之外逐字不变"，条数 10 → 9。
		const KEEP = [
			"「空白的稚梦」",
			"開催予定",
			"活动开放中",                      // 「开放中」不在白名单
			"活动的公告",                      // 只有「公告」，没有「举办预告」
			"「坏灭肇始之时」",
			"十天衆戦記",
			"支线故事：时间啊，向前！",          // 以「！」结尾但不是白名单尾巴
			"活动开启",                        // 「开启」必须带「！」才算尾巴
			""
		];
		const badKeep = KEEP.filter((s) => T.stripDisplayTailOf(s) !== s);
		check("白名单之外的文字逐字不变（反向守卫 9 条：不含尾巴 / 尾巴不在白名单 / 半截尾巴）",
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

	// ══════════════════════════════════════════════════════════════════════════
	section("外显名 ②：泛名让位（命中泛名且同一侧数组有更具体条目 ⇒ 外显用那条的 show；数组与悬停不动）");
	{
		// ── 纯函数：泛名判定（整串，不做包含匹配）────────────────────────────────
		const GENERIC = [
			"限时招募", "特选招募", "往期复刻", "角色活动唤取", "ピックアップガチャ",
			"70%UP", "联运招募", "限定扭蛋复刻",
			"限定棋盘 & 返场限定棋盘", "限定棋盘& 返场限定棋盘", "限定棋盘&返场限定棋盘"
		];
		const badGeneric = GENERIC.filter((s) => !T.displayNameIsGenericOf(s));
		check("泛名白名单全覆盖（10 条真实字符串 + 棋盘三种空格写法）", badGeneric.length === 0, JSON.stringify(badGeneric));
		const NOT_GENERIC = ["70%UP：布偶熊·骇影、露娜·终焉", "限时招募开启", "「限定棋盘」", "万圣卡池"];
		const badNotGeneric = NOT_GENERIC.filter((s) => T.displayNameIsGenericOf(s));
		check("泛名判定按整串：带后缀 / 带前缀 / 别的栏目名都不算（不做包含匹配）",
			badNotGeneric.length === 0, JSON.stringify(badNotGeneric));

		// ── 纯函数：从数组里挑"更具体的条目"──────────────────────────────────────
		// wd 2026-11-17 的真 lastData（`_lastdata_dump2.json`）形状：主条 = 泛名、两条 hover 各有具体名。
		// 苦昼长 = 12 码点 / 轮替女神之影 = 26 码点 ⇒ 取后者（审计点名的目标示例）。
		const WD_ITEMS = [
			{ key: "wd:gacha:0", title: "往期复刻", show: "往期复刻", roles: [], source: "primary" },
			{ key: "wd:gacha:1", title: "苦昼长：苦昼长、岂在朝暮", show: "苦昼长：苦昼长、岂在朝暮", roles: [], source: "hover" },
			{ key: "wd:gacha:2", title: "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景", show: "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景", roles: [], source: "hover" }
		];
		check("纯函数：wd 数组里同时有两条具体名 ⇒ 取更具体的「轮替女神之影：…」",
			T.displaySpecificNameOf("往期复刻", WD_ITEMS) === "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景",
			JSON.stringify(T.displaySpecificNameOf("往期复刻", WD_ITEMS)));
		check("纯函数：同一侧只有泛名本身 ⇒ 返回空串（调用方保持原泛名不变）",
			T.displaySpecificNameOf("限定扭蛋复刻", [
				{ title: "限定扭蛋复刻", show: "限定扭蛋复刻", roles: [], source: "primary" }
			]) === "",
			JSON.stringify(T.displaySpecificNameOf("限定扭蛋复刻", [{ title: "限定扭蛋复刻", show: "限定扭蛋复刻", roles: [] }])));
		check("纯函数：有 roles 的条目优先（卡池侧泛名 + 主条带角色名 ⇒ 用角色名）",
			T.displaySpecificNameOf("限时招募", [
				{ title: "限时招募", show: "美咲(泳装)", roles: ["美咲(泳装)"], source: "primary" },
				{ title: "更长的具体池名：某角色", show: "更长的具体池名：某角色", roles: [], source: "hover" }
			]) === "美咲(泳装)",
			JSON.stringify(T.displaySpecificNameOf("限时招募", [
				{ title: "限时招募", show: "美咲(泳装)", roles: ["美咲(泳装)"] },
				{ title: "更长的具体池名：某角色", show: "更长的具体池名：某角色", roles: [] }
			])));
		check("纯函数：非泛名原样传回（displayNameNextOf 只做 ①+②，不改别的名字）",
			T.displayNameNextOf("「果实的赤红」活动征集", WD_ITEMS) === "「果实的赤红」活动征集"
			&& T.displayNameNextOf("往期复刻開催中", WD_ITEMS) === "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景",
			JSON.stringify([T.displayNameNextOf("「果实的赤红」活动征集", WD_ITEMS), T.displayNameNextOf("往期复刻開催中", WD_ITEMS)]));

		// ── mergeEntryRecord：wd 真 lastData 形态（泛名「往期复刻」⇒ 数组里那条具体 show）──
		const WD_HOVER = ["往期复刻", "11-12 11:00 ~ 11-19 04:00",
			"苦昼长：苦昼长、岂在朝暮", "11-17 11:00 ~ 11-24 04:00",
			"轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景", "11-13 11:00 ~ 11-27 11:00"].join("\n");
		const wd = merge({
			banner: "往期复刻", roles: "",
			bannerDates: "11-12 11:00 ~ 11-19 04:00",
			bannerDatesRaw: "2026年11月12日11:00 ~ 11月19日04:00",
			bannerHover: WD_HOVER,
			gacha: [
				arrItem({ key: "wd:gacha:0", title: "往期复刻", show: "往期复刻", roles: [],
					startTs: 1794452400000, endTs: 1795032000000, raw: "2026年11月12日11:00 ~ 11月19日04:00" }),
				arrItem({ key: "wd:gacha:1", title: "苦昼长：苦昼长、岂在朝暮", show: "苦昼长：苦昼长、岂在朝暮", roles: [],
					startTs: 1794884400000, endTs: 1795464000000, raw: "11-17 11:00 ~ 11-24 04:00", source: "hover" }),
				arrItem({ key: "wd:gacha:2", title: "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景", show: "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景", roles: [],
					startTs: 1794538800000, endTs: 1795748400000, raw: "11-13 11:00 ~ 11-27 11:00", source: "hover" })
			]
		}, "wd");
		check("mergeEntryRecord（wd 真数据形态）：外显「往期复刻」⇒「轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景」",
			wd.banner === "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景", JSON.stringify(wd.banner));
		check("mergeEntryRecord（wd）：数组 3 条、title / show / raw **逐字仍是源站原文**（泛名让位不碰数组）",
			wd.gacha.length === 3
			&& wd.gacha[0].title === "往期复刻" && wd.gacha[0].show === "往期复刻"
			&& wd.gacha[1].show === "苦昼长：苦昼长、岂在朝暮"
			&& wd.gacha[2].show === "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景"
			&& wd.gacha[2].raw === "11-13 11:00 ~ 11-27 11:00",
			JSON.stringify(wd.gacha.map((x) => [x.title, x.show])));
		check("mergeEntryRecord（wd）：悬停原文（bannerHover）一字未改",
			wd.bannerHover === WD_HOVER, JSON.stringify(wd.bannerHover));
		// 显示层：主条走 `scheduleNormalize`（记录字段是外显唯一入口）⇒ 面板上就是那个具体名
		const wdView = T.scheduleNormalize(wd, "gacha", new Date(NOW));
		check("显示层：wd 卡池格子外显 = 泛名让位后的具体名（title / show 都是它；源站名仍在数组里）",
			!!wdView && wdView.title === "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景"
			&& wdView.show === "轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景"
			&& wd.gacha[0].title === "往期复刻",
			JSON.stringify(wdView && [wdView.title, wdView.show]));

		// ── mergeEntryRecord：卡池泛名 + 主条 roles（ba-cn 形态）⇒ 外显用角色名 ─────────
		const ba = merge({
			banner: "限时招募", roles: "美咲(泳装)",
			bannerDates: "11-06 11:00 ~ 11-20 10:59",
			bannerHover: "",
			gacha: [arrItem({ key: "ba-cn:gacha:0", title: "限时招募", show: "美咲(泳装)", roles: ["美咲(泳装)"] })]
		}, "ba-cn");
		check("mergeEntryRecord（泛名 + roles）：外显改为角色名（数组 title 仍是「限时招募」）",
			ba.banner === "美咲(泳装)" && ba.gacha[0].title === "限时招募" && ba.gacha[0].show === "美咲(泳装)",
			JSON.stringify([ba.banner, ba.gacha[0].title, ba.gacha[0].show]));

		// ── 反向：没有更具体条目 ⇒ 保持原泛名（p5x「限定扭蛋复刻」形态）──────────────
		const p5x = merge({
			banner: "限定扭蛋复刻", roles: "",
			bannerDates: "10-22 00:00 ~ 12-24 23:59",
			gacha: [arrItem({ key: "p5x:gacha:0", title: "限定扭蛋复刻", show: "限定扭蛋复刻", roles: [] })]
		}, "p5x");
		check("反向守卫：数组里没有更具体条目 ⇒ 泛名保持原样（不硬造 / 不改写）",
			p5x.banner === "限定扭蛋复刻" && p5x.gacha[0].title === "限定扭蛋复刻",
			JSON.stringify([p5x.banner, p5x.gacha[0].title]));
	}

	// ══════════════════════════════════════════════════════════════════════════
	section("外显名 ③：过长的外显名 —— 有源站措辞证据的归一（剥加长体裁尾巴 / 剥「新登場」领句 / 取「」真名；数组与悬停不动）");
	// 2026-11-26（B2）：用户要求缩短过长的卡片外显名，**硬约束 = 不做程序截断**（2026-11-18 口径），
	// 只能做"源站措辞本身支持"的归一。本段三类各一条主线（都只改**外显名**）：
	//   ①a 加长体裁尾巴：`…も開催！` / `…同時舉辦中！`（旧白名单的 `開催！`/`舉辦中！` 会留下悬挂的「も」/「同時」）
	//   ①b 「新登場」领句：`…が新登場！<池名>`（领句是公告体裁，正文「開催期間」段落里逐字写着池名）
	//   ①c 「」真名：`<活动体裁词>「<活动名>」`（体裁词是栏目名，名字在「」里；白名单前缀 + 裸「」才生效）
	{
		// ── 纯函数：加长体裁尾巴（正向逐字）──────────────────────────────────────
		const STRIP2 = [
			["育成ウマ娘が新登場！セレクトピックアップ サポートカードガチャも開催！", "セレクトピックアップ サポートカードガチャ"],
			["【予告】育成ウマ娘が新登場！セレクトピックアップ サポートカードガチャも開催決定！", "【予告】セレクトピックアップ サポートカードガチャ"],
			["培育賽馬娘新登場！自選特選支援卡片轉蛋同時舉辦中！", "自選特選支援卡片轉蛋"],
			["养成优俊少女新登场！自定义精选 协助卡招募同时", "自定义精选 协助卡招募同时"],
			["某活动も開催！", "某活动"],
			["某活动同時舉辦中！", "某活动"],
			["某活动同时举办中!", "某活动"]
		];
		const bad2 = STRIP2.filter(([input, want]) => T.displayNameNextOf(input, []) !== want);
		check("③a 加长体裁尾巴 / 「新登場」领句：白名单逐条剥掉（7 条正向逐字）",
			bad2.length === 0, JSON.stringify(bad2.map(([i]) => [i, T.displayNameNextOf(i, [])])));
		// ── 纯函数：「」真名（正向逐字；含状态标记保留）────────────────────────────
		const QUOTE = [
			["レースイベント「リーグ オブ ヒーローズ」開催！", "リーグ オブ ヒーローズ"],
			["ストーリーイベント「Banquet of Shadows」開催！", "Banquet of Shadows"],
			["스토리 이벤트 「서머 데이즈 『You』 그라피티」", "서머 데이즈 『You』 그라피티"],
			["イベント「因子研究」開催中！", "因子研究"],
			["【予告】レースイベント「リーグ オブ ヒーローズ」", "【予告】リーグ オブ ヒーローズ"]
		];
		const badQuote = QUOTE.filter(([input, want]) => T.displayNameNextOf(input, []) !== want);
		check("③c 「」真名：白名单活动体裁前缀 + 裸「」⇒ 取「」里的名字（5 条正向逐字，含保留【予告】）",
			badQuote.length === 0, JSON.stringify(badQuote.map(([i]) => [i, T.displayNameNextOf(i, [])])));
		// ── 反向守卫：真实标题里那些「」形态的名字**逐字不动** ─────────────────────
		// 判据：前缀/后缀只要不是"纯体裁词"就不动（后缀不是体裁词 / 前缀不是体裁词 / 本来就只有真名 /
		// 后缀是"活动开启"这类非白名单体裁词）。这些是真 lastData / 审计里出现过的原串。
		const QUOTE_KEEP = [
			"「万序衍盈」109期角色活动祈愿",
			"协同补给丨协同者「薇塔」开放获取",
			"「坏灭肇始之时」",
			"「酣眠遐梦」活动开启",
			"「11月戰隊競賽」舉辦預告&訓練模式",
			"劇場アニメーション「魔法使いの夜」公開記念 蒼崎青子ピックアップ召喚",
			"「冠位戴冠战：Rider」＆「冠位戴冠战：Assassin」推荐召唤"
		];
		const badQuoteKeep = QUOTE_KEEP.filter((s) => T.displayNameNextOf(s, []) !== s);
		check("③c 反向守卫：「」外不是纯体裁词的名字逐字不动（7 条真实串）",
			badQuoteKeep.length === 0, JSON.stringify(badQuoteKeep.map((s) => [s, T.displayNameNextOf(s, [])])));
		// ── 反向守卫：ba-jp 的真活动名**判为不该改** ─────────────────────────────
		// `踊らされし芸術～象牙の塔と招かれざる客～`：源站新闻标题就是完整活动名（无体裁前缀 / 无尾巴 /
		// 无「」可剥），`～…～` 是名字自带的副标题 ⇒ 逐字不动（审计结论：判为不该改）。
		check("③ 反向守卫：ba-jp 真活动名「踊らされし芸術～象牙の塔と招かれざる客～」逐字不动（判为不该改）",
			T.displayNameNextOf("踊らされし芸術～象牙の塔と招かれざる客～", []) === "踊らされし芸術～象牙の塔と招かれざる客～");
		// ── 反向守卫：白名单之外的加长尾巴形态逐字不动 ──────────────────────────
		const TAIL_KEEP = [
			"活動開催決定中",          // 「開催決定」后面还有字，不是尾巴
			"同時開催中！",            // 不是「舉辦/举办中」
			"新登場のイベント",        // 「新登場」后面不是「！」，是定语
			"A！B新登場！C"           // 「新登場」不在领句位置（前面还有别的「！」）
		];
		const badTailKeep = TAIL_KEEP.filter((s) => T.displayNameNextOf(s, []) !== s);
		check("③a/b 反向守卫：白名单之外的尾巴 / 非领句的「新登場！」逐字不动（4 条）",
			badTailKeep.length === 0, JSON.stringify(badTailKeep.map((s) => [s, T.displayNameNextOf(s, [])])));

		// ── mergeEntryRecord：uma-jp 卡池（35 字 ⇒ 21 字；数组 title / 悬停 / 提醒标题不动）──
		const UJ_TITLE = "育成ウマ娘が新登場！セレクトピックアップ サポートカードガチャも開催！";
		const UJ_PREVIEW = "【予告】育成ウマ娘が新登場！セレクトピックアップ サポートカードガチャも開催決定！";
		const UJ_STAMP = "セレクトピックアップ スタンプシートガチャ開催！";
		const UJ_HOVER = [UJ_TITLE, "11-16 12:00 ~ 11-30 11:59", UJ_PREVIEW, "11-16 12:00 ~ 11-30 11:59",
			UJ_STAMP, "11-10 12:00 ~ 12-28 11:59"].join("\n");
		const uj = merge({
			banner: UJ_TITLE, bannerDates: "11-16 12:00 ~ 11-30 11:59", bannerDatesRaw: "11/16 12:00 ～ 11/30 11:59",
			bannerHover: UJ_HOVER,
			// 解析器直出形态：主条 title/show = 原文；并列条 title = 原文、show = 短名（见 30-game-cygames.js）
			gacha: [
				arrItem({ title: UJ_TITLE, show: UJ_TITLE, source: "primary", raw: "11/16 12:00 ～ 11/30 11:59" }),
				arrItem({ title: UJ_PREVIEW, show: "【予告】セレクトピックアップ サポートカードガチャ", source: "hover", raw: "11-16 12:00 ~ 11-30 11:59" }),
				arrItem({ title: UJ_STAMP, show: "セレクトピックアップ スタンプシートガチャ", source: "hover", raw: "11-10 12:00 ~ 12-28 11:59" })
			]
		}, "uma-jp");
		check("③ mergeEntryRecord（uma-jp 卡池）：外显名 35 字 ⇒ 21 字（逐字）",
			uj.banner === "セレクトピックアップ サポートカードガチャ"
			&& uj.banner === T.displayNameNextOf(UJ_TITLE, []),
			JSON.stringify([UJ_TITLE, uj.banner]));
		check("③ mergeEntryRecord（uma-jp 卡池）：数组主条 title/show、并列条 title、悬停**全部仍是源站原文**",
			uj.gacha[0].title === UJ_TITLE && uj.gacha[0].show === UJ_TITLE
			&& uj.gacha[1].title === UJ_PREVIEW && uj.gacha[2].title === UJ_STAMP
			&& uj.bannerHover === UJ_HOVER,
			JSON.stringify([uj.gacha.map((x) => [x.title, x.show]), uj.bannerHover]));
		check("③ 反向证明（uma-jp）：提醒标题读数组 `title` ⇒ 仍是源站原文（不是缩短后的外显名）",
			(() => {
				const items = T.remindItemsOf({ "uma-jp": Object.assign({ name: "uma-jp" }, uj) }, NOW, { "uma-jp": TZ_CN });
				return items.some((x) => x.title === UJ_TITLE) && !items.some((x) => x.title === uj.banner);
			})(),
			JSON.stringify(T.remindItemsOf({ "uma-jp": Object.assign({ name: "uma-jp" }, uj) }, NOW, { "uma-jp": TZ_CN }).map((x) => x.title)));

		// ── mergeEntryRecord：uma-kr 活动（27 字 ⇒ 17 字；数组 / 悬停不动）──────────────
		const KR_EVENT = "스토리 이벤트 「서머 데이즈 『You』 그라피티」";
		const KR_HOVER = KR_EVENT + "   11-19 12:00 ~ 12-03 11:59\n마스터즈 챌린지   2026-11-19 12:00 ~ 2027-02-17 11:59";
		const kr = merge({
			event: KR_EVENT, eventDates: "11-19 12:00 ~ 12-03 11:59", eventDatesRaw: "11-19 12:00 ~ 12-03 11:59",
			eventHover: KR_HOVER,
			events: [arrItem({ title: KR_EVENT, show: KR_EVENT, source: "primary", raw: "11-19 12:00 ~ 12-03 11:59" })]
		}, "uma-kr");
		check("③ mergeEntryRecord（uma-kr 活动）：外显名 27 字 ⇒ 17 字（剥 `스토리 이벤트` 体裁前缀，取「」真名）",
			kr.event === "서머 데이즈 『You』 그라피티" && kr.event === T.displayNameNextOf(KR_EVENT, []),
			JSON.stringify([KR_EVENT, kr.event]));
		check("③ mergeEntryRecord（uma-kr 活动）：数组 title/show 与悬停逐字仍是源站原文",
			kr.events[0].title === KR_EVENT && kr.events[0].show === KR_EVENT && kr.eventHover === KR_HOVER,
			JSON.stringify([kr.events[0], kr.eventHover]));

		// ── mergeEntryRecord：uma-tw 卡池（25 字 ⇒ 11 字）──────────────────────────
		const TW_BANNER = "培育賽馬娘新登場！自選特選支援卡片轉蛋同時舉辦中！";
		const tw = merge({
			banner: TW_BANNER, bannerDates: "11-23 12:00 ~ 12-02 11:59", bannerDatesRaw: "11/23 12:00 ～ 12/2 11:59",
			gacha: [arrItem({ title: TW_BANNER, show: TW_BANNER, source: "primary" })]
		}, "uma-tw");
		check("③ mergeEntryRecord（uma-tw 卡池）：外显名 25 字 ⇒ 11 字（剥 `同時舉辦中！` + `新登場` 领句）",
			tw.banner === "自選特選支援卡片轉蛋" && tw.banner === T.displayNameNextOf(TW_BANNER, []),
			JSON.stringify([TW_BANNER, tw.banner]));
		check("③ mergeEntryRecord（uma-tw 卡池）：数组 title 仍是源站原文",
			tw.gacha[0].title === TW_BANNER && tw.gacha[0].show === TW_BANNER,
			JSON.stringify([tw.gacha[0].title, tw.gacha[0].show]));

		// ── 反向：ba-jp 活动（20 字真活动名）经 mergeEntryRecord 后逐字不变 ──────────
		const BA_JP_EVENT = "踊らされし芸術～象牙の塔と招かれざる客～";
		const bajp = merge({
			event: BA_JP_EVENT, eventDates: "11-25 19:00 ~ 12-09 10:59", eventDatesRaw: "11-25 19:00 ~ 12-09 10:59",
			events: [arrItem({ title: BA_JP_EVENT, show: BA_JP_EVENT, source: "primary" })]
		}, "ba-jp");
		check("③ 反向守卫（ba-jp 活动）：真活动名 20 字经 mergeEntryRecord 后逐字不变（判为不该改）",
			bajp.event === BA_JP_EVENT && bajp.events[0].title === BA_JP_EVENT,
			JSON.stringify([BA_JP_EVENT, bajp.event]));
	}
}