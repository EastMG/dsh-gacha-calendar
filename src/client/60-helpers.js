		//#region helpers（core 与外壳共用：纯函数、零宿主依赖）
		// —— 抓取状态与错误归一（统一机制，不做任何游戏特判）——
		// 每一侧（卡池/活动）只有三种状态：
		//   ok      ：本次抓到当期内容
		//   down    ：抓取器报错（网络错误 / CORS 被拦 / 超时 / HTTP 非 2xx / 解析崩，都算）
		//   nomatch ：请求成功，但源站里没有当期内容（"未命中"，不是失败）
		// 判定口径：任一侧 down → 整条 ok=false；只有 nomatch → 仍算 ok（面板提示"未公布"）。
		// 环境原文（fetch failed / Failed to fetch / NetworkError…）一律归一成简短中文，不再外显。
		// 放在 helpers（而非 core 内部）是因为**外壳也要用**：面板要在列悬停里显示失败原因、
		// 要在顶部拼"成功 N/M + 五类归类"，这些都只依赖失败对象本身，与抓取无关。
		const SIDE_TEXT = {
			gacha: { fail: "卡池失败", nomatch: "新卡池未公布", nomatchUser: "未解析出内容" },
			event: { fail: "活动失败", nomatch: "新活动未公布", nomatchUser: "未解析出内容" }
		};

		// —— 配置表单写入被拒时的归因（纯函数）——
		// DSH 0.1.7 的 configForms 表单有四种"能读不能写"的状态，肉眼在界面上完全分不出来
		// （控件点一下弹回原值、没有任何提示）。这里按快照如实说清是哪一种，让下次出问题能一眼定位：
		//   memory  = 本次连接不是本机回环 → 宿主压根不接受持久化写入（只读）
		//   loading = 表单数据还没送到（点太早了）
		//   unavailable = 宿主没在 serve 本插件的条目（多半是条目 id 对不上 / 没进 describe）
		//   其它    = 宿主明确拒绝（字段没进表单，或修订号冲突）
		function formRejectHint(scope, key) {
			var snap = null;
			try { snap = scope && scope.getSnapshot ? scope.getSnapshot() : null; } catch (e) { snap = null; }
			const status = snap && snap.status ? snap.status : "unknown";
			const mode = snap && snap.mode ? snap.mode : "unknown";
			const rev = snap && typeof snap.revision === "number" ? " (rev " + snap.revision + ")" : "";
			const id = scope && scope.entryId ? scope.entryId : "(未解析)";
			if (mode === "memory") return "本次连接不是本机，宿主不接受写入（只读模式）";
			if (status === "loading") return "配置表单还没送到，请稍后重试";
			if (status === "unavailable") return "宿主未 serve 条目「" + id + "」" + servedNamespacesText(scope.configForms);
			return "宿主拒绝了该写入（表单状态 " + status + " / " + mode + rev + "）";
		}

		// 把宿主**真正 serve 的**设置 namespace 列出来。这一条是给"地址对不上"这类故障留的现场：
		// 只说"没提供配置条目"定位不了，列出真实 id 就能一眼看出该用哪个。
		function servedNamespacesText(configForms) {
			try {
				const mirror = configForms && typeof configForms.describe === "function" ? configForms.describe() : null;
				const view = mirror && typeof mirror.getSnapshot === "function" ? mirror.getSnapshot().view : null;
				const rows = view && Array.isArray(view.namespaces) ? view.namespaces : [];
				const names = rows.map((r) => r && r.ns).filter((ns) => typeof ns === "string");
				return names.length ? "（宿主当前 serve：" + names.join(", ") + "）" : "（宿主当前一个设置条目都没 serve）";
			} catch (e) {
				return "";
			}
		}
		function normErr(err) {
			const name = String((err && err.name) || "");
			const msg = String((err && err.message) || err || "");
			if (name === "AbortError" || /abort/i.test(msg)) return "超时";
			// 代理层"目标站非 200"：92-dsh-env.js 抛 `proxy-bad:<目标状态码>` 或 `proxy-bad:<error 文本>`。
			// 后面的**数字就是目标站的 HTTP 状态码**（403 地区封锁 / 502 网关错误…），必须原样透出——
			// 从前一律显示"代理响应异常"，用户看不到 403，也就无法判断"是被墙了"还是"源站挂了"。
			// 与下面 proxy-http/http 分支同格式（`HTTP 403`）；非数字（`proxy-bad:error` /
			// `proxy-bad:host not allowed…`）仍回落"代理响应异常"。
			if (/^proxy-bad:/.test(msg)) {
				const bad = msg.match(/^proxy-bad:(\d{3})$/);
				return bad ? "HTTP " + bad[1] : "代理响应异常";
			}
			const m = msg.match(/^(?:proxy-http|http)-(\d{3})$/);
			if (m) return "HTTP " + m[1];
			if (/^bad-json$/.test(msg)) return "响应格式异常";
			if (/fetch failed|Failed to fetch|NetworkError|net::|Load failed|network error/i.test(msg)) return "网络不通";
			if (/^no-source$/.test(msg)) return "无可用来源";
			// 解析器用 throw 表达"页面结构变了/一条都没解析出来"（哨兵错误名见各解析器，统一带
			// shape-changed / layout-changed / no-table / no-timer / no-chunk / no-section 这类后缀）：
			// 给一句比"抓取异常"更有信息量的归因 —— 让"源站改版"在面板上**看得见**，
			// 而不是伪装成"新卡池未公布"（终末地上次长期静默失灵就是这么来的）
			if (/shape-changed|layout-changed|no-table|no-timer|no-chunk|no-section|no-banner|no-dates|no-activities|parse-empty/.test(msg)) {
				return "页面结构变了（解析出 0 条）";
			}
			// 结构化内容接口（GameKee 编辑器 block / GameTora 数据文件）自带环节名，原样透出 ——
			// 用户 2026-10-21 明确要求"错误文案要能看出是内容接口失败"，而不是被压成"抓取异常"。
			// 只放行这两个前缀（其余仍是上面的归类），并限长，避免把整段 HTML 塞进面板。
			if (/^(?:GameKee|GameTora) /.test(msg)) return msg.length > 80 ? msg.slice(0, 80) + "…" : msg;
			return "抓取异常";
		}
		const isDown = (f) => !!f && f.kind === "down";
		const isNomatch = (f) => !!f && f.kind === "nomatch";
		// 兼容老版本缓存：旧 lastData 里 eventFail 是**字符串**（"event-down" / "no-match" / 错误原文），
		// 读到时升级成 { kind, reason }；新格式原样返回（否则老缓存会把"失败"错显成"未公布"）。
		function normalizeFail(f) {
			if (!f) return null;
			if (typeof f === "string") {
				return /nomatch|no-match/i.test(f) ? { kind: "nomatch" } : { kind: "down", reason: normErr(f) };
			}
			return f.kind === "down" || f.kind === "nomatch" ? f : null;
		}
		// 一侧状态的单行文案：down → "卡池失败：网络不通"；nomatch → "新卡池未公布"；ok → ""
		// opts.userSupplied：该侧地址由用户自己填（自定义条目 / 自定义网址）时，"未命中"多半意味着
		// "你填的这个地址读不出卡池内容"，而不是"官方还没公布"——文案换一句更贴切的，状态仍是"未公布"
		function sideFailText(side, fail, opts) {
			const f = normalizeFail(fail);
			if (!f) return "";
			if (f.kind === "down") return SIDE_TEXT[side].fail + "：" + (f.reason || "抓取异常");
			return (opts && opts.userSupplied) ? SIDE_TEXT[side].nomatchUser : SIDE_TEXT[side].nomatch;
		}
		// 逐条归类（固定顺序：卡池在前、活动在后；每侧至多一条）
		function entryFailParts(r) {
			const parts = [];
			const gf = normalizeFail(r && r.gachaFail);
			const ef = normalizeFail(r && r.eventFail);
			if (gf) parts.push({ side: "gacha", kind: gf.kind, text: sideFailText("gacha", gf) });
			if (ef) parts.push({ side: "event", kind: ef.kind, text: sideFailText("event", ef) });
			return parts;
		}
		// —— 备选源（altSources / eventAltSources）字段约定 ——
		//   label   设置页显示名
		//   fetcher 抓取器键名（GACHA_FETCHERS / EVENT_FETCHERS[条目 id] 里注册）
		//   url     该来源要抓的地址（大多数备选源）
		//   id      抓取器自带地址的内部来源（如 GameKee）的稳定标识
		// 设置页持久化的"当前来源"就是 url ?? id（不再用伪地址或前缀编码语义）。
		// 老配置里的两种旧写法在读取时自动翻译，无需迁移脚本：
		//   "proxy:<url>"（旧版本用前缀标记"经 host 代理"）、"gk-jp:" / "gk-global:"（旧伪地址）
		//
		// ⚠️ 2026-10-21（P0-1）：ba-global 的默认源从 Nexon 换成 GameKee 后，旧的 GameKee **备选标识**
		//   "ba-global:gamekee" 已不存在（默认就是它）。老配置里存着该值的人不能因此掉到"未知来源"：
		//   映射成 "" = 回落到该条目的默认源（= GameKee），语义与当年选 GameKee 完全一致。
		const altSourceId = (alt) => alt.url || alt.id || "";
		const LEGACY_ALT_IDS = { "gk-jp:": "ba-jp:gamekee", "gk-global:": "", "ba-global:gamekee": "" };
		function normalizeSourceId(v) {
			const s = String(v ?? "");
			const mapped = Object.prototype.hasOwnProperty.call(LEGACY_ALT_IDS, s) ? LEGACY_ALT_IDS[s] : s;
			return mapped.startsWith("proxy:") ? mapped.slice("proxy:".length) : mapped;
		}
		// 顶部提示（**只读 Result JSON**，不碰抓取内部状态）：行内给"分类 + 条目名"（段间空格，
		// 零项不显示），悬停明细逐条分行给原因。games 为按显示顺序排列的条目元信息（含 name）。
		function buildScrapeInfo(games, result) {
			const list = Array.isArray(games) ? games : [];
			const rec = (result && result.games) || {};
			// "成功"口径 = 两侧都没有**报错**（down）；只有 nomatch（未命中）仍算成功
			const okCount = list.filter((g) => {
				const r = rec[g.id];
				if (!r || r.skipped) return false;
				return !isDown(r.gachaFail) && !isDown(r.eventFail);
			}).length;
			// 无任何来源的条目（skipped）既不算成功也不算失败，单独给一句"（跳过 k 个）"
			const skippedCount = list.filter((g) => rec[g.id] && rec[g.id].skipped).length;
			const skippedNote = skippedCount > 0 ? `（跳过 ${skippedCount} 个）` : "";
			// 固定类别顺序：卡池失败 / 活动失败 / 新卡池未公布 / 新活动未公布
			const CATS = [
				["gachaFail", "down", SIDE_TEXT.gacha.fail],
				["eventFail", "down", SIDE_TEXT.event.fail],
				["gachaFail", "nomatch", SIDE_TEXT.gacha.nomatch],
				["eventFail", "nomatch", SIDE_TEXT.event.nomatch]
			];
			const groups = CATS.map(([field, kind, label]) => ({
				label,
				names: list.filter((g) => {
					const f = normalizeFail(rec[g.id] && rec[g.id][field]);
					return f && f.kind === kind;
				}).map((g) => g.name)
			})).filter((grp) => grp.names.length > 0);
			let info = `成功 ${okCount}/${list.length}${skippedNote}`;
			groups.forEach((grp) => { info += ` ${grp.label}：${grp.names.join("、")}`; });
			const lines = list.map((g) => {
				const parts = entryFailParts(rec[g.id] || {});
				return parts.length > 0 ? `${g.name} ${parts.map((p) => p.text).join("、")}` : "";
			}).filter(Boolean);
			return { info, lines };
		}

		// 按设置中的排序（order: id 数组）重排；未设置时保持 SOURCES 顺序
		function applyOrder(sources, order) {
			if (!Array.isArray(order) || order.length === 0) return sources;
			const byId = new Map(sources.map((s) => [s.id, s]));
			const out = [];
			for (const id of order) if (byId.has(id)) out.push(byId.get(id));
			for (const s of sources) if (!out.includes(s)) out.push(s);
			return out;
		}

		// 安全解析 JSON 字符串
		function parseJsonStr(str, fallback) {
			try { return JSON.parse(str || "") ?? fallback; } catch { return fallback; }
		}

		// 全部条目 = 内置(去除已删除) + 自定义条目
		// ⚠️ 这里是**白名单重建**：每加一个内置条目支持的新字段，都必须同步加到这里，
		// 否则自定义条目上写了也会被静默丢掉（2026-10-01 踩到：`tz` 不在列表里，
		// 用户给自定义条目配的源站时区被丢弃，永远退回本机时区）。
		function getAllEntries(s) {
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const base = SOURCES.filter((x) => !removed.includes(x.id));
			const customs = parseJsonStr(s.customEntries, []);
			if (!Array.isArray(customs)) return base;
			const out = base.slice();
			for (const c of customs) {
				if (!c || typeof c.id !== "string") continue;
				out.push({
					id: c.id,
					name: c.name || c.id,
					banner: c.banner || "",
					bannerDates: c.bannerDates || "",
					event: c.event || "",
					eventDates: c.eventDates || "",
					next: c.next || "",
					icon: c.icon || "",
					// 主题色（自定义条目在添加表单里可选；"" 表示不指定 ⇒ scheduleGameColor 回落到名字哈希色）
					color: typeof c.color === "string" ? c.color : "",
					source: c.source || "",
					url: c.url || "",
					eventUrl: c.eventUrl || "",
					// 源站墙钟时区（可选）：留空/不写 → 沿用本机时区（与改造前一致）
					tz: c.tz || null,
					custom: true
				});
			}
			return out;
		}

		// 蔚蓝档案三服角色名特例（一处规则、两个效果合并）：
		// 1) 括号后缀是换装版本标识（桔梗（泳装）、椿(導覽員)、Shiroko (Cycling)），不去除——去掉会与基础版撞名；
		// 2) 括号一律归一为半角（全角（）、半角() 都写成 ()），与日服/国际服源站写法对齐。
		// 其它游戏仍按原规则删掉（属性/职业）后缀（如 克拉蕾（锋御·电）→ 克拉蕾）。
		const BA_ROLE_IDS = ["ba-cn", "ba-global", "ba-jp"];

		function baRoleName(name) {
			return String(name || "").replace(/（/g, "(").replace(/）/g, ")");
		}

		// 角色名精简（面板外显用）：去「」装饰、去（属性/职业）后缀；
		// 「称号·名字」按分隔符去称号（· U+00B7 不限字数；• U+2022 仅 4 字前缀）。
		// 悬停全文仍用原始 roles。
		function cleanRoleNames(roles, gameId) {
			const isBa = BA_ROLE_IDS.includes(gameId);
			return String(roles || "")
				.split(/[、,，]/)
				.map((n) => {
					let s = n.replace(/[「」【】]/g, "");
					if (isBa) s = baRoleName(s); // 蔚蓝三服：保留括号后缀 + 统一半角
					else s = s.replace(/[（(][^）)]*[）)]/g, "");
					s = s.trim();
					// 称号去前缀，按分隔符区分（避免误删角色名）：
					// ·  U+00B7 居中点 = 称号分隔（原神「轰隆雷鸣波·伊涅芙」→ 伊涅芙），不限称号字数；
					// •  U+2022 间隔号 = 角色·变体（星铁「砂金•戏浪」→ 保留），仅在旧规则（4 字前缀）下才去
					const mDot = s.match(/^([\u4e00-\u9fff]{2,10})[\u00B7](.+)$/);
					if (mDot && mDot[2].trim()) {
						s = mDot[2].trim();
					} else {
						const mBullet = s.match(/^([\u4e00-\u9fff]{4})[\u2022](.+)$/);
						if (mBullet) s = mBullet[2].trim();
					}
					return s;
				})
				.filter(Boolean)
				.join("、");
		}

		// 默认爬取源显示名（设置页下拉默认项）
		// urlField: "url"（卡池源）或 "eventUrl"（活动源）
		// 卡池源：source 字段，否则域名；活动源：eventSource 标签，否则域名
		// 该侧压根没配来源时（只抓另一侧的自定义条目会这样）→ 就写"未配置"。
		// ⚠️ 曾经写成"未配置（不抓取卡池/活动）"以免看着像坏了；用户 2026-10-03 明确要求**去掉括号注释**
		//    （下拉里那一列本来就窄，括号反而喧宾夺主）→ 保持裸"未配置"。
		function getDefaultSourceName(g, urlField) {
			const isEvent = urlField === "eventUrl";
			const u = isEvent ? g.eventUrl : g.url;
			if (isEvent) {
				if (g.eventSource && g.eventSource.trim() !== "") return g.eventSource.trim();
				if (u && u.trim() !== "") {
					try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
				}
				return "未配置";
			}
			if (g.source && g.source.trim() !== "") return g.source.trim();
			if (u && u.trim() !== "") {
				try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
			}
			return "未配置";
		}

		// 可见条目 = 全部条目 - 隐藏条目
		//
		// ── 出厂默认隐藏（`defaultHidden`）──
		// 有些来源"能用但不可靠/信息量低"（如 p5x 只有版本公告里的契约块、卡厄斯数据已过期、
		// OurNotes 日服没有卡池源），出厂不该占用面板版面，但**必须仍能在设置页勾选启用**。
		// 用**两个列表**表达三态，避免"默认值只在首次安装生效"这个坑：
		//   · `hidden` —— 用户**明确关掉**的（出厂默认即为空）
		//   · `shown`  —— 用户**明确打开**的（用来覆盖 defaultHidden）
		// 判定：`hidden` 里有 → 隐；`defaultHidden` 且 `shown` 里没有 → 隐；否则显。
		// 这样**老用户**（配置里只有 hidden=[]、没有 shown）也能立刻生效，不必等配置重置。
		function isEntryHidden(x, s) {
			const hidden = Array.isArray(s && s.hidden) ? s.hidden : [];
			if (hidden.includes(x.id)) return true;
			if (!x.defaultHidden) return false;
			const shown = Array.isArray(s && s.shown) ? s.shown : [];
			return !shown.includes(x.id);
		}
		function getVisibleEntries(s) {
			return getAllEntries(s).filter((x) => !isEntryHidden(x, s));
		}

		// 某条目的实际爬取地址：自定义覆盖默认；urlField 区分卡池源(customUrls)/活动源(customEventUrls)
		// 存储值约定：custom:<url>（用户自定义输入，剥前缀返回 url）；其它值经 normalizeSourceId 归一
		// （备选源的标识就是它的 url 或 id，老配置的 proxy:/gk-*: 写法在这里翻译）
		function getEntryUrl(s, id, fallbackUrl, urlField) {
			const urls = parseJsonStr(urlField === "eventUrl" ? s.customEventUrls : s.customUrls, {});
			const u = urls && typeof urls === "object" ? urls[id] : undefined;
			if (typeof u !== "string" || u.trim() === "") return fallbackUrl;
			if (u.startsWith("custom:")) {
				const v = u.slice("custom:".length).trim();
				return v !== "" ? v : fallbackUrl;
			}
			const normalized = normalizeSourceId(u.trim());
			return normalized !== "" ? normalized : fallbackUrl;
		}
		// 该条目的来源地址是否由用户自己填的（设置里存的是 custom:<url>）：
		// 自定义网址允许通用解析兜底（用户在设置页粘 api.php 等页面时，内置解析器可能吃不下）
		function isCustomSource(s, id, urlField) {
			const urls = parseJsonStr(urlField === "eventUrl" ? s.customEventUrls : s.customUrls, {});
			const u = urls && typeof urls === "object" ? urls[id] : undefined;
			return typeof u === "string" && u.startsWith("custom:");
		}

		// 解析面板展示的时间段（mm-dd hh:mm ~ mm-dd hh:mm，无年份，如 "08-12 06:00 ~ 09-01 17:59"）
		// → { startTs, endTs }；无法解析返回 null。年份按当前年补全，跨年（end 月份 < start 月份）自动 +1 年。
		function parseDisplayRange(str, now) {
			if (typeof str !== "string") return null;
			const parts = str.split(/~/).map((x) => x.trim());
			if (parts.length < 2) return null;
			const parsePart = (p) => {
				const m = p.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
				if (!m) return null;
				const mo = Number(m[1]), d = Number(m[2]);
				if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
				const h = m[3] ? Number(m[3]) : 0;
				const mi = m[4] ? Number(m[4]) : 0;
				return { mo, d, h, mi, base: new Date(now.getFullYear(), mo - 1, d, h, mi).getTime() };
			};
			const a = parsePart(parts[0]);
			const b = parsePart(parts[1]);
			if (!a || !b) return null;
			const startTs = a.base;
			let endTs = b.base;
			// 跨年：结束月份小于开始月份（如 12-20 ~ 01-05）→ 结束端按"下一年的同月同日同时刻"重算。
			// 注意不能用 +365 天近似：闰年会差 1 天（实测 2028-12-31 看 "12-30 ~ 01-05" 会少 1 天）。
			if (b.mo < a.mo) endTs = new Date(now.getFullYear() + 1, b.mo - 1, b.d, b.h, b.mi).getTime();
			return { startTs, endTs };
		}

		// 游戏名/图标悬停：这行数据的刷新时间（= 最近一次整行都拿到新数据的时间；
		// 有列沿用旧值时保持旧时间，不谎报新时间）；没有成功记录则只显示名称
		function buildRowTitle(g) {
			return g._okAt ? g.name + "\n刷新时间 " + new Date(g._okAt).toLocaleString() : g.name;
		}

		// 剩余时间文本："X 天 X 小时 X 分钟"；负数（已过）返回 null 由调用方处理
		function formatRemaining(ts, now) {
			const diff = ts - now.getTime();
			if (diff < 0) return null;
			const days = Math.floor(diff / 86400000);
			const hours = Math.floor((diff % 86400000) / 3600000);
			const mins = Math.floor((diff % 3600000) / 60000);
			return `${days}\u5929${hours}\u5C0F\u65F6${mins}\u5206\u949F`;
		}

		// 面板时间列展示：未开始→"还有 X 天 X 小时 X 分钟开始"；进行中→"还剩 X 天 X 小时 X 分钟"；已结束→"已结束"
		function displayTimeCell(raw, now) {
			const r = parseDisplayRange(raw, now);
			if (!r) return raw || "";
			if (now.getTime() < r.startTs) {
				const t = formatRemaining(r.startTs, now);
				return t === null ? raw : `\u8FD8\u6709 ${t} \u5F00\u59CB`;
			}
			if (now.getTime() > r.endTs) return "\u5DF2\u7ED3\u675F";
			const t = formatRemaining(r.endTs, now);
			return t === null ? raw : `\u8FD8\u6709 ${t}`;
		}

		// "这次启动要不要自动刷新一次" —— 纯函数（面板挂载时判定一次；core 不联网、不做决定）。
		// 规则（按优先级）：
		//   ① 版本哨兵对不上 → **强制**刷一次，**不看自动刷新开关**：
		//      · lastVersion 为空 = 首次安装（或装了本功能之前的旧缓存、上次刷新没成功）
		//      · 否则 = 插件已更新（悬停格式、来源地址、解析器、样式等改动不刷新就看不到效果）
		//   ② 到点（lastRefresh + refreshMinutes 已过） → 仅当自动刷新开关为开时刷
		// 为什么必须有它：定时器只按"本次运行时长"计时（重启即归零，谁也不会一直不关电脑），
		// 所以"启动时判一次"才是间隔设置真正生效的地方。UI 只负责照做与提示。
		function autoRefreshPlan(input) {
			const s = input || {};
			const pluginVersion = String(s.pluginVersion || "");
			const cachedVersion = String(s.lastVersion || "");
			if (pluginVersion && cachedVersion !== pluginVersion) {
				return { due: true, force: true, reason: cachedVersion ? "\u63D2\u4EF6\u5DF2\u66F4\u65B0" : "\u9996\u6B21\u542F\u52A8" };
			}
			if (!s.autoRefresh) return { due: false, force: false, reason: "" };
			const minutes = Number(s.refreshMinutes);
			const at = Number(s.lastRefresh) || 0;
			if (!Number.isFinite(minutes) || minutes <= 0 || at <= 0) return { due: false, force: false, reason: "" };
			if (at + minutes * 60000 <= (Number(s.now) || 0)) return { due: true, force: false, reason: "\u5DF2\u5230\u5237\u65B0\u95F4\u9694" };
			return { due: false, force: false, reason: "" };
		}
		// —— 「到期提醒」判定（纯函数，2026-10-25）——
		// 口径（用户定，MVP 只做红点，不做系统通知/弹窗/声音）：
		//   某侧"即将到期" = 该侧**已开始**（startTs <= now）且 **endTs 落在 (now, now + N 小时]**。
		//   · 未开始的窗口**不算**：它的 endTs 也在未来，但那属于"还没开始"，不是"快到期"；
		//   · 已结束（含 now == endTs 那一刻）**不算**；
		//   · N <= 0（设置里的「关闭」）恒为 false —— 关闭时**连算都不算**，调用方也应该短路；
		//   · startTs / endTs 任一缺失或不是有限数字 → 不算（落盘数据里这两端本来就可能是空的：
		//     缓存只存文本，绝对档期靠 80-components.js 的 localDatesOf 现算）。
		// 放在 helpers（而不是渲染层）的理由：它是纯判定、零宿主依赖，core 产物里也能直接用
		// （CORE_ORDER 含本文件），单测可以直接喂固定时刻（test/cases-remind.mjs）。
		function isExpiringSoon(startTs, endTs, nowTs, remindHours) {
			const hours = Number(remindHours);
			if (!(hours > 0)) return false;
			if (typeof startTs !== "number" || typeof endTs !== "number") return false;
			if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return false;
			if (!(startTs <= nowTs)) return false;
			if (!(endTs > nowTs)) return false;
			return endTs - nowTs <= hours * 3600000;
		}

		// 从「{ startTs, endTs } 列表」里挑出即将到期的（顺序保持输入顺序）。
		// 单独一个函数是为了让"关闭时不算"只有一处实现：N <= 0 → 直接空数组。
		function expiringSoonOf(items, nowTs, remindHours) {
			const hours = Number(remindHours);
			if (!(hours > 0) || !Array.isArray(items)) return [];
			return items.filter((it) => it && isExpiringSoon(it.startTs, it.endTs, nowTs, hours));
		}

		// —— 双向「到期提醒」判定（2026-10-25 晚升级：侧栏按钮从红点改成单行轮播）——
		// 用户口径（原话）：即将**结束**和即将**开始**都算提醒。所以判定从"只看 endTs"扩成双向，
		// 但**没有改** isExpiringSoon（它仍然只管结束，语义一字未动，老用例继续守着）：
		//   · "end"   = 这一侧**已开始**（startTs <= now）且 endTs 落在 (now, now + N 小时]；
		//   · "start" = 这一侧**还没开始**（startTs > now）且 startTs 落在 (now, now + N 小时]；
		//   · 其余（还早 / 已结束 / 缺 ts / 结束早于开始的脏数据）一律 ""。
		// 两者天然互斥（startTs <= now 的走 end 分支，> now 的走 start 分支），不需要再排优先级。
		// N <= 0（设置里的「关闭」）恒为 "" —— 关闭时**连算都不算**，调用方也应短路。
		// 纯函数、不读 Date.now / window：单测直接喂固定时刻（test/cases-remind.mjs）。
		function remindKindOf(startTs, endTs, nowTs, remindHours) {
			const hours = Number(remindHours);
			if (!(hours > 0)) return "";
			if (typeof startTs !== "number" || typeof endTs !== "number") return "";
			if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || !Number.isFinite(nowTs)) return "";
			if (!(endTs > startTs)) return "";
			const horizon = hours * 3600000;
			if (startTs > nowTs) return startTs - nowTs <= horizon ? "start" : "";
			if (!(endTs > nowTs)) return "";
			return endTs - nowTs <= horizon ? "end" : "";
		}

		// 某个条目是否参与提醒 —— 「强提醒」开关（设置页每行一个复选框）的**唯一语义来源**。
		// 口径（2026-10-25 **二次定稿**，用户原话「"空列表=全部展示中的参与"的副作用过大，改成正常的逻辑」）：
		//   · 列表里**有**这个 id ⇒ 参与；
		//   · 列表里**没有**（含空数组）⇒ 不参与 —— **空数组 = 一个都不提醒**，普通列表语义，
		//     **不再有"空 = 全部参与"的哨兵**。
		// 为什么去掉哨兵：哨兵让"一个都不提醒"表达不出来 ⇒ 设置页"取消最后一个勾"只能被拒绝
		// （旧实现正是这么挡的，还得弹一句"要全关请改提前量"）。副作用大于收益，故废弃。
		// 开箱即用不再靠哨兵，改靠**出厂默认值**：DEFAULT_SETTINGS.remindGames = 出厂时展示中的条目
		// （守卫见 test/cases-remind.mjs，新增来源忘了同步会红）。
		// 缺失 / 不是数组（老配置里根本没有这个键）⇒ 按**空列表**处理：这里不猜"没设置过"，
		// 因为已经没有可猜的哨兵语义了；schema 的 default 会在读配置时补上出厂默认值。
		function remindGameAllowed(gameId, remindGames) {
			if (!Array.isArray(remindGames)) return false;
			return remindGames.includes(gameId);
		}

		// 从候选里挑出"该提醒的"（顺序稳定 = 按"距离那一刻还有多久"升序，同刻保持输入顺序）。
		// items 契约（由 80-components.js 的 remindDueOf 组装，那里负责把落盘文本换算成绝对窗口）：
		//   { key, gameId, side, name, title, startTs, endTs }
		// 返回的每一项多两个字段：kind（"end" / "start"）与 dueMs（距离结束/开始还剩多少毫秒）。
		// 排序口径：**先到期的最靠前** —— "还剩 1 小时"永远压过"明天开池"（中间不夹"按方向分组"）。
		function remindPickOf(items, nowTs, remindHours, remindGames) {
			const hours = Number(remindHours);
			if (!(hours > 0) || !Array.isArray(items)) return [];
			const out = [];
			for (const it of items) {
				if (!it) continue;
				if (!remindGameAllowed(it.gameId, remindGames)) continue;
				const kind = remindKindOf(it.startTs, it.endTs, nowTs, hours);
				if (!kind) continue;
				out.push({ ...it, kind, dueMs: (kind === "end" ? it.endTs : it.startTs) - nowTs });
			}
			// Array.prototype.sort 自 ES2019 起保证稳定 ⇒ 同一毫秒的多条保持输入顺序（可复现）
			return out.sort((a, b) => a.dueMs - b.dueMs);
		}

		// 距离毫秒数 → 一句人话（只有数字 + 单位，标签由调用方加）。
		// 口径（2026-10-25 三次定稿，用户要求）：<1 小时说"分"、<1 天说"小时"、再往上**只说天数**
		// —— ≥1 天不再拼小时段（"3 天 4 小时" → "3 天"，侧栏这一行总共只有 ~12 个汉字宽）。
		// 向下取整（宁可说"3 小时"也不说"4 小时"）—— 提醒场景里**说少了**比说多了安全。
		function remindSpanText(ms) {
			const t = Number(ms);
			if (!Number.isFinite(t) || t <= 0) return "1 分";
			const mins = Math.floor(t / 60000);
			if (mins < 60) return Math.max(1, mins) + " 分";
			const hours = Math.floor(t / 3600000);
			if (hours < 24) return hours + " 小时";
			return Math.floor(t / 86400000) + " 天";
		}

		// 开始时刻 → 「今天 / 明天 / N 天后」（只比**本机日历日**，与面板外显"今天到期"同一口径）。
		// 刻意**不带时刻**：侧栏这一行只有 ~12 个汉字宽，多写个 "18:00" 就把游戏名挤没了。
		// 用 Math.round 而不是整除：跨 DST 的那一天是 23/25 小时，整除会差一天。
		function remindDayWord(ts, nowTs) {
			const a = new Date(ts), b = new Date(nowTs);
			if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return "";
			const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
			const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
			const diff = Math.round((dayA - dayB) / 86400000);
			if (diff <= 0) return "今天";
			if (diff === 1) return "明天";
			return diff + " 天后";
		}

		// 一条提醒 → 侧栏那一行的**两段文案**：{ name, status, text }。
		// 为什么拆两段而不是拼好一句交给 CSS 截断：`text-overflow:ellipsis` 截的是**尾巴**，
		// 而这里最不能丢的恰恰是尾巴（"还剩 3 小时 / 明天开池"）。所以渲染层把 name 单独放进
		// 可收缩 + 省略号的盒子、status 放进 flex:none 的盒子 —— 名字再长也只压名字。
		// 口径：
		//   · name = **事项名优先**（2026-10-25 二次定稿，用户 C 方案：「只有游戏名称没有角色/活动
		//     名称，信息不足」）—— 卡池侧给那一期的角色名、活动侧给活动名；**游戏身份交给图标**
		//     （gameIcon，见 remindDueOf / remindSlidesOf），文字不再占宽度去写游戏名。
		//     回退顺序：事项名 title → 游戏名 name → id → "某个游戏"（自定义条目可能没有 title，
		//     绝不能显示 undefined）。
		//   · 结束（kind=end）→ status = "X"（X 由 remindSpanText 给，两个方向都适用）——
		//     **按钮这一侧不带「还剩」**（2026-10-25 三次定稿，用户要求「· 还剩 8 小时」→「· 8 小时」）；
		//     读屏/悬停要的是完整句子，那里由 statusFull（补回「还剩」）单独拼，见 statusFull 的注释；
		//   · 开始（kind=start）→ status = "今天/明天/N 天后" + "开池"（卡池侧）/ "开始"（活动侧）。
		function remindCaptionOf(item, nowTs) {
			const it = item || {};
			const name = String(it.title || it.name || it.gameId || "").trim() || "某个游戏";
			const isStart = it.kind === "start";
			const isG = it.side === "gacha";
			const status = isStart
				? remindDayWord(Number(it.startTs), nowTs) + (isG ? "开池" : "开始")
				: remindSpanText(Number(it.endTs) - nowTs);
			// 读屏 / 悬停（aria-label / title）用的**完整句子**：结束方向补回「还剩」，
			// 否则"耀嘉音 · 8 小时"念出来不通顺（用户 2026-10-25 明确要求这一处保留「还剩」）。
			// 这是唯一一处单独拼接 —— 按钮那一侧（status / text）不再带「还剩」。
			const statusFull = isStart ? status : "还剩 " + status;
			return { name, status, statusFull, text: name + " · " + status, ariaText: name + " · " + statusFull };
		}

		// 轮播的**每一格**（C 方案，2026-10-25 二次定稿）：整行连同图标一起竖向翻页。
		// 输入 = remindPickOf 的输出（remindDueOf 已给每条补上 gameIcon）。
		// 输出一格一条：{ gameId, gameIcon, gameName, itemName, statusText, text, ariaText, kind }
		//   · gameId / gameIcon → 这一格左侧的图标（状态 i 用**该游戏自己的**图标）；
		//   · itemName + statusText → 文字两段（名字可截断、状态永不截断，见 remindCaptionOf）；
		//   · gameName 只给悬停/读屏补一句"这是哪款游戏"（图标认得出来，文字里不占宽度）；
		//   · text = 完整一行（"名字 · 状态"，**按钮上显示的那一份**，不带「还剩」）；
		//   · ariaText = 同一行的**读屏版**（结束方向带「还剩」，念出来才是完整句子）；
		//     悬停/aria-label 用它，按钮渲染用 text —— 两处只有这一个词不同，其余同源。
		// ⚠️ 状态 0（"原按钮外观"：日历图标 + 「二游日历」）**不**在这里 —— 那是渲染层的事；
		//    本函数只负责"每格一条提醒"，所以无可提醒时返回 []（⇒ 只有状态 0、不滚动）。
		function remindSlidesOf(items, nowTs) {
			if (!Array.isArray(items)) return [];
			return items.filter(Boolean).map((it) => {
				const cap = remindCaptionOf(it, nowTs);
				return {
					gameId: String(it.gameId || it.id || ""),
					gameIcon: String(it.gameIcon || ""),
					gameName: String(it.name || ""),
					itemName: cap.name,
					statusText: cap.status,
					text: cap.text,
					ariaText: cap.ariaText,
					kind: String(it.kind || "")
				};
			});
		}
		//#endregion
		//#endregion
