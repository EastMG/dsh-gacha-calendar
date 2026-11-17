// src/client/44-test-exports.js —— 回归测试出口（外层作用域）
//
// 为什么单独一个文件：解析器与 env 工具声明在**外层**，而 engine-api.js 的 __test 是
// createEngine 的返回值（只能闭包拿到引擎内部函数）。这里把「解析器 + env 工具 + 来源/抓取器表」
// 集中成一个对象，由 99-tail.js 挂到 exports.__regression；测试脚本 build 后加载 lib/client.js
// 即可取到，不再需要把解析器写成 ESM 模块。
//
// 名字刻意不叫 __test：现有 22 套门禁脚本会**插桩** exports.__test（替换 exports.apply 那一行），
// 用不同名字避免互相覆盖。
//
// 与 engine-api.js 的 __test 分工：那边是引擎内部函数（fetchEntry / resolveSide / …），
// 这边是纯解析器、工具与来源表。两边都如实暴露函数引用、不含数据，不做环境变量门控。

		const __regression = {
			// ── 新增来源解析器（压平自 next-sources/parsers/*；公开名 → 内部 ns_<域>_ 前缀名）──
			// 按模块分命名空间：17 个解析器之间有 28 处公开名相同（如 cleanTitle / plain / toTs），
			// 摊平成一个对象会互相覆盖，所以保持「每个源一个子对象」。
			parsers: {
			"p5x": {
				eventsP5x: ns_p5x_eventsP5x,
				gachaP5x: ns_p5x_gachaP5x,
				p5xBodyText: ns_p5x_p5xBodyText,
				parseP5xBlocks: ns_p5x_parseP5xBlocks,
				parseP5xList: ns_p5x_parseP5xList,
				parseP5xWindows: ns_p5x_parseP5xWindows,
			},
			// 异环（官网公告 yh.wanmei.com）：卡池/活动两侧**同一个抓取器**（同一篇公告里两样都有）。
			// 2026-10-21 之前它一行用例都没有 —— 段落锚点从 `一、` 改成 `【更新内容】` 时
			// 没有任何门禁报错，面板只是安静地一直报"未公布"。这里把解析器与两条阈值都暴露出来，
			// 让回归用例能离线复跑（`now` 显式传，不依赖跑测那天的日期）。
			"nte": {
				NTE_ITEM_RE,
				NTE_MAINT_RE,
				NTE_MAX_LIST_PAGES,
				NTE_MAX_LOOKBACK_DAYS,
				NTE_MAX_DETAILS,
				fetchLdshopNte,
				fetchNteWanmei,
				nteContentBounds,
				nteNextPageUrls,
				ntePlainText,
				ntePostDate,
				parseLdshopPools,
				parseNteBoards,
				parseNteWanmei,
			},
			"bwiki": {
				BJHL_EVENTS_URL,
				BJHL_GACHA_URL,
				BJHL_TZ,
				detectOrientation: ns_bwiki_detectOrientation,
				eventsStellasora: ns_bwiki_eventsStellasora,
				eventsUmaJp: ns_bwiki_eventsUmaJp,
				eventsWhmx: ns_bwiki_eventsWhmx,
				eventsBjhl: ns_bwiki_eventsBjhl,
				gachaBjhl: ns_bwiki_gachaBjhl,
				gachaCzn: ns_bwiki_gachaCzn,
				gachaKedr: ns_bwiki_gachaKedr,
				gachaUmaCn: ns_bwiki_gachaUmaCn,
				gachaWhmx: ns_bwiki_gachaWhmx,
				gachaZspms: ns_bwiki_gachaZspms,
				parseCznGacha: ns_bwiki_parseCznGacha,
				parseBjhlGacha: ns_bwiki_parseBjhlGacha,
				parseBjhlEvents: ns_bwiki_parseBjhlEvents,
				bjhlRolesOf: ns_bwiki_bjhlRolesOf,
				parseKedrGacha: ns_bwiki_parseKedrGacha,
				parsePoints: ns_bwiki_parsePoints,
				parseStellasoraEvents: ns_bwiki_parseStellasoraEvents,
				parseUmaCnGacha: ns_bwiki_parseUmaCnGacha,
				parseUmaJpEvents: ns_bwiki_parseUmaJpEvents,
				parseWhmxEvents: ns_bwiki_parseWhmxEvents,
				parseWhmxGacha: ns_bwiki_parseWhmxGacha,
				parseZspmsGacha: ns_bwiki_parseZspmsGacha,
				windowsFromCell: ns_bwiki_windowsFromCell,
			},
			// 2026-11-09 新接入：无期迷途（两侧都有源）。解析器拆成小步，回归可以分别钉住
			// 「开服后 → 无 startTs / 有锚点 → 写 startTs」两条路，以及活动正文的两种窗口写法。
			"wqmt": {
				WQMT_EVENT_MAX_DETAILS,
				WQMT_EVENT_MAX_ITEMS,
				WQMT_MAINT_RE,
				WQMT_NEWS_URL,
				WQMT_OPEN_FALLBACK_HOUR,
				WQMT_TZ,
				wqmtBodyTextOf,
				wqmtEndOfPoint,
				wqmtEventCandidatesOf,
				wqmtEventNameOf,
				wqmtEventPayloadOf,
				wqmtEventWindowsOf,
				wqmtGachaAnchorsOf,
				wqmtMaintAnchorsOf,
				wqmtPointOf,
				wqmtPoolNameOf,
				wqmtPoolsOf,
				wqmtRolesOf,
				wqmtTypeOf,
				wqmtWindowOf,
			},
			// 2026-11-09 晚：未定事件簿（米游社公告）—— 卡池/活动两个独立抓取器共用
			// 「列表 → 标题分流 → 详情 → 窗口」这条链，导出小步以便回归逐条钉住
			// （含「更新后 ⇒ startTs null」与「省年份补年 / 跨年」）。
			"wd": {
				WD_LIST_URL,
				WD_MAX_DETAILS,
				WD_REFERER,
				WD_TZ,
				fetchWdEvents,
				fetchWdGacha,
				wdClassify,
				wdDetailUrl,
				wdNameOf,
				wdParseDetail,
				wdParseList,
				wdPointsOf,
				wdRolesOf,
				wdWindowsOf,
			},
			// 2026-11-09 晚：时空中的绘旅人（官网 hlr.163.com）—— 同上，另导出跨年补年所需的纯函数。
			"hlr": {
				HLR_DETAIL_QUOTA,
				HLR_EVENT_TITLE_RE,
				HLR_LIST_MAX_PAGES,
				HLR_LIST_URL,
				HLR_MAX_DETAILS,
				HLR_TZ,
				HLR_UPDATE_LIST_URL,
				fetchHlrEvents,
				fetchHlrGacha,
				hlrBlocksOf,
				hlrEventNameOf,
				hlrGalleryRowsOf,
				hlrListPageUrlOf,
				hlrListPlanOf,
				hlrNameOf,
				hlrParseDetail,
				hlrParseList,
				hlrPointsOf,
				hlrRolesOf,
				hlrWindowsOf,
				hlrYearOf,
			},
			// 2026-11-15：阴阳师（国服）官网公告 `/news/update/` 列表 + 详情。
			// 与 hlr 同一套网易新闻 CMS（`artText` / `artDate` / `h1`），所以导出同一批步长的纯函数：
			// 列表解析 / 详情解析 / 段落切分 / 窗口行解析 / 活动行 / 卡池行 —— 让回归能分别钉住
			// 「维护后 → 锚点 = 同篇维护结束时刻」「日期对不上 → 不产出」「标签窗口 vs 裸窗口」。
			"yys": {
				YYS_DETAIL_QUOTA,
				YYS_LIST_URL,
				YYS_REFERER,
				YYS_TZ,
				YYS_UPDATE_TITLE_RE,
				YYS_WIN_RE,
				// 与其它来源同名的两个抓取器别名（test/registry-shim.mjs 的 fetcher 键按 `模块.名字` 解析）
				gachaYys: fetchYysGacha,
				eventsYys: fetchYysEvents,
				fetchYysEvents,
				fetchYysGacha,
				yysBlocksOf,
				yysEventRowsOf,
				yysGachaRowsOf,
				yysMaintenanceOf,
				yysParseDetail,
				yysParseList,
				yysRefYearOf,
				yysWindowOf,
			},
			// 夜幕之下（卡池默认置空；备选 = bwiki SMW ask + /pengpeng 契约一览表；活动 TapTap tab 的 SSR）
			"pengpeng": {
				PENGPENG_ASK_QUERY,
				PENGPENG_ASK_URL,
				PENGPENG_EVENT_URL,
				PENGPENG_MAX_OVERVIEWS,
				PENGPENG_TABLE_URL,
				PENGPENG_TAPTAP_MAX_PAGES,
				PENGPENG_TAPTAP_PAGE_URL,
				PENGPENG_TAPTAP_REFERER,
				PENGPENG_TZ,
				fetchPengpengEvents,
				fetchPengpengTaptapEvents,
				pengpengAskInstantOf,
				pengpengAskPoolsOf,
				pengpengAskValueOf,
				pengpengEventPointsOf,
				pengpengEventWindowsOf,
				pengpengHeadingOf,
				pengpengOverviewActivitiesOf,
				pengpengOverviewPagesOf,
				pengpengOverviewUrl,
				pengpengTableBoldTextsOf,
				pengpengTablePoolsOf,
				pengpengTableTextOf,
				pengpengTableWindowOf,
				pengpengTaptapActivitiesOf,
				pengpengTaptapNameOf,
				pengpengTaptapPageUrl,
				pengpengTaptapWindowsOf,
				pengpengWikitextOf,
			},
			"umapyoi": {
				PERMANENT_END: ns_umapyoi_PERMANENT_END,
				gachaUmapyoi: ns_umapyoi_gachaUmapyoi,
				parseUmapyoiGacha: ns_umapyoi_parseUmapyoiGacha,
			},
			"bestdori": {
				BESTDORI_CN_INDEX: ns_bestdori_CN_INDEX,
				eventsBestdori: ns_bestdori_eventsBestdori,
				gachaBestdori: ns_bestdori_gachaBestdori,
				parseBestdoriEvents: ns_bestdori_parseBestdoriEvents,
				parseBestdoriGacha: ns_bestdori_parseBestdoriGacha,
			},
			"sekai": {
				eventsSekai: ns_sekai_eventsSekai,
				gachaSekai: ns_sekai_gachaSekai,
				parseSekaiEvents: ns_sekai_parseSekaiEvents,
				parseSekaiGachas: ns_sekai_parseSekaiGachas,
			},
			"gf2": {
				GF2_BASE: ns_gf2_GF2_BASE,
				GF2_EVENT_URL: ns_gf2_GF2_EVENT_URL,
				GF2_GACHA_URL: ns_gf2_GF2_GACHA_URL,
				GF2_TZ: ns_gf2_GF2_TZ,
				eventsGf2: ns_gf2_eventsGf2,
				gachaGf2: ns_gf2_gachaGf2,
				gf2DetailUrl: ns_gf2_gf2DetailUrl,
				gf2EventName: ns_gf2_gf2EventName,
				parseGf2Date: ns_gf2_parseGf2Date,
				parseGf2List: ns_gf2_parseGf2List,
				parseGf2Roles: ns_gf2_parseGf2Roles,
				parseGf2Windows: ns_gf2_parseGf2Windows,
				selectGf2Window: ns_gf2_selectGf2Window,
			},
			"bandori": {
				BANDORI_LIST_URL: ns_bandori_BANDORI_LIST_URL,
				BANDORI_TZ: ns_bandori_BANDORI_TZ,
				bandoriActiveGachaSections: ns_bandori_bandoriActiveGachaSections,
				bandoriActiveSections: ns_bandori_bandoriActiveSections,
				bandoriDetailUrl: ns_bandori_bandoriDetailUrl,
				bandoriRolesFromSection: ns_bandori_bandoriRolesFromSection,
				bandoriSectionItem: ns_bandori_bandoriSectionItem,
				bandoriTitle: ns_bandori_bandoriTitle,
				eventsBandori: ns_bandori_eventsBandori,
				gachaBandori: ns_bandori_gachaBandori,
				parseBandoriDate: ns_bandori_parseBandoriDate,
				parseBandoriList: ns_bandori_parseBandoriList,
				parseBandoriSections: ns_bandori_parseBandoriSections,
				parseBandoriWindow: ns_bandori_parseBandoriWindow,
				pickBandoriEventSection: ns_bandori_pickBandoriEventSection,
				pickBandoriGachaSection: ns_bandori_pickBandoriGachaSection,
			},
			"ournotes": {
				OURNOTES_LIST_URL: ns_ournotes_OURNOTES_LIST_URL,
				OURNOTES_TZ: ns_ournotes_OURNOTES_TZ,
				eventsOurNotes: ns_ournotes_eventsOurNotes,
				ournotesTitle: ns_ournotes_ournotesTitle,
				parseOurNotesInstant: ns_ournotes_parseOurNotesInstant,
				parseOurNotesPosts: ns_ournotes_parseOurNotesPosts,
				parseOurNotesWindows: ns_ournotes_parseOurNotesWindows,
				selectOurNotesPrimary: ns_ournotes_selectOurNotesPrimary,
			},
			"fgo": {
				FGO_API: ns_fgo_FGO_API,
				FGO_EVENT_PAGE: ns_fgo_FGO_EVENT_PAGE,
				FGO_EVENT_URL: ns_fgo_FGO_EVENT_URL,
				FGO_GACHA_PAGE: ns_fgo_FGO_GACHA_PAGE,
				FGO_GACHA_URL: ns_fgo_FGO_GACHA_URL,
				// FGO 日服（Atlas Academy，2026-11-14 接入）：两个端点 + 纯函数（sentinel 判定 / 选当期）
				FGO_JP_EVENT_URL: ns_fgo_jp_EVENT_URL,
				FGO_JP_GACHA_URL: ns_fgo_jp_GACHA_URL,
				FGO_JP_TZ: ns_fgo_jp_TZ,
				FGO_TZ: ns_fgo_FGO_TZ,
				eventsFgo: ns_fgo_eventsFgo,
				eventsFgoJp: ns_fgo_jp_eventsFgoJp,
				fgoJpItemsOf: ns_fgo_jp_itemsOf,
				fgoJpPickCurrent: ns_fgo_jp_pickCurrent,
				fgoJpUniqueOf: ns_fgo_jp_uniqueOf,
				fgoParseUrl: ns_fgo_fgoParseUrl,
				fgoTables: ns_fgo_fgoTables,
				findFgoEventTable: ns_fgo_findFgoEventTable,
				formatFgoRoles: ns_fgo_formatFgoRoles,
				gachaFgo: ns_fgo_gachaFgo,
				gachaFgoJp: ns_fgo_jp_gachaFgoJp,
				parseFgoBannerTable: ns_fgo_parseFgoBannerTable,
				parseFgoEventTable: ns_fgo_parseFgoEventTable,
				parseFgoWindow: ns_fgo_parseFgoWindow,
			},
			// 星铁：卡池默认源换成**官方公告 CMS**（2026-11-09）后新增的解析/抓取器。
			// 回归要点：正文累积（后一期抄前一期）⇒ 全部窗口 + 角色合并；起点三态（锚 10:00）；
			// upcoming 分支（当期没有覆盖 now 的窗口 ⇒ 取下一个要开的）；bwiki 备选仍走旧抓取器。
			"hsr": {
				HSR_BWIKI_URL,
				HSR_CMS_LIST_URL,
				HSR_UPDATE_ANCHOR_HOUR,
				HSR_WARP_TIME_RE,
				fetchHsrGacha,
				hsrWarpWindowsOf,
				parseHsrWarp,
			},
			"miyoushe": {
				MIYOUSHE_DETAIL_DELAY_MS: ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS,
				MIYOUSHE_GIDS: ns_miyoushe_MIYOUSHE_GIDS,
				MIYOUSHE_MAX_DETAILS: ns_miyoushe_MIYOUSHE_MAX_DETAILS,
				MIYOUSHE_REFERER: ns_miyoushe_MIYOUSHE_REFERER,
				MIYOUSHE_TYPES: ns_miyoushe_MIYOUSHE_TYPES,
				MIYOUSHE_TZ: ns_miyoushe_MIYOUSHE_TZ,
				classifyMiyousheTitle: ns_miyoushe_classifyMiyousheTitle,
				collectMiyousheWindows: ns_miyoushe_collectMiyousheWindows,
				eventsMiyoushe: ns_miyoushe_eventsMiyoushe,
				gachaMiyoushe: ns_miyoushe_gachaMiyoushe,
				isMiyousheMissing: ns_miyoushe_isMiyousheMissing,
				miyousheDetailUrl: ns_miyoushe_miyousheDetailUrl,
				miyousheListUrl: ns_miyoushe_miyousheListUrl,
				miyousheRoles: ns_miyoushe_miyousheRoles,
				miyousheVersionStarts: ns_miyoushe_miyousheVersionStarts,
				parseMiyousheDetail: ns_miyoushe_parseMiyousheDetail,
				parseMiyousheList: ns_miyoushe_parseMiyousheList,
				parseNewsMeta: ns_miyoushe_parseNewsMeta,
			},
			"umamusume-official": {
				UMA_DEFAULT_MAX_DETAILS: ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
				UMA_DEFAULT_MAX_PAGES: ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
				UMA_DEFAULT_PAGE_SIZE: ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
				UMA_GLOBAL_DETAIL_URL: ns_umamusume_official_UMA_GLOBAL_DETAIL_URL,
				UMA_GLOBAL_INDEX_URL: ns_umamusume_official_UMA_GLOBAL_INDEX_URL,
				UMA_GLOBAL_LABEL_GAME: ns_umamusume_official_UMA_GLOBAL_LABEL_GAME,
				UMA_GLOBAL_TZ: ns_umamusume_official_UMA_GLOBAL_TZ,
				UMA_JP_DETAIL_URL: ns_umamusume_official_UMA_JP_DETAIL_URL,
				UMA_JP_INDEX_URL: ns_umamusume_official_UMA_JP_INDEX_URL,
				UMA_JP_TZ: ns_umamusume_official_UMA_JP_TZ,
				classifyUmaTitle: ns_umamusume_official_classifyUmaTitle,
				eventsUmaGlobal: ns_umamusume_official_eventsUmaGlobal,
				eventsUmaJpOfficial: ns_umamusume_official_eventsUmaJpOfficial,
				extractUmaRangePlates: ns_umamusume_official_extractUmaRangePlates,
				gachaUmaGlobal: ns_umamusume_official_gachaUmaGlobal,
				gachaUmaJpOfficial: ns_umamusume_official_gachaUmaJpOfficial,
				labelBeforeUma: ns_umamusume_official_labelBeforeUma,
				parseUmaDetail: ns_umamusume_official_parseUmaDetail,
				parseUmaIndex: ns_umamusume_official_parseUmaIndex,
				parseUmaInstant: ns_umamusume_official_parseUmaInstant,
				parseUmaWindows: ns_umamusume_official_parseUmaWindows,
				pickUmaWindow: ns_umamusume_official_pickUmaWindow,
				postJsonUma: ns_umamusume_official_postJsonUma,
				proxyUrlFor: ns_umamusume_official_proxyUrlFor,
				tokenizeUma: ns_umamusume_official_tokenizeUma,
				umaCurrentItems: ns_umamusume_official_umaCurrentItems,
				umaJpPageUrl: ns_umamusume_official_umaJpPageUrl,
			},
			"komoe": {
				KOMOE_TW_REFERER,
				KOMOE_TW_SOURCE_LABEL,
				KOMOE_TW_TZ,
				KOMOE_TW_TYPE_NOTICE,
				KOMOE_TW_URL,
				fetchUmaTw: ns_komoe_fetchUmaTw,
				komoeTwAnnouncementsOf,
				komoeTwItemsOf,
				komoeTwPayloadOf,
				komoeTwSideOf,
				komoeTwTextLinesOf,
				komoeTwWindowOfLine,
				komoeTwWindowsOf,
			},
			// 2026-11-15：赛马娘·韩服（Daum 카페 月间日程帖，见 30-game-daum.js）。
			// 导出小步：夹具可以分别钉「列表页认不认得出置顶稿」「正文分块」「韩文区间」「角色小节」。
			"umakr": {
				UMA_KR_BOARD_URL,
				UMA_KR_SCHEDULE_URL,
				UMA_KR_SOURCE_LABEL,
				UMA_KR_TZ,
				fetchUmaKr: ns_umakr_fetchUmaKr,
				umaKrBlocksOf,
				umaKrHintOf,
				umaKrItemsOf,
				umaKrLinesOf,
				umaKrNoticesOf,
				umaKrPayloadOf,
				umaKrPoolTypeOf,
				umaKrRolesOf,
				umaKrScheduleRowOf,
				umaKrWindowOfBlock,
				umaKrWindowOfLine,
			},
			// 2026-11-13：TapTap 官方账号 tab 页的 SSR 解码（嘟嘟脸 / 夜幕之下共用，见 22-fetcher-core.js）。
			// 导出小步：夹具可以分别钉「devalue 解引用」「结构定位」「行文本」「页码 → URL」，
			// 反证也能精确指向坏在哪一步（没有 `__NUXT_DATA__` / 解码坏 / 找不到列表 / 一帖都没有）。
			"taptap-topic": {
				NS_TAPTAP_TOPIC_MAX_PAGES,
				NS_TAPTAP_TOPIC_MOMENT_URL,
				ns_taptap_topicDataOf,
				ns_taptap_topicListOf,
				ns_taptap_topicPageUrl,
				ns_taptap_topicPostsOf,
				ns_taptap_topicResolve,
			},
			"biligame-announce": {
				DDLEZJ_CMS_TZ: ns_biligame_announce_DDLEZJ_CMS_TZ,
				DDLEZJ_GAME_EXTENSION_ID: ns_biligame_announce_DDLEZJ_GAME_EXTENSION_ID,
				DDLEZJ_HOME: ns_biligame_announce_DDLEZJ_HOME,
				DDLEZJ_LIST_URL: ns_biligame_announce_DDLEZJ_LIST_URL,
				DDLEZJ_TAPTAP_API: ns_biligame_announce_DDLEZJ_TAPTAP_API,
				DDLEZJ_TAPTAP_GROUP_ID: ns_biligame_announce_DDLEZJ_TAPTAP_GROUP_ID,
				DDLEZJ_TAPTAP_LIMIT: ns_biligame_announce_DDLEZJ_TAPTAP_LIMIT,
				DDLEZJ_TAPTAP_MAX_DETAILS: ns_biligame_announce_DDLEZJ_TAPTAP_MAX_DETAILS,
				DDLEZJ_TAPTAP_MAX_PAGES: ns_biligame_announce_DDLEZJ_TAPTAP_MAX_PAGES,
				DDLEZJ_TAPTAP_PAGE_URL: ns_biligame_announce_DDLEZJ_TAPTAP_PAGE_URL,
				DDLEZJ_TAPTAP_TZ: ns_biligame_announce_DDLEZJ_TAPTAP_TZ,
				DDLEZJ_TAPTAP_XUA: ns_biligame_announce_DDLEZJ_TAPTAP_XUA,
				DDLEZJ_TZ: ns_biligame_announce_DDLEZJ_TZ,
				ddlezjDetailUrl: ns_biligame_announce_ddlezjDetailUrl,
				ddlezjParagraphs: ns_biligame_announce_ddlezjParagraphs,
				ddlezjTaptapAnchor: ns_biligame_announce_ddlezjTaptapAnchor,
				ddlezjTaptapApiUrl: ns_biligame_announce_ddlezjTaptapApiUrl,
				ddlezjTaptapDetailUrl: ns_biligame_announce_ddlezjTaptapDetailUrl,
				ddlezjTaptapPageUrl: ns_biligame_announce_ddlezjTaptapPageUrl,
				ddlezjTaptapTitlesOf: ns_biligame_announce_ddlezjTaptapTitlesOf,
				ddlezjTaptapWindowOf: ns_biligame_announce_ddlezjTaptapWindowOf,
				eventsDdlezj: ns_biligame_announce_eventsDdlezj,
				eventsDdlezjTaptap: ns_biligame_announce_eventsDdlezjTaptap,
				// 2026-11-13：活动侧默认 = tab 页 SSR（robots 允许的路径，1 个请求）
				eventsDdlezjTopic: ns_biligame_announce_eventsDdlezjTopic,
				gachaDdlezj: ns_biligame_announce_gachaDdlezj,
				gachaDdlezjTaptap: ns_biligame_announce_gachaDdlezjTaptap,
				parseDdlezjAnnouncement: ns_biligame_announce_parseDdlezjAnnouncement,
				parseDdlezjDate: ns_biligame_announce_parseDdlezjDate,
				parseDdlezjList: ns_biligame_announce_parseDdlezjList,
				parseDdlezjStamp: ns_biligame_announce_parseDdlezjStamp,
				parseDdlezjTaptapBody: ns_biligame_announce_parseDdlezjTaptapBody,
				parseDdlezjTaptapList: ns_biligame_announce_parseDdlezjTaptapList,
				parseDdlezjTaptapText: ns_biligame_announce_parseDdlezjTaptapText,
				parseDdlezjWindows: ns_biligame_announce_parseDdlezjWindows,
				pickDdlezjEvent: ns_biligame_announce_pickDdlezjEvent,
				pickDdlezjGacha: ns_biligame_announce_pickDdlezjGacha,
			},
			"kedr-wiki": {
				KEDR_API: ns_kedr_wiki_KEDR_API,
				KEDR_ARCHIVE_PAGE: ns_kedr_wiki_KEDR_ARCHIVE_PAGE,
				KEDR_ARCHIVE_URL: ns_kedr_wiki_KEDR_ARCHIVE_URL,
				KEDR_REFERER: ns_kedr_wiki_KEDR_REFERER,
				KEDR_TZ: ns_kedr_wiki_KEDR_TZ,
				gachaKedrWiki: ns_kedr_wiki_gachaKedrWiki,
				kedrParseUrl: ns_kedr_wiki_kedrParseUrl,
				kedrPools: ns_kedr_wiki_kedrPools,
				kedrRoles: ns_kedr_wiki_kedrRoles,
				kedrSections: ns_kedr_wiki_kedrSections,
				kedrStamp: ns_kedr_wiki_kedrStamp,
				parseKedrArchive: ns_kedr_wiki_parseKedrArchive,
			},
			"stellasora": {
				STELLA_BASE: ns_stellasora_STELLA_BASE,
				STELLA_TZ: ns_stellasora_STELLA_TZ,
				eventsStellasora: ns_stellasora_eventsStellasora,
				gachaStellasora: ns_stellasora_gachaStellasora,
				parseStellaList: ns_stellasora_parseStellaList,
				parseStellaWindow: ns_stellasora_parseStellaWindow,
				parseStellaWindows: ns_stellasora_parseStellaWindows,
				stellaDetailUrl: ns_stellasora_stellaDetailUrl,
				stellaFeatured: ns_stellasora_stellaFeatured,
				stellaFeaturedName: ns_stellasora_stellaFeaturedName,
				stellaGachaName: ns_stellasora_stellaGachaName,
				stellaIsEvent: ns_stellasora_stellaIsEvent,
				stellaIsGacha: ns_stellasora_stellaIsGacha,
				stellaListUrl: ns_stellasora_stellaListUrl,
				stellaPageUrl: ns_stellasora_stellaPageUrl,
				stellaPickOrderOf: ns_stellasora_stellaPickOrderOf,
				stellaRolesOf: ns_stellasora_stellaRolesOf,
				STELLA_SCAN_PAGES: ns_stellasora_STELLA_SCAN_PAGES,
				STELLA_SCAN_SIZE: ns_stellasora_STELLA_SCAN_SIZE,
				stellaWindowsFromDetail: ns_stellasora_stellaWindowsFromDetail,
			},
			"bwiki-wikitext": {
				CZN_MODULE_PAGE: ns_bwiki_wikitext_CZN_MODULE_PAGE,
				CZN_MODULE_URL: ns_bwiki_wikitext_CZN_MODULE_URL,
				CZN_RECORD_PAGE: ns_bwiki_wikitext_CZN_RECORD_PAGE,
				CZN_RECORD_URL: ns_bwiki_wikitext_CZN_RECORD_URL,
				CZN_REFERER: ns_bwiki_wikitext_CZN_REFERER,
				CZN_TZ: ns_bwiki_wikitext_CZN_TZ,
				KEDR_REFERER: ns_bwiki_wikitext_KEDR_REFERER,
				KEDR_TEMPLATE_PAGE: ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE,
				KEDR_TEMPLATE_URL: ns_bwiki_wikitext_KEDR_TEMPLATE_URL,
				KEDR_TZ: ns_bwiki_wikitext_KEDR_TZ,
				ZSPMS_ASK_QUERY: ns_bwiki_wikitext_ZSPMS_ASK_QUERY,
				ZSPMS_ASK_URL: ns_bwiki_wikitext_ZSPMS_ASK_URL,
				ZSPMS_CALENDAR_PAGE: ns_bwiki_wikitext_ZSPMS_CALENDAR_PAGE,
				ZSPMS_CALENDAR_URL: ns_bwiki_wikitext_ZSPMS_CALENDAR_URL,
				ZSPMS_FLAGS_PAGE: ns_bwiki_wikitext_ZSPMS_FLAGS_PAGE,
				ZSPMS_FLAGS_URL: ns_bwiki_wikitext_ZSPMS_FLAGS_URL,
				ZSPMS_REFERER: ns_bwiki_wikitext_ZSPMS_REFERER,
				ZSPMS_TZ: ns_bwiki_wikitext_ZSPMS_TZ,
				cznStamp: ns_bwiki_wikitext_cznStamp,
				eventsKedrTemplate: ns_bwiki_wikitext_eventsKedrTemplate,
				eventsZspms: ns_bwiki_wikitext_eventsZspms,
				eventsZspmsCalendar: ns_bwiki_wikitext_eventsZspmsCalendar,
				gachaCzn: ns_bwiki_wikitext_gachaCzn,
				gachaKedrTemplate: ns_bwiki_wikitext_gachaKedrTemplate,
				gachaZspms: ns_bwiki_wikitext_gachaZspms,
				gachaZspmsFlags: ns_bwiki_wikitext_gachaZspmsFlags,
				kedrIsEvent: ns_bwiki_wikitext_kedrIsEvent,
				kedrIsGacha: ns_bwiki_wikitext_kedrIsGacha,
				kedrRoleFromName: ns_bwiki_wikitext_kedrRoleFromName,
				kedrStamp: ns_bwiki_wikitext_kedrStamp,
				kedrTemplateCalls: ns_bwiki_wikitext_kedrTemplateCalls,
				kedrTemplateUrl: ns_bwiki_wikitext_kedrTemplateUrl,
				mediaWikiWikitext: ns_bwiki_wikitext_mediaWikiWikitext,
				parseCznLua: ns_bwiki_wikitext_parseCznLua,
				parseCznRecord: ns_bwiki_wikitext_parseCznRecord,
				parseKedrTemplate: ns_bwiki_wikitext_parseKedrTemplate,
				parseZspmsAnnouncement: ns_bwiki_wikitext_parseZspmsAnnouncement,
				parseZspmsAsk: ns_bwiki_wikitext_parseZspmsAsk,
				parseZspmsCalendar: ns_bwiki_wikitext_parseZspmsCalendar,
				parseZspmsFlags: ns_bwiki_wikitext_parseZspmsFlags,
				zspmsEventTier: ns_bwiki_wikitext_zspmsEventTier,
				zspmsHeadings: ns_bwiki_wikitext_zspmsHeadings,
				zspmsLatestNotice: ns_bwiki_wikitext_zspmsLatestNotice,
				zspmsMaintenanceWindow: ns_bwiki_wikitext_zspmsMaintenanceWindow,
				zspmsNameAt: ns_bwiki_wikitext_zspmsNameAt,
				zspmsNormalize: ns_bwiki_wikitext_zspmsNormalize,
				zspmsParseUrl: ns_bwiki_wikitext_zspmsParseUrl,
			},
			"zspms-official": {
				ZSPMS_CDN_ARTICLE_BASE: ns_zspms_cdn_ARTICLE_BASE,
				ZSPMS_CDN_MAX_NOTICES: ns_zspms_cdn_MAX_NOTICES,
				ZSPMS_CDN_MENU_URL: ns_zspms_cdn_MENU_URL,
				ZSPMS_CDN_TZ: ns_zspms_cdn_TZ,
				eventsZspmsCdn: ns_zspms_cdn_events,
				zspmsCdnActivitiesOfArticle: ns_zspms_cdn_activitiesOfArticle,
				zspmsCdnArticleOf: ns_zspms_cdn_articleOf,
				zspmsCdnArticleUrl: ns_zspms_cdn_articleUrl,
				zspmsCdnCleanName: ns_zspms_cdn_cleanName,
				zspmsCdnHintOf: ns_zspms_cdn_hintOf,
				zspmsCdnIsGenericName: ns_zspms_cdn_isGenericName,
				zspmsCdnLinesOf: ns_zspms_cdn_linesOf,
				zspmsCdnMenuRows: ns_zspms_cdn_menuRows,
				zspmsCdnNoticesOf: ns_zspms_cdn_noticesOf,
				zspmsCdnTitleName: ns_zspms_cdn_titleName,
				zspmsCdnWindowsOfLine: ns_zspms_cdn_windowsOfLine,
			},
			"biligame-activity": {
				BILIGAME_ACTIVITY_TZ: ns_biligame_activity_BILIGAME_ACTIVITY_TZ,
				UMA_CN_GAME_EXTENSION_ID: ns_biligame_activity_UMA_CN_GAME_EXTENSION_ID,
				UMA_CN_HOME: ns_biligame_activity_UMA_CN_HOME,
				UMA_CN_LIST_URL: ns_biligame_activity_UMA_CN_LIST_URL,
				WHMX_GAME_EXTENSION_ID: ns_biligame_activity_WHMX_GAME_EXTENSION_ID,
				WHMX_HOME: ns_biligame_activity_WHMX_HOME,
				WHMX_LIST_URL: ns_biligame_activity_WHMX_LIST_URL,
				WHMX_LIST_URLS: ns_biligame_activity_WHMX_LIST_URLS,
				WHMX_TYPE_IDS: ns_biligame_activity_WHMX_TYPE_IDS,
				biligameDetailUrl: ns_biligame_activity_biligameDetailUrl,
				biligameListUrl: ns_biligame_activity_biligameListUrl,
				biligameParagraphs: ns_biligame_activity_biligameParagraphs,
				classifyUmaCnTitle: ns_biligame_activity_classifyUmaCnTitle,
				cleanTitle: ns_biligame_activity_cleanTitle,
				coveringWhmxEvents: ns_biligame_activity_coveringWhmxEvents,
				deglueDateTimes: ns_biligame_activity_deglueDateTimes,
				eventsUmaCnOfficial: ns_biligame_activity_eventsUmaCnOfficial,
				eventsWhmxOfficial: ns_biligame_activity_eventsWhmxOfficial,
				extractWindowsDetailed: ns_biligame_activity_extractWindowsDetailed,
				gachaUmaCnOfficial: ns_biligame_activity_gachaUmaCnOfficial,
				hoverRows: ns_biligame_activity_hoverRows,
				mergeBiligameLists: ns_biligame_activity_mergeBiligameLists,
				parseBiligameList: ns_biligame_activity_parseBiligameList,
				parseCmsStamp: ns_biligame_activity_parseCmsStamp,
				parseUmaCnAnnouncement: ns_biligame_activity_parseUmaCnAnnouncement,
				parseWhmxActivity: ns_biligame_activity_parseWhmxActivity,
				pickUmaWindow: ns_biligame_activity_pickUmaWindow,
				pickWhmxEvent: ns_biligame_activity_pickWhmxEvent,
				quotedName: ns_biligame_activity_quotedName,
				siblingListUrl: ns_biligame_activity_siblingListUrl,
				umaRoles: ns_biligame_activity_umaRoles,
				whmxListUrls: ns_biligame_activity_whmxListUrls,
			},
			"ournotes-global": {
				OURNOTES_GLOBAL_GAME_BASE_ID: ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID,
				OURNOTES_GLOBAL_HOME: ns_ournotes_global_OURNOTES_GLOBAL_HOME,
				OURNOTES_GLOBAL_LANGS: ns_ournotes_global_OURNOTES_GLOBAL_LANGS,
				OURNOTES_GLOBAL_LIST_URL: ns_ournotes_global_OURNOTES_GLOBAL_LIST_URL,
				OURNOTES_GLOBAL_TZ: ns_ournotes_global_OURNOTES_GLOBAL_TZ,
				classifyOurNotesGlobalTitle: ns_ournotes_global_classifyOurNotesGlobalTitle,
				cleanTitle: ns_ournotes_global_cleanTitle,
				eventsOurNotesGlobal: ns_ournotes_global_eventsOurNotesGlobal,
				extractOurNotesGlobalWindows: ns_ournotes_global_extractOurNotesGlobalWindows,
				gachaOurNotesGlobal: ns_ournotes_global_gachaOurNotesGlobal,
				isOurNotesGlobalEmpty: ns_ournotes_global_isOurNotesGlobalEmpty,
				langOf: ns_ournotes_global_langOf,
				ournotesGlobalDetailText: ns_ournotes_global_ournotesGlobalDetailText,
				ournotesGlobalDetailUrl: ns_ournotes_global_ournotesGlobalDetailUrl,
				ournotesGlobalListUrl: ns_ournotes_global_ournotesGlobalListUrl,
				ournotesGlobalStructuredWindow: ns_ournotes_global_ournotesGlobalStructuredWindow,
				ournotesGlobalTitle: ns_ournotes_global_ournotesGlobalTitle,
				parseOurNotesGlobalPage: ns_ournotes_global_parseOurNotesGlobalPage,
				parseOurNotesGlobalStamp: ns_ournotes_global_parseOurNotesGlobalStamp,
				pickOurNotesGlobalWindow: ns_ournotes_global_pickOurNotesGlobalWindow,
			},
			// 2026-11-11：OurNotes **国际服**的默认源（SPICA 结构化数据 JSON：`_durl` → d-*.json）。
			// 与上面那份 "ournotes-global" 是**两套东西**：那份是 BHK 官方公告（现已降为手动备选源），
			// 这份是新的默认源。命名空间刻意分开，免得测试里把两套解析器混着断言。
			"ournotes-global-spica": {
				NS_ON_GLOBAL_DATA_TZ,
				NS_ON_GLOBAL_NAME_LANGS,
				NS_ON_GLOBAL_REFERER,
				NS_ON_GLOBAL_SOURCE_LABEL,
				NS_ON_GLOBAL_TZ,
				NS_ON_GLOBAL_URL,
				ns_on_global_dataUrlOf,
				ns_on_global_durlOf,
				ns_on_global_eventItemsOf,
				ns_on_global_eventPayloadOf,
				ns_on_global_fetchEvents,
				ns_on_global_fetchGacha,
				ns_on_global_gachaItemsOf,
				ns_on_global_gachaPayloadOf,
				ns_on_global_instantOf,
				ns_on_global_nameOf,
				ns_on_global_rolesOf,
				ns_on_global_wallOf,
				ns_on_global_windowOf,
			},
			// 明日方舟（PRTS）：活动侧有**两个**来源，都导出成纯函数，离线就能钉住两边：
			//   · 默认「PRTS 活动解析」= SMW 单请求（action=ask）：三态数据（活动开始 / 活动结束 /
			//     兑换结束）一次定齐 ⇒ parseArknightsSmwEvents；
			//   · 备选「PRTS 活动一览」= 旧 HTML 解析链路（从 8de869d 恢复，手动切换才走）⇒
			//     collectPrtsEvents / prtsEventSnapshot / 批量 wikitext 那几个（见 cases-arknights-claim ⑦）。
			"arknights": {
				ARKNIGHTS_EVENTS_LIST_URL,
				ARKNIGHTS_SMW_QUERY,
				ARKNIGHTS_SMW_URL,
				PRTS_CLAIM_MAX_TITLES,
				PRTS_PAGES_API,
				// labelOf = 分类前缀去重（纯函数）：name 已带 <category>： 前缀 ⇒ 原样返回，否则拼一次。
				labelOf,
				collectPrtsEvents,
				parseArknightsSmwEvents,
				parsePrtsPageEndTimes,
				prtsClaimTitles,
				prtsEventPayload,
				prtsEventSnapshot,
				prtsPageNameFromHref,
				prtsPageTimesFromBatch,
			},
			// 2026-11-11 第二批（三处新来源）：纯函数导出给 `test/cases-batch2.mjs` 逐条钉住 ——
			// 崩坏3 内容中台（卡池名称/角色 + 档期三级取值、活动时间块）、OurNotes 日服 SPICA（列表/详情）、
			// 卡厄斯梦境 TapTap（2026-11-13 换 topic 页 SSR：Nuxt devalue 解码 + 卡池/活动标签解析）。
			// 抓取器本身走 `GACHA_FETCHERS` / `EVENT_FETCHERS`。
			"batch2": {
				NS_BATCH2_BH3_EVENT_URL,
				NS_BATCH2_BH3_GACHA_URL,
				NS_BATCH2_BH3_SOURCE_LABEL,
				NS_BATCH2_BH3_TZ,
				NS_BATCH2_CZN_PAGES,
				NS_BATCH2_CZN_SOURCE_LABEL,
				NS_BATCH2_CZN_TOPIC_URL,
				NS_BATCH2_CZN_TZ,
				NS_BATCH2_SPICA_DETAIL_BASE,
				NS_BATCH2_SPICA_LIST_URL,
				NS_BATCH2_SPICA_MAX_DETAILS,
				NS_BATCH2_SPICA_SOURCE_LABEL,
				NS_BATCH2_SPICA_TZ,
				ns_batch2_bh3EventBlockOf,
				ns_batch2_bh3EventItemsOf,
				ns_batch2_bh3EventPayloadOf,
				ns_batch2_bh3EventWindowOf,
				ns_batch2_bh3GachaPayloadOf,
				ns_batch2_bh3GachaWindowOf,
				ns_batch2_bh3GiftWindowsOf,
				ns_batch2_bh3RangeOf,
				ns_batch2_bh3RangesOf,
				ns_batch2_bh3RolesOf,
				ns_batch2_bh3Text,
				ns_batch2_bh3WallOf,
				ns_batch2_cznCreatedTsOf,
				ns_batch2_cznDevalueOf,
				ns_batch2_cznDocOf,
				ns_batch2_cznDocsOf,
				ns_batch2_cznEventPayloadOf,
				ns_batch2_cznEventRowsOf,
				ns_batch2_cznEventWindowOf,
				ns_batch2_cznGachaPayloadOf,
				ns_batch2_cznMaintWindowsOf,
				ns_batch2_cznNuxtTextOf,
				ns_batch2_cznPagesOf,
				ns_batch2_cznPayloadOf,
				ns_batch2_cznPeriodWindowOf,
				ns_batch2_cznPoolHeadOf,
				ns_batch2_cznPoolsOf,
				ns_batch2_cznPostsOf,
				ns_batch2_cznQuotedOf,
				ns_batch2_cznTopicUrlOf,
				ns_batch2_cznWindowOf,
				ns_batch2_fetchBh3Events,
				ns_batch2_fetchBh3Gacha,
				ns_batch2_fetchCznEvents,
				ns_batch2_fetchCznGacha,
				ns_batch2_fetchSpicaGacha,
				ns_batch2_spicaDetailOf,
				ns_batch2_spicaIdsOf,
				ns_batch2_spicaPayloadOf,
				ns_batch2_spicaRolesOf,
			},
			"bh2": {
				BH2_DETAIL_URL: ns_bh2_DETAIL_URL,
				BH2_LIST_URL: ns_bh2_LIST_URL,
				BH2_MAX_DETAILS: ns_bh2_MAX_DETAILS,
				BH2_REFERER: ns_bh2_REFERER,
				BH2_TZ: ns_bh2_TZ,
				bh2EventPayloadOf: ns_bh2_eventPayloadOf,
				bh2GachaPayloadOf: ns_bh2_gachaPayloadOf,
				bh2ItemOf: ns_bh2_itemOf,
				bh2LinesOf: ns_bh2_linesOf,
				bh2ListOf: ns_bh2_listOf,
				bh2UpRolesOf: ns_bh2_upRolesOf,
				bh2WindowOf: ns_bh2_windowOf,
				eventsBh2: ns_bh2_events,
				gachaBh2: ns_bh2_gacha
			},
			// 2026-11-15 以闪亮之名（yslz）：bwiki 两个分类（卡池 `Category:限时追光` / 活动 `Category:活动`）。
			// 导出「URL + 纯解析 + 抓取器」三层，回归可以分别钉住：脏日期归一 / 复刻档 / 分页请求数 /
			// `{}` ⇒ 抛错 / 抹掉时间锚点 ⇒ 不进外显。
			"yslz": {
				YSLZ_EVENTS_QUERY: ns_yslz_EVENTS_QUERY,
				YSLZ_EVENTS_URL: ns_yslz_EVENTS_URL,
				YSLZ_GACHA_CATEGORY: ns_yslz_GACHA_CATEGORY,
				YSLZ_GACHA_URL: ns_yslz_GACHA_URL,
				YSLZ_REFERER: ns_yslz_REFERER,
				YSLZ_RERUN_TAG: ns_yslz_RERUN_TAG,
				YSLZ_TZ: ns_yslz_TZ,
				eventsYslz: ns_yslz_events,
				gachaYslz: ns_yslz_gacha,
				yslzEventsUrlOf: ns_yslz_eventsUrlOf,
				yslzFieldOf: ns_yslz_fieldOf,
				yslzGachaPageUrl: ns_yslz_gachaPageUrl,
				yslzParseEvents: ns_yslz_parseEvents,
				yslzParsePools: ns_yslz_parsePools,
				yslzPoolRolesOf: ns_yslz_poolRolesOf,
				yslzRerunsOf: ns_yslz_rerunsOf,
				yslzWindowOf: ns_yslz_windowOf
			},
			// 2026-11-15 无限暖暖（国服）：官网「资讯快报」列表 + 详情（`__NEXT_DATA__` 的 pageData）。
			// 抓取器整体导出（`fetchWxnn`）便于回归直接驱动"列表 1 次 + 新 id 详情 + 缓存"；
			// 其余全是纯函数，口径（锚点 / 档期 / 维护窗兜底 / 载荷）逐条可断言。
			"wxnn": {
				WXNN_CACHE_MAX,
				WXNN_DETAIL_TTL_MS,
				WXNN_EMPTY_RETRY,
				WXNN_EMPTY_RETRY_MS,
				WXNN_LIST_URL,
				WXNN_NAME_LOOKBACK,
				WXNN_NEWS_BASE,
				WXNN_SOURCE_LABEL,
				WXNN_TZ,
				WXNN_WINDOW_RE,
				fetchWxnn: ns_wxnn_fetchWxnn,
				wxnnCachedOf,
				wxnnCollect,
				wxnnDedupe,
				wxnnEventNameOf,
				wxnnFactsOf,
				wxnnListOf,
				wxnnLinesOf,
				wxnnMaintIndexOf,
				wxnnMaintOf,
				wxnnPageOf,
				wxnnPayloadOf,
				wxnnPrune,
				wxnnResolveStarts,
				wxnnSealedOf,
				wxnnTimestampOf,
				wxnnWindowOf},
			// 2026-11-15 碧蓝航线（国服 hl 只接活动 / 日服 hl-jp 卡池 + 活动，见 30-game-hl.js）：
			// 导出「URL + 纯解析 + 缓存复位 + 抓取器」四层，回归可以分别钉住：
			// 国服的 `活动时间` 锚点 / 「维护后」用同篇维护结束时刻 / `{}` ⇒ 抛错 / 抹掉锚点 ⇒ 不出窗口；
			// 日服的「開催期間」行解析 / 池的舰名段 / 段首归属重置 / 轮内列表共享 + 按 id 缓存。
			"hl": {
				HL_CACHE_TTL_MS: ns_hl_CACHE_TTL_MS,
				HL_CN_DETAIL_BASE: ns_hl_CN_DETAIL_BASE,
				HL_CN_HOME: ns_hl_CN_HOME,
				HL_CN_LIST_URL: ns_hl_CN_LIST_URL,
				HL_CN_MAX_DETAILS: ns_hl_CN_MAX_DETAILS,
				HL_CN_TITLE_RE: ns_hl_CN_TITLE_RE,
				HL_JP_ICON: ns_hl_jp_ICON,
				HL_JP_LIST_URL: ns_hl_jp_LIST_URL,
				HL_JP_SOURCE_LABEL: ns_hl_jp_SOURCE_LABEL,
				HL_JP_TZ: ns_hl_jp_TZ,
				HL_TZ: ns_hl_TZ,
				eventsHl: ns_hl_cn_events,
				eventsHlJp: ns_hl_jp_events,
				gachaHlJp: ns_hl_jp_gacha,
				hlCnDetailOf: ns_hl_cn_detailOf,
				hlCnDetailUrlOf: ns_hl_cn_detailUrlOf,
				hlCnItemAt: ns_hl_cn_itemAt,
				hlCnListOf: ns_hl_cn_listOf,
				hlCnMaintOf: ns_hl_cn_maintOf,
				hlCnNameOf: ns_hl_cn_nameOf,
				hlCnPointOf: ns_hl_cn_pointOf,
				hlCnResetCache: ns_hl_cn_resetCache,
				hlCnStampOf: ns_hl_cn_stampOf,
				hlCnTextOf: ns_hl_cn_textOf,
				hlJpLinesOf: ns_hl_jp_linesOf,
				hlJpListOf: ns_hl_jp_listOf,
				hlJpMaintOf: ns_hl_jp_maintOf,
				hlJpNoticeOf: ns_hl_jp_noticeOf,
				hlJpPointOf: ns_hl_jp_pointOf,
				hlJpPoolRolesOf: ns_hl_jp_poolRolesOf,
				hlJpResetCache: ns_hl_jp_resetCache,
				hlJpWindowOf: ns_hl_jp_windowOf
			},
			// 2026-11-15 公主连结 Re:Dive·繁中服（pcr-tw）：So-net 官网公告（**按页前进**：1 → 2 → 3 页，
			// 页内候选按 (公告日期升序, 站点原序) 取前 2；详情按 id 缓存 24h）。
			// 导出「URL/常量 + 纯解析 + 候选排序 + 缓存复位 + 抓取器」四层，回归可以分别钉住：
			// 列表 `<li>` 三件套（类别只认标题前缀、不认 `ac0X` 类名）/ 详情「整行日期区间 + ■ 名字行」/
			// `{}` ⇒ 抛错 / 抹掉区间 ⇒ 不出窗口 / 每侧每页最多 2 篇详情 + 轮内按页共享列表 /
			// `maxPages=1` 只剩第 1 页 ⇒ 两侧都 nomatch / 三页都没有覆盖 now ⇒ null。
			"pcr-tw": {
				PCR_TW_CACHE_TTL_MS: ns_pcr_TW_CACHE_TTL_MS,
				PCR_TW_DETAIL_BASE: ns_pcr_TW_DETAIL_BASE,
				PCR_TW_HOME: ns_pcr_TW_HOME,
				PCR_TW_ITEM_RE: ns_pcr_TW_ITEM_RE,
				PCR_TW_LABEL_RE: ns_pcr_TW_LABEL_RE,
				PCR_TW_LIST_URL: ns_pcr_TW_LIST_URL,
				PCR_TW_MAX_DETAILS: ns_pcr_TW_MAX_DETAILS,
				PCR_TW_MAX_LIST_PAGES: ns_pcr_TW_MAX_LIST_PAGES,
				PCR_TW_RANGE_RE: ns_pcr_TW_RANGE_RE,
				PCR_TW_SECTION_OPEN: ns_pcr_TW_SECTION_OPEN,
				PCR_TW_SOURCE_LABEL: ns_pcr_TW_SOURCE_LABEL,
				PCR_TW_TZ: ns_pcr_TW_TZ,
				eventsPcrTw: ns_pcr_tw_events,
				gachaPcrTw: ns_pcr_tw_gacha,
				pcrTwCandidatesOf: ns_pcr_tw_candidatesOf,
				pcrTwDateTsOf: ns_pcr_tw_dateTsOf,
				pcrTwDetailOf: ns_pcr_tw_detailOf,
				pcrTwEventItemsOf: ns_pcr_tw_eventItemsOf,
				pcrTwItemsOf: ns_pcr_tw_itemsOf,
				pcrTwKindOf: ns_pcr_tw_kindOf,
				pcrTwLabelOf: ns_pcr_tw_labelOf,
				pcrTwLinesOf: ns_pcr_tw_linesOf,
				pcrTwListOf: ns_pcr_tw_listOf,
				pcrTwPageUrlOf: ns_pcr_tw_pageUrlOf,
				pcrTwPoolItemsOf: ns_pcr_tw_poolItemsOf,
				pcrTwResetCache: ns_pcr_tw_resetCache,
				pcrTwRolesOf: ns_pcr_tw_rolesOf,
				pcrTwSectionOf: ns_pcr_tw_sectionOf,
				pcrTwTitleNameOf: ns_pcr_tw_titleNameOf
			},
			// 2026-11-15 プリンセスコネクト！Re:Dive·日服（pcr-jp）：microCMS 官方公告
			// （列表 1 次 = filters 同圈卡池 + 活动；详情按 id 缓存 24h、已结束永久缓存）。
			// 导出「URL/常量 + 纯解析 + 缓存 + 抓取器」四层，回归可以分别钉住：
			// 列表 kind 分类（本命池 / 活动 / 已结束 / 其他）/ 详情「锚点行 + 整行区间」/
			// 行内日期陷阱不认 / 抹掉锚点 ⇒ 不出窗口 / `{}` ⇒ 抛错 / 首轮 5 次、稳态 1 次。
			"pcr-jp": {
				PCR_JP_API_BASE: ns_pcr_JP_API_BASE,
				PCR_JP_API_KEY: ns_pcr_JP_API_KEY,
				PCR_JP_CACHE_TTL_MS: ns_pcr_JP_CACHE_TTL_MS,
				PCR_JP_DETAIL_BASE: ns_pcr_JP_DETAIL_BASE,
				PCR_JP_EVENT_CATEGORY: ns_pcr_JP_EVENT_CATEGORY,
				PCR_JP_GACHA_TITLE_RE: ns_pcr_JP_GACHA_TITLE_RE,
				PCR_JP_LABEL_RE: ns_pcr_JP_LABEL_RE,
				PCR_JP_LIST_URL: ns_pcr_JP_LIST_URL,
				PCR_JP_MAX_DETAILS: ns_pcr_JP_MAX_DETAILS,
				PCR_JP_RANGE_RE: ns_pcr_JP_RANGE_RE,
				PCR_JP_SOURCE_LABEL: ns_pcr_JP_SOURCE_LABEL,
				PCR_JP_TZ: ns_pcr_JP_TZ,
				eventsPcrJp: ns_pcr_jp_events,
				gachaPcrJp: ns_pcr_jp_gacha,
				pcrJpCacheSealedOf: ns_pcr_jp_cacheSealedOf,
				pcrJpCacheValidOf: ns_pcr_jp_cacheValidOf,
				pcrJpDetailOf: ns_pcr_jp_detailOf,
				pcrJpDetailOfId: ns_pcr_jp_detailOfId,
				pcrJpDetailUrlOf: ns_pcr_jp_detailUrlOf,
				pcrJpEventItemsOf: ns_pcr_jp_eventItemsOf,
				pcrJpEventNameOf: ns_pcr_jp_eventNameOf,
				pcrJpItemsOf: ns_pcr_jp_itemsOf,
				pcrJpKindOf: ns_pcr_jp_kindOf,
				pcrJpLabelOf: ns_pcr_jp_labelOf,
				pcrJpLinesOf: ns_pcr_jp_linesOf,
				pcrJpListOf: ns_pcr_jp_listOf,
				pcrJpPoolItemsOf: ns_pcr_jp_poolItemsOf,
				pcrJpPoolNameOf: ns_pcr_jp_poolNameOf,
				pcrJpResetCache: ns_pcr_jp_resetCache,
				pcrJpRolesOf: ns_pcr_jp_rolesOf,
				pcrJpRowsOf: ns_pcr_jp_rowsOf,
				pcrJpWindowOf: ns_pcr_jp_windowOf
			},
						// 2026-11-15 雷索纳斯（reso）：**卡池主源 = bwiki「活动日历」的 wikitext**
			// （`action=raw` + `revisions` 只补年份）；活动侧默认置空，原 bwiki 活动档降为备选
			// （「Bwiki 活动日历（停更）」，键 reso-activity-stopped）；另一条备选 = 官网首页内联
			// `notice_json`（双重转义 ⇒ 两次 JSON.parse；只在设置里选中时才抓）。两套纯解析都导出，回归分别钉住：
			// · 主源：注释里的旧档期不算 / 模板条件行不算 / 8 条招募逐字 / 年份补全（页面更新年 +
			//   前一年 + 次年镜像 + `endsNextYear` 跨年）/ `{}` ⇒ 抛错 / 无当期 ⇒ null；
			// · 备选源：内联 JSON 抽取 / 缺锚点抛错 / `起止时间` 的 7 种写法 + 年份补全 / 24h 缓存。
			"reso": {
				RESO_ALT_FETCHER: ns_reso_ALT_FETCHER,
				RESO_ALT_SOURCE_LABEL: ns_reso_ALT_SOURCE_LABEL,
				RESO_EVENT_ALT_FETCHER: ns_reso_EVENT_ALT_FETCHER,
				RESO_EVENT_ALT_SOURCE_LABEL: ns_reso_EVENT_ALT_SOURCE_LABEL,
				RESO_HOME: ns_reso_HOME,
				RESO_HOME_CACHE_TTL_MS: ns_reso_HOME_CACHE_TTL_MS,
				RESO_HOME_REFERER: ns_reso_HOME_REFERER,
				RESO_PAGE: ns_reso_PAGE,
				RESO_RAW_URL: ns_reso_RAW_URL,
				RESO_REFERER: ns_reso_REFERER,
				RESO_REV_URL: ns_reso_REV_URL,
				RESO_SOURCE_LABEL: ns_reso_SOURCE_LABEL,
				RESO_TZ: ns_reso_TZ,
				eventsReso: ns_reso_events,
				eventsResoOfficial: ns_reso_officialEvents,
				gachaReso: ns_reso_gacha,
				gachaResoOfficial: ns_reso_officialGacha,
				resoHomeItemsOf: ns_reso_homeItemsOf,
				resoHomeLinesOf: ns_reso_homeLinesOf,
				resoHomeNewestIdOf: ns_reso_homeNewestIdOf,
				resoHomeNoticesOf: ns_reso_homeNoticesOf,
				resoHomeResetCache: ns_reso_homeResetCache,
				resoHomeRoleOf: ns_reso_homeRoleOf,
				resoHomeRowsOf: ns_reso_homeRowsOf,
				resoHomeStartYearOf: ns_reso_homeStartYearOf,
				resoHomeTagOf: ns_reso_homeTagOf,
				resoHomeWindowOf: ns_reso_homeWindowOf,
				resoHomeYearHintOf: ns_reso_homeYearHintOf,
				resoItemsOf: ns_reso_itemsOf,
				resoLinesOf: ns_reso_linesOf,
				resoNameOf: ns_reso_nameOf,
				resoResetCache: ns_reso_resetCache,
				resoRevStampOf: ns_reso_revStampOf,
				resoRowOf: ns_reso_rowOf,
				resoRowsOf: ns_reso_rowsOf,
				resoSideOf: ns_reso_sideOf,
				resoStartYearOf: ns_reso_startYearOf
			},
			// 2026-11-15 幻塔（tof，国服）：官网 `gamenews` 列表（第 1 页 6 条版本公告）+ 最新版本那篇的
			// 正文（`限定拟态角色「…」、限定武器「…」` + `正式服活动时间：…` + `“X订购活动”`）。
			// 导出「URL/常量 + 纯解析 + 缓存复位 + 抓取器」四层，回归可以分别钉住：
			// 列表/详情的失败语义（`{}` ⇒ 抛错）、三版逐字（6.5 / 6.4）、抹掉时间锚点 ⇒ 不进外显、
			// 以及**请求数**（首轮 2 / 稳态 1 —— 复位钩子 `tofResetCache` 只给回归用）。
			"tof": {
				TOF_CACHE_TTL_MS: ns_tof_CACHE_TTL_MS,
				TOF_LIST_URL: ns_tof_LIST_URL,
				TOF_SOURCE_LABEL: ns_tof_SOURCE_LABEL,
				TOF_TZ: ns_tof_TZ,
				gachaTof: ns_tof_gacha,
				tofDateTsOf: ns_tof_dateTsOf,
				tofDetailOf: ns_tof_detailOf,
				tofLinesOf: ns_tof_linesOf,
				tofListOf: ns_tof_listOf,
				tofPoolItemsOf: ns_tof_poolItemsOf,
				tofPoolNameOf: ns_tof_poolNameOf,
				tofResetCache: ns_tof_resetCache,
				tofVersionRowOf: ns_tof_versionRowOf
			},
			// 2026-11-15 炽焰天穹（cytq）：官方 H5 公告（列表 1 次 → 只对在期 & 未缓存的 id 取详情）。
			// 导出「URL + 纯解析 + 缓存复位 + 抓取器」四层，回归可以分别钉住：
			// 列表/详情的失败语义（`{}` ⇒ 抛错 / 抹掉锚点 ⇒ 不出窗口）、角色名单、「维护后」⇒ 起点未知、
			// 以及**请求数**（首轮 1+N / 稳态 1 —— 复位钩子 `cytqResetDetailCache` 只给回归用）。
			"cytq": {
				CYTQ_DETAIL_BASE: ns_cytq_DETAIL_BASE,
				CYTQ_DETAIL_PARAMS: ns_cytq_DETAIL_PARAMS,
				CYTQ_DETAIL_TTL_MS: ns_cytq_DETAIL_TTL_MS,
				CYTQ_ENDED_GRACE_MS: ns_cytq_ENDED_GRACE_MS,
				CYTQ_LIST_URL: ns_cytq_LIST_URL,
				CYTQ_RELATIVE_START_RE: ns_cytq_RELATIVE_START_RE,
				CYTQ_SIDE_BY_CLASS: ns_cytq_SIDE_BY_CLASS,
				CYTQ_TZ: ns_cytq_TZ,
				cytqCacheUsable: ns_cytq_cacheUsable,
				cytqDetailOf: ns_cytq_detailOf,
				cytqDetailUrlOf: ns_cytq_detailUrlOf,
				cytqLinesOf: ns_cytq_linesOf,
				cytqListOf: ns_cytq_listOf,
				cytqPickUpNamesOf: ns_cytq_pickUpNamesOf,
				cytqResetDetailCache: ns_cytq_resetDetailCache,
				cytqStyleNamesOf: ns_cytq_styleNamesOf,
				cytqWindowOf: ns_cytq_windowOf,
				cytqWindowTextOf: ns_cytq_windowTextOf,
				eventsCytq: ns_cytq_events,
				gachaCytq: ns_cytq_gacha
			},
			// 2026-11-15 盲盒派对（gachaparty）：bwiki 卡池模板 `模板:近期盲盒扭蛋` 的 wikitext
			// + 活动侧 SMW `action=ask` 查 `分类:活动`。导出纯解析步，回归可以分别钉住：
			// 注释里的 7 个旧池不算 / 三个在期池逐字（池名 + UP + 起止）/ 命名参数 `补充角色N` 也算 UP /
			// SMW 字符串日期（`"20261029"`）→ 起 00:00 止 23:59 / `{}` ⇒ 抛错 / 抹掉区间 ⇒ 不进外显。
			"gachaparty": {
				GACHAPARTY_EVENT_LABEL: ns_gachaparty_EVENT_LABEL,
				GACHAPARTY_EVENT_QUERY: ns_gachaparty_EVENT_QUERY,
				GACHAPARTY_EVENT_URL: ns_gachaparty_EVENT_URL,
				GACHAPARTY_POOL_LABEL: ns_gachaparty_POOL_LABEL,
				GACHAPARTY_POOL_PAGE: ns_gachaparty_POOL_PAGE,
				GACHAPARTY_POOL_URL: ns_gachaparty_POOL_URL,
				GACHAPARTY_REFERER: ns_gachaparty_REFERER,
				GACHAPARTY_TZ: ns_gachaparty_TZ,
				eventsGachaparty: ns_gachaparty_events,
				gachaGachaparty: ns_gachaparty_gacha,
				gachapartyArgsOf: ns_gachaparty_argsOf,
				gachapartyDayOf: ns_gachaparty_dayOf,
				gachapartyEventsOf: ns_gachaparty_eventsOf,
				gachapartyPointOf: ns_gachaparty_pointOf,
				gachapartyPoolCallsOf: ns_gachaparty_poolCallsOf,
				gachapartyPoolOf: ns_gachaparty_poolOf,
				gachapartyPoolsOf: ns_gachaparty_poolsOf,
				gachapartyTextOf: ns_gachaparty_textOf,
				gachapartyTsOf: ns_gachaparty_tsOf
			},
			// 2026-11-15 第三批：碧蓝幻想（gbf）/ 舰队Collection（kancolle）—— 两条都只接活动侧。
			// 导出「URL + 纯解析（表格/段位 + 档期 + 名称清洗）+ 缓存复位 + 抓取器」四层，回归可以分别钉住：
			// gbf：两张表（現在開催中 / 今後の予定）都认、占位名补前缀、`2027/01/15 ～` 只有起点 ⇒ endTs=null、
			//      `{}` ⇒ 抛 `gbf-events-changed:no-table`、抹掉档期 ⇒ null；
			// kancolle：44 个 `anchor_super` 段位取活动名（去期次后缀）、`期間限定！【起～止】` 只写日期 ⇒
			//      00:00 / 23:59、`{}` ⇒ 抛 `kancolle-events-changed:no-sections`、抹掉档期 ⇒ null。
			"gbf": {
				GBF_CACHE_TTL_MS: ns_gbf_CACHE_TTL_MS,
				GBF_DATE_HEAD: ns_gbf_DATE_HEAD,
				GBF_EVENTS_URL: ns_gbf_EVENTS_URL,
				GBF_ICON: ns_gbf_ICON,
				GBF_PLACEHOLDER_RE: ns_gbf_PLACEHOLDER_RE,
				GBF_RANGE_RE: ns_gbf_RANGE_RE,
				GBF_SOURCE_LABEL: ns_gbf_SOURCE_LABEL,
				GBF_TZ: ns_gbf_TZ,
				eventsGbf: ns_gbf_events,
				gbfCellText: ns_gbf_cellText,
				gbfItemsOf: ns_gbf_itemsOf,
				gbfResetCache: ns_gbf_resetCache,
				gbfTablesOf: ns_gbf_tablesOf,
				gbfWindowOf: ns_gbf_windowOf
			},
			"kancolle": {
				KANCOLLE_ANCHOR: ns_kancolle_ANCHOR,
				KANCOLLE_BOX_RE: ns_kancolle_BOX_RE,
				KANCOLLE_CACHE_TTL_MS: ns_kancolle_CACHE_TTL_MS,
				KANCOLLE_EVENTS_URL: ns_kancolle_EVENTS_URL,
				KANCOLLE_ICON: ns_kancolle_ICON,
				KANCOLLE_RANGE_RE: ns_kancolle_RANGE_RE,
				KANCOLLE_SEASON_RE: ns_kancolle_SEASON_RE,
				KANCOLLE_SOURCE_LABEL: ns_kancolle_SOURCE_LABEL,
				KANCOLLE_TZ: ns_kancolle_TZ,
				eventsKancolle: ns_kancolle_events,
				kancolleItemsOf: ns_kancolle_itemsOf,
				kancolleNameOf: ns_kancolle_nameOf,
				kancolleResetCache: ns_kancolle_resetCache,
				kancolleSectionsOf: ns_kancolle_sectionsOf
			},
			// 2026-11-15 闪耀暖暖·国服：**卡池侧已重做**。活动侧不变（首页 `__NEXT_DATA__` 的 4 条精选 +
			// `/news/{id}` 的 `pageData.content_html`）；卡池侧改抓**新闻 API**（列表 `?section=1|0` +
			// 详情 `/api/v1/news/{id}`），从正文的「限时感应活动：<池名>」/「主题活动/特别活动【<池名>】」+
			// 「活动时间」读池名与档期（旧「从 4 条精选猜卡池」的路径已删）。回归可以分别钉住：
			// 列表/详情的失败语义（`ret != 0`、`data:{}`、`{}` ⇒ 抛错）、新闻 id/时间（ISO UTC 不按墙钟解释）、
			// 池名两种写法、当期逐字 + 绝对毫秒、「更新后」锚 09:30、无当期 ⇒ null、请求数
			// （卡池侧首轮 2+15 / 稳态 2；`nikki4ResetCache` 只给回归用）。
			"nikki4": {
				NIKKI4_CACHE_TTL_MS: ns_nikki4_CACHE_TTL_MS,
				NIKKI4_DETAIL_BASE: ns_nikki4_DETAIL_BASE,
				NIKKI4_GACHA_MAX_DETAILS: ns_nikki4_GACHA_MAX_DETAILS,
				NIKKI4_GACHA_SECTIONS: ns_nikki4_GACHA_SECTIONS,
				NIKKI4_LIST_URL: ns_nikki4_LIST_URL,
				NIKKI4_MAX_DETAILS: ns_nikki4_MAX_DETAILS,
				NIKKI4_NEWS_API: ns_nikki4_NEWS_API,
				NIKKI4_NEWSLIST_URL: ns_nikki4_NEWSLIST_URL,
				NIKKI4_SCAN_DAYS: ns_nikki4_SCAN_DAYS,
				NIKKI4_SOURCE_LABEL: ns_nikki4_SOURCE_LABEL,
				NIKKI4_TZ: ns_nikki4_TZ,
				NIKKI4_UPDATE_ANCHOR: ns_nikki4_UPDATE_ANCHOR,
				eventsNikki4: ns_nikki4_events,
				gachaNikki4: ns_nikki4_gacha,
				nikki4ApiBaseOf: ns_nikki4_apiBaseOf,
				nikki4ApiTsOf: ns_nikki4_apiTsOf,
				nikki4EventItemsOf: ns_nikki4_eventItemsOf,
				nikki4FactsOf: ns_nikki4_factsOf,
				nikki4GachaPoolsOf: ns_nikki4_gachaPoolsOf,
				nikki4HomeOf: ns_nikki4_homeOf,
				nikki4KindOf: ns_nikki4_kindOf,
				nikki4LinesOf: ns_nikki4_linesOf,
				nikki4NameOf: ns_nikki4_nameOf,
				nikki4NewsDetailOf: ns_nikki4_newsDetailOf,
				nikki4NewsIdOf: ns_nikki4_newsIdOf,
				nikki4NewsListOf: ns_nikki4_newsListOf,
				nikki4PageOf: ns_nikki4_pageOf,
				nikki4PublishTsOf: ns_nikki4_publishTsOf,
				nikki4ResetCache: ns_nikki4_resetCache,
				nikki4TitleNameOf: ns_nikki4_titleNameOf,
				nikki4WindowOf: ns_nikki4_windowOf
			},
			// 2026-11-15 アイドルマスター系列 5 款（gakumas / shinycolors / millisita / deresute / shanison）：
			// 每款一个月份页（`melonpapapapa-n.com` 的「イベント・ガシャ開催スケジュール一覧」），
			// 卡池（cat-gacha）/ 活动（cat-event）同一张表。导出纯解析步，回归可以分别钉住：
			// 月份页地址怎么算（含跨年：1 月 → 上一年 12 月）/ 表格按 brand class 定位 /
			// 行内 `M/D + H:MM` 两端锚点 → JST 绝对时刻 / 脏行（end <= start）丢弃 /
			// `{}` ⇒ 抛 `imas-<brand>-no-table` / 抹掉时间锚点 ⇒ 该条目不进外显。
			"idolmaster": {
				IMAS_BRANDS,
				IMAS_EVENT_SKIP_RE,
				IMAS_GACHA_SKIP_RE,
				IMAS_ORIGIN,
				IMAS_REFERER,
				IMAS_SOURCE_LABEL,
				IMAS_TZ,
				imasClockOf,
				imasCollect,
				imasDateOf,
				imasDedupeItems,
				imasFetchDeresute,
				imasFetchGakumas,
				imasFetchMillisita,
				imasFetchShanison,
				imasFetchShinycolors,
				imasMonthDayOf,
				imasMonthItemsOf,
				imasMonthUrlNow,
				imasMonthUrlOf,
				imasItemsFromTable,
				imasMergeItems,
				imasPrevMonthOf,
				imasSidePayloadOf,
				imasTableOf,
				imasWindowOf
			},
			// 2026-11-15 棕色尘埃2（第三方 bannerhistory.app 卡池史；**只接卡池侧**）：
			// 数据在 Next.js 的 RSC flight 负载里（`self.__next_f.push([1,"…"])` 的行文本 → `"data":{"game":"bd2"`）。
			// 导出「URL/常量 + 纯解析（推送流 / data 对象 / 窗口 / 条目）+ 缓存复位 + 抓取器」四层，回归可以
			// 分别钉住：`sourceZone` 是 Asia/Seoul、起止是站点自算的**绝对毫秒**（09:00 / 08:59 KST）、
			// 池名与角色分开取（`name`/`sub` 的 en 优先）、`{}` ⇒ 抛错、抹掉数据 ⇒ 抛错、
			// 没有覆盖 now 的 ⇒ null、请求数（首轮 1 / 稳态 0 —— `browndust2ResetCache` 只给回归用）。
			"browndust2": {
				BROWNDUST2_CACHE_TTL_MS: ns_bd2_CACHE_TTL_MS,
				BROWNDUST2_ICON: ns_bd2_ICON,
				BROWNDUST2_SOURCE_LABEL: ns_bd2_SOURCE_LABEL,
				BROWNDUST2_SOURCE_ZONE: ns_bd2_SOURCE_ZONE,
				BROWNDUST2_TZ: ns_bd2_TZ,
				BROWNDUST2_URL: ns_bd2_URL,
				browndust2DataOf: ns_bd2_dataOf,
				browndust2Gacha: ns_bd2_gacha,
				browndust2ItemsOf: ns_bd2_itemsOf,
				browndust2LabelOf: ns_bd2_labelOf,
				browndust2LangOf: ns_bd2_langOf,
				browndust2ResetCache: ns_bd2_resetCache,
				browndust2StreamOf: ns_bd2_streamOf,
				browndust2WindowsOf: ns_bd2_windowsOf
			},
			// 2026-11-15 第五批：4 款 bwiki 游戏（langrisser / crashfever / bfzy / gwdz）。
			// 导出纯解析步与条目事实入口，回归可以分别钉住：SMW `_dat` 的 `1/2026/9/10` 形态 /
			// 历史卡池 wikitext 表格（裸日期与 `[[公告|日期]]` 两种写法）/ `Data:GachaConfig.json`
			// （**JSON 直读**，含 9999 哨兵）/ 活动日历 `CALENDAR_DATA`（JS 字面量按括号切，**不 eval**）/
			// `{}` ⇒ 抛结构错 / 抹掉时间锚点 ⇒ 该条目不进外显。
			"batch5": {
				ns_b5_pointOfText,
				ns_b5_pointOfPrintout,
				ns_b5_stampOf,
				ns_b5_plainOf,
				CRASHFEVER_TZ: ns_crashfever_TZ,
				CRASHFEVER_QUERY: ns_crashfever_QUERY,
				CRASHFEVER_URL: ns_crashfever_URL,
				crashfeverGacha: ns_crashfever_gacha,
				crashfeverParseAsk: ns_crashfever_parseAsk,
				crashfeverPayloadOf: ns_crashfever_payloadOf,
				GWDZ_TZ: ns_gwdz_TZ,
				GWDZ_CAL_PAGE: ns_gwdz_CAL_PAGE,
				GWDZ_CAL_URL: ns_gwdz_CAL_URL,
				GWDZ_GACHA_PAGE: ns_gwdz_GACHA_PAGE,
				GWDZ_GACHA_URL: ns_gwdz_GACHA_URL,
				gwdzCalendarObjectOf: ns_gwdz_calendarObjectOf,
				gwdzEventObjectsOf: ns_gwdz_eventObjectsOf,
				gwdzEventPayloadOf: ns_gwdz_eventPayloadOf,
				gwdzEvents: ns_gwdz_events,
				gwdzFieldOf: ns_gwdz_fieldOf,
				gwdzGacha: ns_gwdz_gacha,
				gwdzGachaPayloadOf: ns_gwdz_gachaPayloadOf,
				gwdzIsSentinel: ns_gwdz_isSentinel,
				gwdzParseCalendar: ns_gwdz_parseCalendar,
				gwdzParseConfig: ns_gwdz_parseConfig
			},
			},
			// 共用工具 / env（测试原先从 next-sources/lib/env.js 取；压平后分别见 23-parser-time.js / 24-parser-window.js / 27-parser-text.js / 28-parser-hover-tools.js）
			fmtWindow,
			fmtMdHm,
			// pickEventPrimary / eventTier / sortEventItems = 外显挑选与悬停排序的**本体**（25-parser-order.js）：
			//   导出后可以直接断言"奖励领取期的候选排最前（压过类别档位）"，以及**反向守卫**
			//   —— 两个都是 `phase: "event"`（或都没有 `phase`，= 其它游戏的数据形状）时，
			//   挑选结果与改造前逐条一致（类别档位仍然生效）。
			pickEventPrimary,
			eventTier,
			sortEventItems,
			// 错误归一（`GameKee 内容接口失败（…）` 这类结构化来源的文案必须原样透出，见 60-helpers.js）
			normErr,
			pad2,
			// 蔚蓝档案：GameKee「当期卡池」表解析（纯函数，吃编辑器 block 数组）；
			// `gkBaCurrentPool` 返回 {win, roles} | null，表结构不认识时抛错（不返回半成品）
			gkBaCurrentPool,
			// 蔚蓝档案·国服：「■ 标签 + 起止时间」通用块解析（纯函数，吃已清洗正文）
			baCnNoticeText,
			baCnWindowIn,
			baCnTimeBlocks,
			baCnFromNoticeBlocks,
			// ba-cn **源级**主活动判断（③：剧情正篇 > 限时活动(非总决算) > 其余；同级保持列表顺序）
			baCnPickPrimary,
			baCnEventName,
			baCnEventNameFromNotice,
			parseBaCnMaintText,
			// 绝区零·官网公告（api-takumi-static，与卡池/活动侧同一 payload）：
			// 频段解析与活动解析是纯函数，回归用例直接喂真实夹具，不经过 transport。
			parseZzzFreq,
			parseZzzEventsOfficial,
			decodeEntities,
			stripTags,
			textOf,
			hoverPool,
			hoverEvent,
			// 悬停/外显两套口径的**本体**（2026-10-21 用户口径）：
			//   · buildEventHover / buildPoolHover —— 悬停 = **源站墙钟原文**，`tz` 必传（漏传退回本机时区，
			//     由 test/cases-rule-lint.mjs 的静态守卫兜住）；导出后测试可直接断言"同一份 ts 在不同
			//     tz 下渲染出不同文本"。
			//   · localWin / localWinText / localDatesOf —— 渲染层外显 = **本机时区换算**（纯函数，可测）。
			//     ⚠️ 它们在 81-schedule-model.js 里是**函数声明**，同作用域提升 ⇒ 这里可以提前引用；
			//        但函数体里只能用同样提升的函数（fmtWindow / parseDisplayRange / sourceOffsetMinutes），
			//        不许依赖 80 顶层的 const（那些在本文件执行时还在 TDZ）。
			buildEventHover,
			buildPoolHover,
			// P3（2026-11-07）：**反向产物**的生成器 —— `hoverLinesFromItems` / `hoverTextFromItems`
			//   把解析器直出的**条目事实**排成悬停行/字符串（排版与 buildPoolHover / buildEventHover
			//   逐字一致）。导出后可以拿真夹具直接钉住"悬停文本 == 同一份条目的生成结果"，
			//   并且把生成器改坏（少一个分隔空格之类）时 golden 会红（见 test/cases-p3.mjs）。
			hoverLinesFromItems,
			hoverTextFromItems,
			// hoverWindowTextOf = 悬停里**一档期**的文本（2026-11-09 用户口径，只两分支）：
			//   raw 含相对表述（版本更新后/开服后/维护后/即日起…）⇒ 原样印 raw；
			//   否则（raw 缺失，或两端都是绝对时刻）⇒ fmtWindow。
			// 词表 = `HOVER_RELATIVE_WINDOW_RE`（悬停侧唯一一份）；`hoverRawIsRelative` 是同一份判据的函数形态。
			// 导出后回归可以直接钉住四个输入（raw 相对 / raw 绝对 / 缺 raw 有 ts / 缺 ts），
			// 而不必再抄一份词表 —— 改词表时红的是**唯一真源**那一处。
			hoverWindowTextOf,
			hoverRawIsRelative,
			HOVER_RELATIVE_WINDOW_RE,
			// poolHoverKept = 卡池列表的**去重**（"同一个池被源描述两遍"）；buildPoolHover 与
			//   P3 直出的数组都从这一份结果出发 ⇒ 导出后可断言"文本里没有的行，数组里也没有"。
			poolHoverKept,
			// dataArrayExtrasFromEntriesOf = 并列条目 → 数组条目的**唯一实现**（三条判据 + 完全相同去重）。
			//   P3c（2026-11-07）起"把悬停文本拆成 { title, win } 再喂进来"的那条路（dataArrayHoverPoolsOf）
			//   已删：现在只有解析器直出这一条路径；`win` 分支留给回归 oracle（test/cases-p3.mjs ③）。
			dataArrayExtrasFromEntriesOf,
			dataArrayProducedItemOf,
			dataArrayProducedListOf,
			// P3b：解析器直出数组的**收口**（主条 = `dataArray*MainOf` 从记录字符串造，并列条 =
			//   `dataArrayExtrasFromEntriesOf` 按同一条判据展开）—— 导出后回归可以拿"记录字符串 + 悬停文本"
			//   再合成一遍当**改造前**的对照（P3c 删掉产品里的合成器后，oracle 挪进了 test/cases-p3.mjs ③）。
			dataArrayProducedGachaOf,
			parseSmwActivity,
	dataArrayProducedEventsOf,
			dataArrayGachaMainOf,
			dataArrayEventMainOf,
			localWin,
			localWinText,
			localDatesOf,
			// scheduleDateHover = 新面板**日期格**的悬停（81-schedule-model.js）：正常只给源站原文；
			//   失败 ⇒ sideFailText 的既有文案（+「日期为沿用旧值」）；沿用旧值 ⇒「数据来自上次成功抓取 X 前」；
			//   该侧没有数据 ⇒「（无数据）」。导出后四种情况都能用固定 now 逐字断言（见 cases-tz.mjs ⑤）。
			scheduleDateHover,
			// ⚠️ P5 清理（2026-11-08）：`scheduleHoverItems`（悬停文本 → [{ title, win }]）已删除 ——
			//   它自 P3c 起没有生产调用方，只剩回归当"改造前"的 oracle。oracle 的**输出**已固化成
			//   字面量（test/fixtures/legacy-oracle-golden.json）；仍需"解析悬停文本"的那一处
			//   （明日方舟 §④ 的提示行回归）已把该判据**逐字搬进测试**（cases-arknights-claim.mjs）。
			// scheduleHoverNote = 提示框（原生 title）里插入「只给提示框」的提示行（`eventHoverExtra`）：
			//   表格格子的 hoverTextOf（82-schedule-view.js）与「近期」行的 scheduleHoverText（81）共用它。
			//   导出后能行为断言"插到对应活动那一行**之后**、另起一行、没有就不动"。
			scheduleHoverNote,
			// scheduleHoverText = 「近期」行（列表）的悬停文本（81-schedule-model.js）：
			//   卡池侧 = 悬停原文 + `池名 ⏎ 档期`；活动侧 = **只用** `eventHover`（不追加 title + 原文，
			//   否则同一区间出现两次 —— 2026-11-07 真机 bug），`eventHover` 为空才用 title + 原文兜底。
			//   导出后可以逐字断言"表格格子与「近期」行两处口径一致"。
			scheduleHoverText,
			// scheduleNormalize = 新面板**一条档期**的归一（81-schedule-model.js）：`title` 是源站原文
			//   （卡池 = 池名 / 活动 = 活动名，只给悬停用），`show` 是**外显文本**（卡池侧有 roles 时 =
			//   去修饰的角色名，否则退回 title；活动侧 = title）。导出后可以钉住"外显口径"本身，
			//   并断言表格 / 近期 / 留白卡 / 轮播读的是同一份（见 cases-tz.mjs ⑥）。
			scheduleNormalize,
			// sideViewOf = 派生层（P2，81-schedule-model.js）：`gacha` / `events` 数组 → `{ primary, rest }`，
			//   即"这一格表格露哪一条 / 探头列哪些"。**通用规则**是今天外显规则的原样搬运
			//   （event = pickEventPrimary，gacha = selectCurrent 的"在期里结束最早"），数据层只放事实、
			//   不挑选；第 4 个参数 `gameId` 会命中 `schedulePickOf` 的**按游戏分派表**（赛马娘 / 物华 /
			//   战双 / FGO 的老实现各有排序键，见该表注释）。**不传 gameId = 通用规则**，所以纯函数用例
			//   与"把特化规则还原成通用规则"的反向证明可以共用同一个入口（见 test/cases-core.mjs ⑤）。
			sideViewOf,
			// scheduleItemOf = 数组条目 → 与 scheduleNormalize 同形的渲染条目（81-schedule-model.js）：
			//   记录自己那条外显直接走 scheduleNormalize（档期文本与今天逐字一致），并列条目按
			//   `startTs/endTs/raw` 组装。导出后等价性用例可以逐字比对。
			scheduleItemOf,
			// scheduleCellOf = 一格（游戏 × 卡池/活动）的全部渲染条目：`{ primary, rest }`；null = 该侧无数据。
			//   **只读数据层数组**（P3c 起唯一路径）：没有数组（老缓存 / 没数据）⇒ null，不抛错。
			//   P3c 删掉了 `fromArray` 字段与那条"解析悬停文本"的兼容分支。
			scheduleCellOf,
			// scheduleFlattenOf = 展平（P4，81-schedule-model.js）：每侧 **primary + rest 全部** →
			//   `{ cells, cellViews, all }`。渲染层（82）的「近期」/ 24 小时计数 / 留白卡都读 `all`；
			//   导出后可以离线钉住"同一游戏的多个在期条目各占一行"（见 cases-p4flat.mjs）。
			scheduleFlattenOf,
			// parseDisplayRange = 窗口文本 → { startTs, endTs }（24-parser-window.js）。
			//   导出给回归的**改造前 oracle** 用：P3c 删掉了 81 的 `scheduleHoverOnes`（把悬停行补成
			//   渲染条目），test/cases-core.mjs ⑤-5 要在测试里**逐字复刻**它才能继续比"数组派生 vs 老路"。
			parseDisplayRange,
			// scheduleMeta / schedulePickItem = 表格一格的「档期 · 状态」文本与探头内部排序（81）：
			//   等价性用例要逐字比对"渲染出来的文本"，用**真函数**而不是在测试里再抄一份
			//   （抄一份会与实现漂移，等价性就成了自说自话）。
			scheduleMeta,
			schedulePickItem,
			// 到期判定的纯函数（固定时刻可测）。dueWindowOf / tickerItemsOf 在 81-schedule-model.js，
			// 负责"落盘文本 + tz → 绝对窗口"；同属函数声明、同作用域提升 ⇒ 这里可提前引用。
			isExpiringSoon,
			expiringSoonOf,
			// autoRefreshPlan = 「这次启动要不要刷」的纯判定（60-helpers.js）：版本哨兵优先（force）/
			// 「启动时」（refreshMinutes === 0）每次挂载 due 但不 force / 按间隔 due / 脏值永不 due。
			// 导出后可以逐字断言 reason 并覆盖 0、负数、NaN 三种边界（见 test/cases-refresh.mjs）。
			autoRefreshPlan,
			// 外显名（60-helpers.js 的纯函数，2026-11-18 全量审计）：
			//   stripDisplayTailOf = 剥源站体裁尾巴（白名单 + 剥完 ≥3 码点才剥）；
			//   displayNameIsGenericOf / displaySpecificNameOf / displayNameNextOf = 泛名判定 /
			//     「同一侧数组里更具体的条目」挑法 / ①+② 合成（剥尾巴 → 泛名让位）；
			//   applyDisplayNameOf = 把外显名落到记录字段（数组 title/show/raw 与悬停不动）。
			//   truncateDisplayNameOf = 显示层超长截断（按码点 30 字 + 一个「…」；
			//     数据层不截断，全文仍在记录字段 / 数组 / title 里）。
			//     ⚠️ 不导出 `DISPLAY_NAME_MAX`：它是 60-helpers 的 `const`，在本文件之后（TDZ）。
			// 应用点 = 50-refresh.js 的 mergeEntryRecord；逐条回归见 test/cases-display-name.mjs ①②③。
			stripDisplayTailOf,
			displayNameIsGenericOf,
			displaySpecificNameOf,
			displayNameNextOf,
			applyDisplayNameOf,
			truncateDisplayNameOf,
			// displayShowTextOf = **渲染层**名称格的显示文本（82-schedule-view.js）：show → title → raw
			//   → 「—」，超长按码点截到 30 + 一个「…」。函数声明在 82 段（本文件之后），提升可见。
			//   导出后可以钉"渲染文本被截断、而模型 title / 数组仍是全名"（见 cases-display-name.mjs ③）。
			displayShowTextOf,
			// dueKindOf = 方向判定（到期提醒也会复用）；remindGameAllowed = 「提醒」生效判定（轮播不调用）；
			// tickerPickOf / tickerCaptionOf / tickerSlidesOf / tickerStepsOf / tickerDirAt = 轮播的
			// 选取排序 / 文案 / 每格结构 / 展开序列 / 方向规则，全是纯函数。
			dueKindOf,
			remindGameAllowed,
			// remindEntryShownOf / remindOffGamesOf / remindAllowedTickOf = 提醒的**展示上位判定** /
			// **取消列表脏值归一** / **按「展示中 ∧ 未取消」跑一轮**（65-remind.js，与宿主 runRemindRound
			// 同一份源码）。导出后可以拿假条目 + 假 settings 跑真判定，钉住"展示关 ⇒ 不提醒（即使在取消
			// 列表外）/ 手动取消 ⇒ 不提醒 / 展示关→开 ⇒ 自动恢复提醒"（见 cases-remind.mjs ⑱）。
			remindEntryShownOf,
			remindOffGamesOf,
			remindAllowedTickOf,
			// 总开关与范围的读取口径（设置页与按钮共用）。
			tickerOnOf,
			tickerRangeOf,
			// starHintShownOf = 设置页标题行 Star 指引「显示 / 隐藏」的读取口径（60-helpers.js）：
			// 经 configValueOf 解包 volatile 引用后，只有明确 true 才隐藏；缺失 / 脏值一律显示。
			// 导出是为了能用真布尔 / volatile 引用对象 / 脏值各钉一条（见 cases-star.mjs）。
			starHintShownOf,
			tickerPickOf,
			tickerCaptionOf,
			tickerSlidesOf,
			tickerStepsOf,
			tickerDirAt,
			// tickerFlipLinesOf = 翻页层**两行的顺序**（2026-10-25 五次定稿）：up ⇒ [prev, cur]、
			//   down ⇒ [cur, prev]。行顺序与 keyframes 必须成对出现 —— 向上翻若仍用 [cur, prev]，
			//   起点 translateY(+50%) 会把两层都推到窗口下方（开场空白，用户报的"观感不一样"）。
			//   提成纯函数是为了能对 up / down 各钉一条断言（渲染层只做 map）。
			tickerFlipLinesOf,
			// tickerFlipRenderLinesOf = **落定后进 DOM 的行**（2026-10-25 六次定稿）：
			//   动画播完 ⇒ [cur]（只一行、transform 回 none，与向下翻终点一致）；未落定 ⇒
			//   沿用 tickerFlipLinesOf 的两行顺序。提成纯函数是为了把 settled × up/down
			//   四种组合都钉住（"落定时仍渲染两行"这种写法视觉上会被窗口裁掉、只在真机露馅）。
			tickerFlipRenderLinesOf,
			dueWindowOf,
			tickerItemsOf,
			// 到期提醒（送达）的判定与文案（65-remind.js，纯函数；**与宿主 src/index.js 用的是同一份源码**，
			// 见 build.mjs 的 lib/remind-core.mjs）。这里导出是为了能离线钉住判定规则：
			// 只发最紧急 / 再跑不重发 / T 过作废 / 配置回退 / 开始方向。
			// ⚠️ 只导出**函数**：65 段在本文件之后（ORDER），这里的 `const`（节点默认值 / 时区表）还在 TDZ 里，
			//    提前引用会炸；那几个常量测试直接从 lib/remind-core.mjs 取（宿主看到的就是那份）。
			remindOnOf,
			// remindIdentityOf = 通知身份判定（快捷方式存在 + AUMID 正确才算启用；否则回退 PowerShell）。
			// 纯函数，测试覆盖 4 种组合（见 cases-remind.mjs ⑫）。
			remindIdentityOf,
			// notifyShortcutPickOf = 从 [{ path, aumid }] 里挑出第一个 AUMID 匹配项（探测按 **AUMID** 而不是
			// 文件名找快捷方式的纯判定部分）。覆盖：命中 / 多个命中取第一个 / 都不匹配 / 空数组
			// （见 cases-remind.mjs ⑫）。
			notifyShortcutPickOf,
			// notifyIdentityCacheOf = 身份状态缓存（identity.json）的判定：给定文件内容 + now + 最大年龄 +
			// 期望 AUMID ⇒ { useCached, shouldRefresh, state }。宿主拿它决定"读文件就回"还是"探测并写回"；
			// 常量 NOTIFY_IDENTITY_MAX_AGE_MS 在本文件之后声明（TDZ），测试从 lib/remind-core.mjs 取
			// （见 cases-remind.mjs ⑮）。
			notifyIdentityCacheOf,
			// notifyIdentityFallbackOf = 没有 identity.json 时 GET **立刻**回的保守值
			// （{ enabled:false, name:<配置名>, aumid, shortcutPath:"" }）：GET 永不阻塞在探测上，
			// 后台探测写回文件后下一次 GET 才是准确值（见 cases-remind.mjs ⑯）。
			notifyIdentityFallbackOf,
			// notifyNameOf = 通知身份名（应用名）的清洗函数：非法文件名字符换空格、首尾点/空白去掉、
			// 空 ⇒ 默认「二游日历」、超长截到 40 字、Windows 保留设备名 ⇒ 默认。
			// 宿主拿它给快捷方式起名 / 写 DisplayName，设置页拿它给输入框兜底（见 cases-remind.mjs ⑭）。
			notifyNameOf,
			remindNodesOf,
			// remindNodesToggleOf = 设置页胶囊点一下会写回的字符串（降序 / 逗号分隔 / 空格都没有；
			// 全取消 ⇒ 空串）。与判定侧共用同一个 remindNodesOf，所以"写什么"和"读什么"不会分叉。
			remindNodesToggleOf,
			remindConfigOf,
			remindKeyOf,
			remindStateOf,
			// remindTestToastOf = 设置页「发送测试通知」那条的标题/正文（标题固定、正文三行：
			// 发送者 / 时间 / 说明）。与真实提醒隔离的纯函数，正文内容见 cases-remind.mjs ⑬。
			remindTestToastOf,
			remindWindowOf,
			remindItemsOf,
			remindTickOf,
			remindToastOf,
			// 跨平台（65-remind.js 尾部的纯函数，宿主直接 import 这几个）：
			//   hostStateDirOf   = 三平台的宿主状态目录（env 快照 → 绝对路径；缺失 / 空 / 相对路径都有规则）
			//   notifyChannelOf  = 平台 → 通知通道（winrt-toast / osascript / none）
			//   remindAppleScriptOf = macOS 通知脚本（AppleScript 字面量转义，零额外依赖）
			// 见 cases-remind.mjs 的「跨平台」一节。
			// ⚠️ 常量（HOST_STATE_DIR_NAME / NOTIFY_CHANNEL_*）**不能在这里导出**：const 在本段之后声明
			// （TDZ），导出对象构建时就会炸；要读常量从宿主那份 lib/remind-core.mjs 取（同上面那条说明）。
			hostStateDirOf,
			notifyChannelOf,
			notifyAppleScriptTextOf,
			remindAppleScriptOf,
			// 来源健康（待办第 3 项，60-helpers.js 的纯函数）：读存档 / 单轮结论 / 单源累积 /
			// 一轮更新 / 给 UI 的每源状态（正常 / 连续失败 / 疑似改版停更 / 从未成功）。
			// 常量 SOURCE_HEALTH_* 在本文件之后（TDZ），测试按**行为**钉阈值（第 7 天整才翻成疑似停更），
			// 再用静态断言钉住 `SOURCE_HEALTH_NOMATCH_DAYS = 7` 这一处字面量（见 cases-health.mjs）。
			parseSourceHealth,
			sourceHealthRoundOf,
			sourceHealthNextOf,
			sourceHealthUpdateOf,
			sourceHealthSameOf,
			sourceHealthOf,
			// 搜索与筛选（待办第 4 项，60-helpers.js 的纯函数）：归一（NFKC + 大小写 + 空白）/
			// 分词（AND 语义）/ 命中 / 设置页「搜游戏名 + 只看已启用」/ 面板「游戏名·卡池·角色·活动」。
			// 全是**函数声明** ⇒ 60 段虽排在本段之后，这里可提前引用（同上面 isExpiringSoon 的说明）。
			searchNorm,
			searchTokens,
			searchHit,
			settingsGamesFilter,
			panelEntryHit,
			panelGamesFilter,
			// isEntryHidden / getVisibleEntries = 面板与设置页**唯一**的显隐判定（60-helpers.js）：
			// hidden 里有 → 隐；出厂 defaultHidden 且 shown 里没有 → 隐；否则显。
			// 导出是为了和提醒侧那份副本（65-remind.js 的 remindEntryShownOf）做**等价性**用例 ——
			// 宿主单独装 65-remind.js 时拿不到本函数，只能各写一份，所以必须机器证明两份判定一致。
			isEntryHidden,
			orderIdsComplete,
			orderMoveTo,
			pruneCustomRefsOf,
			getVisibleEntries,
			// 「跳到本插件设置页」的三步查找（80-shared-ui.js 的纯判定）：给定候选 record 列表 ⇒
			// 该点哪个 / 卡在哪一步。覆盖正常三步 / 缺账号菜单 / 菜单里没有设置项 /
			// 设置开了但导航里没有本插件节 / 本插件面板里的元素必须排除（见 cases-settings-jump.mjs）。
			// ⚠️ 它们是**函数声明**（80 段排在本段之后，靠提升可见）；理由同上面 isExpiringSoon。
			settingsJumpPickOf,
			settingsJumpPlanOf,
			// 设置页搜索框「点外壳 = 聚焦内部 input」（80-shared-ui.js）：并排结构下 pointer-events:none
			// 只把点击交给外壳，穿透不到 input ⇒ 靠这个 onMouseDown 转交焦点（见 cases-filter.mjs）。
			focusInputOnShellMouseDown,
			// 排期导出 .ics（待办第 5 项，60-helpers.js 的纯函数）：
			//   icsEventsOf —— 条目 + 上一轮抓取结果 + now ⇒ { events, skipped }（"在期"只有这一处判定）；
			//   icsOf       —— 事件清单 + 生成时刻 ⇒ **逐字节确定**的 iCalendar 文本（CRLF / 75 octets 折行 /
			//                  文本转义 / VCALENDAR 骨架）。两者都在 core 段里，所以双时区门禁逐字节比同一份产物。
			// 其余几个（icsWindowOf / icsUtcStamp / icsUtcHuman / icsEscapeText / icsFoldLine / icsFileNameOf）
			// 是它们的可单独断言的零件：源站墙钟 → 绝对时刻的换算、`YYYYMMDDTHHMMSSZ`、转义、折行。
			icsEventsOf,
			icsOf,
			icsWindowOf,
			icsUtcStamp,
			icsUtcHuman,
			icsEscapeText,
			icsFoldLine,
			icsFileNameOf,
			sourceInstant,
			sourceWallParts,
			sourceOffsetMinutes,
			tzOffsetMinutesAt,
			setCoreEnv,
			// 「相对起点」统一锚定（2026-11-09，23-parser-time.js 的纯函数）：
			//   星铁「X.Y版本更新后」= 该日 10:00（+08）/ 无期迷途「开服后」= 该日 14:00（+08）；
			//   **只有版本标签没有日期 ⇒ null（起点未知，不得当已开始）**。
			anchorStartOf,
			// 「在期 + 起点未知但终点未过」——悬停/数组的事实口径（24-parser-window.js）。
			// 与 coversNow 的分工就是用户 2026-11-09 那条口径：判定不含 null 起点，列出仍要含。
			coveredOrOpen,
			// withBwikiCors = bwiki 请求统一补 `origin=*` 的**唯一**收口（15-env.js）：直连
			// （transportFetchRaw）与宿主代理（proxyFetchText）两条出口都过它。导出后可以离线钉住
			// 「无 query ⇒ 用 ? / 已有 query ⇒ 用 & / 已有 origin ⇒ 不动 / 其它主机逐字不变 /
			// 大小写·端口·hash / 幂等」这些边界（见 test/cases-bwiki-cors.mjs）。
			withBwikiCors,
			// 刷新横幅的汇总（文字 + 悬停明细）：测试直接钉「未配置有效来源」与「不再报跳过个数」
			buildScrapeInfo,
			// 来源表与抓取器表（测试直接用它们核对条目/登记，不再需要 registry 模块）
			SOURCES,
			GACHA_FETCHERS,
			EVENT_FETCHERS,
			// 来源选择的三件套（设置页「卡池来源 / 活动来源」下拉 + 刷新侧路由都用它们）：
			//   getDefaultSourceName = 下拉默认项显示名（活动侧读 eventSource，逐字）；
			//   getEntryUrl          = 把存进 customUrls / customEventUrls 的选择值还原成实际地址；
			//   eventFetcherFor      = 地址 → EVENT_FETCHERS 里的抓取器（备选源优先，否则默认）。
			// 三者都是**函数声明**（60-helpers / 22-fetcher-core），提升可见（同上面 searchNorm 的说明）。
			// 导出后可以离线钉住「选活动备选源 → 读回仍是备选 → 路由到备选抓取器」整条链路。
			getDefaultSourceName,
			getEntryUrl,
			eventFetcherFor,
			// 来源标识归一（老配置的 proxy:/gk-*: 写法 → 真实地址 / 内部来源 id，见 60-helpers.js）
			normalizeSourceId,
			DEFAULT_SETTINGS,
		};
