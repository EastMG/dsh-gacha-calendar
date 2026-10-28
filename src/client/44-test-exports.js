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
				detectOrientation: ns_bwiki_detectOrientation,
				eventsStellasora: ns_bwiki_eventsStellasora,
				eventsUmaJp: ns_bwiki_eventsUmaJp,
				eventsWhmx: ns_bwiki_eventsWhmx,
				gachaCzn: ns_bwiki_gachaCzn,
				gachaKedr: ns_bwiki_gachaKedr,
				gachaUmaCn: ns_bwiki_gachaUmaCn,
				gachaWhmx: ns_bwiki_gachaWhmx,
				gachaZspms: ns_bwiki_gachaZspms,
				parseCznGacha: ns_bwiki_parseCznGacha,
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
			"umapyoi": {
				PERMANENT_END: ns_umapyoi_PERMANENT_END,
				gachaUmapyoi: ns_umapyoi_gachaUmapyoi,
				parseUmapyoiGacha: ns_umapyoi_parseUmapyoiGacha,
			},
			"bestdori": {
				BESTDORI_CN_INDEX: ns_bestdori_CN_INDEX,
				BESTDORI_LONG_MS: ns_bestdori_LONG_MS,
				eventsBestdori: ns_bestdori_eventsBestdori,
				gachaBestdori: ns_bestdori_gachaBestdori,
				parseBestdoriEvents: ns_bestdori_parseBestdoriEvents,
				parseBestdoriGacha: ns_bestdori_parseBestdoriGacha,
			},
			"sekai": {
				SEKAI_LONG_MS: ns_sekai_LONG_MS,
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
				FGO_TZ: ns_fgo_FGO_TZ,
				eventsFgo: ns_fgo_eventsFgo,
				fgoParseUrl: ns_fgo_fgoParseUrl,
				fgoTables: ns_fgo_fgoTables,
				findFgoEventTable: ns_fgo_findFgoEventTable,
				formatFgoRoles: ns_fgo_formatFgoRoles,
				gachaFgo: ns_fgo_gachaFgo,
				parseFgoBannerTable: ns_fgo_parseFgoBannerTable,
				parseFgoEventTable: ns_fgo_parseFgoEventTable,
				parseFgoWindow: ns_fgo_parseFgoWindow,
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
			"biligame-announce": {
				DDLEZJ_CMS_TZ: ns_biligame_announce_DDLEZJ_CMS_TZ,
				DDLEZJ_GAME_EXTENSION_ID: ns_biligame_announce_DDLEZJ_GAME_EXTENSION_ID,
				DDLEZJ_HOME: ns_biligame_announce_DDLEZJ_HOME,
				DDLEZJ_LIST_URL: ns_biligame_announce_DDLEZJ_LIST_URL,
				DDLEZJ_TZ: ns_biligame_announce_DDLEZJ_TZ,
				ddlezjDetailUrl: ns_biligame_announce_ddlezjDetailUrl,
				ddlezjParagraphs: ns_biligame_announce_ddlezjParagraphs,
				eventsDdlezj: ns_biligame_announce_eventsDdlezj,
				gachaDdlezj: ns_biligame_announce_gachaDdlezj,
				parseDdlezjAnnouncement: ns_biligame_announce_parseDdlezjAnnouncement,
				parseDdlezjDate: ns_biligame_announce_parseDdlezjDate,
				parseDdlezjList: ns_biligame_announce_parseDdlezjList,
				parseDdlezjStamp: ns_biligame_announce_parseDdlezjStamp,
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
				stellaFeaturedName: ns_stellasora_stellaFeaturedName,
				stellaGachaName: ns_stellasora_stellaGachaName,
				stellaIsEvent: ns_stellasora_stellaIsEvent,
				stellaIsGacha: ns_stellasora_stellaIsGacha,
				stellaListUrl: ns_stellasora_stellaListUrl,
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
				ZSPMS_REFERER: ns_bwiki_wikitext_ZSPMS_REFERER,
				ZSPMS_TZ: ns_bwiki_wikitext_ZSPMS_TZ,
				cznStamp: ns_bwiki_wikitext_cznStamp,
				eventsKedrTemplate: ns_bwiki_wikitext_eventsKedrTemplate,
				eventsZspms: ns_bwiki_wikitext_eventsZspms,
				gachaCzn: ns_bwiki_wikitext_gachaCzn,
				gachaKedrTemplate: ns_bwiki_wikitext_gachaKedrTemplate,
				gachaZspms: ns_bwiki_wikitext_gachaZspms,
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
				zspmsEventTier: ns_bwiki_wikitext_zspmsEventTier,
				zspmsHeadings: ns_bwiki_wikitext_zspmsHeadings,
				zspmsLatestNotice: ns_bwiki_wikitext_zspmsLatestNotice,
				zspmsMaintenanceWindow: ns_bwiki_wikitext_zspmsMaintenanceWindow,
				zspmsNameAt: ns_bwiki_wikitext_zspmsNameAt,
				zspmsNormalize: ns_bwiki_wikitext_zspmsNormalize,
				zspmsParseUrl: ns_bwiki_wikitext_zspmsParseUrl,
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
				mergeBiligameLists: ns_biligame_activity_mergeBiligameLists,
				parseBiligameList: ns_biligame_activity_parseBiligameList,
				parseCmsStamp: ns_biligame_activity_parseCmsStamp,
				parseUmaCnAnnouncement: ns_biligame_activity_parseUmaCnAnnouncement,
				parseWhmxActivity: ns_biligame_activity_parseWhmxActivity,
				pickUmaWindow: ns_biligame_activity_pickUmaWindow,
				pickWhmxEvent: ns_biligame_activity_pickWhmxEvent,
				quotedName: ns_biligame_activity_quotedName,
				siblingListUrl: ns_biligame_activity_siblingListUrl,
				umaCnEventHover: ns_biligame_activity_umaCnEventHover,
				umaCnPoolHover: ns_biligame_activity_umaCnPoolHover,
				umaRoles: ns_biligame_activity_umaRoles,
				whmxEventHover: ns_biligame_activity_whmxEventHover,
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
			},
			// 共用工具 / env（测试原先从 next-sources/lib/env.js 取）
			fmtWindow,
			fmtMdHm,
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
			//     ⚠️ 它们在 80-components.js 里是**函数声明**，同作用域提升 ⇒ 这里可以提前引用；
			//        但函数体里只能用同样提升的函数（fmtWindow / parseDisplayRange / sourceOffsetMinutes），
			//        不许依赖 80 顶层的 const（那些在本文件执行时还在 TDZ）。
			buildEventHover,
			buildPoolHover,
			localWin,
			localWinText,
			localDatesOf,
			// scheduleDateHover = 新面板**日期格**的悬停（80-components.js）：正常只给源站原文；
			//   失败 ⇒ sideFailText 的既有文案（+「日期为沿用旧值」）；沿用旧值 ⇒「数据来自上次成功抓取 X 前」；
			//   该侧没有数据 ⇒「（无数据）」。导出后四种情况都能用固定 now 逐字断言（见 cases-tz.mjs ⑤）。
			scheduleDateHover,
			// 到期判定的纯函数（固定时刻可测）。dueWindowOf / tickerItemsOf 在 80-components.js，
			// 负责"落盘文本 + tz → 绝对窗口"；同属函数声明、同作用域提升 ⇒ 这里可提前引用。
			isExpiringSoon,
			expiringSoonOf,
			// dueKindOf = 方向判定（到期提醒也会复用）；remindGameAllowed = 「提醒」白名单判定（轮播不调用）；
			// tickerPickOf / tickerCaptionOf / tickerSlidesOf / tickerStepsOf / tickerDirAt = 轮播的
			// 选取排序 / 文案 / 每格结构 / 展开序列 / 方向规则，全是纯函数。
			dueKindOf,
			remindGameAllowed,
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
			sourceInstant,
			sourceWallParts,
			sourceOffsetMinutes,
			tzOffsetMinutesAt,
			setCoreEnv,
			// 来源表与抓取器表（测试直接用它们核对条目/登记，不再需要 registry 模块）
			SOURCES,
			GACHA_FETCHERS,
			EVENT_FETCHERS,
			DEFAULT_SETTINGS,
		};
