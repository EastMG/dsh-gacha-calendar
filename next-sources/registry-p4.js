// next-sources/registry-p4.js —— 批次 P4 来源注册表片段（**不合并进插件本体**）
//
// 契约与 registry.js 一致：每条声明 id / name / tz / gacha? / event?，
// 每侧含 { url, fetcher, kind, mode }。URL 一律由 parsers/miyoushe.js 的
// `miyousheListUrl()` 生成，保证「注册表里的 URL」与「解析器实际抓的 URL」**永远同一串**
// （离线夹具按整串匹配，写歪一个字符就命中不到）。
//
// ⚠️ mode 一律 "proxy"：米游社 BBS API 的 ACAO 未实测放行 → 属"必须走代理"的一类。
//    🚨 **但 `src/index.js` 的 PROXY_ALLOW_HOSTS 目前不含 `bbs-api.miyoushe.com`**
//       —— 真机上代理会回 `{error:"host not allowed"}`。离线夹具测试不受影响，
//       需 Lead 把 `"bbs-api.miyoushe.com"` 加进白名单（属插件本体改动，本批次不越界改 src/）。
//
// ── 与既有条目的关系（**id 刻意不撞车**）────────────────────────────────────
//   插件本体里已有走 bwiki 的 `genshin` / `hsr` / `zzz`（见 src/client/20-sources.js）。
//   本批次是**官方公告补充源**，与它们**并存**：id 加 `-official` 后缀。
//   `bh3`（崩坏3）此前没有任何来源，直接用本名。
//
// ── 时区：一律 Asia/Shanghai（**推测**）────────────────────────────────────
//   源站正文只写墙钟（`2026-09-30 12:00`），**没有**标时区；国服按 UTC+8 解释。
//   依据与反证都写在 parsers/miyoushe.js 文件头 §二。
//
// ── 两侧 URL 的区别（实测）────────────────────────────────────────────────
//   · 卡池侧 type=1 = 公告/补给：既含【补给】/祈愿/跃迁/频段，也含"…活动说明"，
//     所以**靠标题关键词分流**（补给/祈愿/跃迁/频段 → 卡池）。
//   · 活动侧 type=2 = 活动：以【有奖活动】/征集活动/网页活动为主。
//     （type=1 里的"活动说明"正文同样带档期，若想改成站内活动，把 event.url
//       换成 type=1 即可 —— 解析器的分流逻辑对两种列表都适用。）
//
// ── 快照实况（2026-10-02 抓夹具时的真实结果，**不是**配置声明）──────────────
//   有当期数据（覆盖 now）：
//     · hsr-official.gacha  `4.6版本活动跃迁（其一）`  09-28 07:00 ~ 11-10 15:00
//     · zzz-official.gacha  `3.2版本限时频段（下期）`  09-30 12:00 ~ 10-20 14:59
//     · 四个游戏的 event 侧都有
//   如实返回 null（**源站正文里没有日期，不是抓取失败**）：
//     · bh3.gacha     崩坏3 补给公告把时间**画在配图里**（正文只有 `>>补给信息` + 一张图）
//     · genshin-official.gacha  原神祈愿公告只写"活动期间"，全程不给日期
//   —— 这两侧仍然保留抓取器（形态正确、将来源站改版给了日期就能用），且**绝不硬凑**。

import { gachaMiyoushe, eventsMiyoushe, miyousheListUrl, MIYOUSHE_TZ, MIYOUSHE_GIDS, MIYOUSHE_TYPES } from "./parsers/miyoushe.js";

const G = MIYOUSHE_TYPES.GACHA;
const E = MIYOUSHE_TYPES.EVENT;

// 四个游戏共用同一套解析器，只有 gids 不同 → 用工厂函数生成条目（id/name 逐个写死，便于检索）
function miyousheSource(id, name, gid) {
	return {
		id,
		name,
		tz: MIYOUSHE_TZ,
		gacha: { url: miyousheListUrl(gid, G), fetcher: gachaMiyoushe, kind: "official-api", mode: "proxy" },
		event: { url: miyousheListUrl(gid, E), fetcher: eventsMiyoushe, kind: "official-api", mode: "proxy" }
	};
}

export const SOURCES_P4 = [
	// 崩坏3 国服 · 官方公告（米游社 gids=1）。插件本体**没有**崩坏3 → 作为新条目（默认未配置，见生成器）。
	miyousheSource("bh3", "崩坏3", MIYOUSHE_GIDS.bh3),
	// 原神 · 官方公告（米游社 gids=2）。
	miyousheSource("genshin-official", "原神", MIYOUSHE_GIDS.genshin),
	// 崩坏：星穹铁道 · 官方公告（米游社 gids=6）。
	miyousheSource("hsr-official", "崩坏：星穹铁道", MIYOUSHE_GIDS.hsr),
	// 绝区零 · 官方公告（米游社 gids=8）。
	miyousheSource("zzz-official", "绝区零", MIYOUSHE_GIDS.zzz)
	// ⚠️ 这 4 条**不会**作为独立条目进面板：生成器把它们**并入插件既有条目**
	//    （原神/星铁/绝区零）或**新建条目**（崩坏3），且一律**只作备选源**、
	//    显示名统一为「米游社公告」、**不改动默认主源**（用户 2026-10-02 明确要求）。
	//    见 `diag/handoff-2026/miyoushe-merge.mjs` 与 `merge-next-sources.mjs`。
	//    gids 映射：1=崩坏3 / 2=原神 / 6=星穹铁道 / 8=绝区零。
];

// 便捷查询（与 registry.js 的 findSource 同名同义）
export function findSource(id) { return SOURCES_P4.find((s) => s.id === id) || null; }
export function listIds() { return SOURCES_P4.map((s) => s.id); }
