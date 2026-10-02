// next-sources/registry-p7.js —— 批次 P7 注册表片段（星塔旅人 国服）
//
// 与插件 `src/client/40-fetchers.js` 契约一致；由 Lead 汇总进 registry.js。
//
// 时区依据：**Asia/Shanghai（推测）**
//   · 源站**未显式标注时区**
//   · 但正文档期用 `04:00 ~ 03:59` 的国服日切（`▌售卖时间 2026/10/01 04:00 ~ 2026/10/31 03:59`）
//     → 与国服「每日 04:00 刷新」习惯一致，故按 UTC+8 解释；仍标「推测」
//   · publishTime 是 epoch ms（绝对时刻），不依赖 tz 推测
//
// 来源性质：**官方 CMS API**（游戏官网同源反代），免 token / 免签名
// 可抓取性：实测响应**无 ACAO** → 必须 mode:"proxy"
import { gachaStellasora, eventsStellasora } from "./parsers/stellasora.js";
import { eventsStellasora as eventsStellasoraBwiki } from "./parsers/bwiki.js";

const TZ_CN = "Asia/Shanghai";

// 与 registry-b2.js 的 `parseUrl("stellasora", "首页")` 同形态（页面名保持未编码，与 map.json 键一一对应）
const STELLA_BWIKI_EVENT_URL = "https://wiki.biligame.com/stellasora/api.php?action=parse&page=首页&prop=text&format=json&formatversion=2";

export const SOURCES_P7 = [
	{
		id: "stellasora",
		name: "星塔旅人",
		// 图标：国服官网 stellasora.yostar.cn 的 rel=icon（悠星自家 OSS）。与蔚蓝档案国服的图标同一 CDN 范式；`?x-oss-process=...w_128` 实测在 OSS 侧真实生效
		icon: "https://webcnstatic.yostar.net/stellasora/stellasora-cn-official-frontend/main/h5/favicon.png?x-oss-process=image/resize,w_128",
		tz: TZ_CN,
		// 一游戏一条目，两侧同源（同一公告列表，按标题分流：招募=卡池 / 活动说明=活动）
		gacha: {
			url: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
			fetcher: gachaStellasora,
			kind: "official-api",
			mode: "proxy"
		},
		event: {
			url: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
			fetcher: eventsStellasora,
			kind: "official-api",
			mode: "proxy"
		},
		// 备选源：bwiki 首页「活动日历」（低可用：停更 + 无活动名字段）。
		// 原 `stellasora-bwiki` 独立条目已吸收到这里（一游戏一条目）。
		eventAltSources: [
			{ label: "Bwiki 首页活动日历（低可用）", url: STELLA_BWIKI_EVENT_URL, fetcher: "stellasora-bwiki" }
		]
	}
];

export function findSource(id) { return SOURCES_P7.find((s) => s.id === id) || null; }
