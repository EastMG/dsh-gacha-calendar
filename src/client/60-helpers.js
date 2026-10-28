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

		//#region 来源健康（解析器自检 / 待办第 3 项）
		// 目的：让"**能抓但抓不到东西**"这类故障自己浮出来，不必等用户发现面板空了。
		// 踩过的两个坑都是这一种（不是 HTTP 失败）：
		//   · 异环公告改成按段落锚点写 → 请求 200、页面结构不认识 → 解析出 0 条；
		//   · 雪松源页面停更 → 请求 200、页面上就是没有当期内容 → 解析出 0 条。
		// 与 `buildScrapeInfo` 的分工：那个只算**本轮**的顶部横幅（成功 N/M + 五类归类），一次性的、
		// 不落盘、刷新完就丢；这里是**跨轮累积**的每源状态（最近成功时间 / 连续失败次数 / 连续 nomatch
		// 起点），写进独立键 `sourceHealth` —— **不污染 lastData**（后者是渲染的唯一数据源，形状是冻结契约）。
		//
		// 每轮逐源折算成三种结论 + 跳过：
		//   ok       —— 至少一侧解析出了内容（items ≥ 1）
		//   nomatch  —— 每一侧都"请求成功但解析出 0 条"（上面那两个坑就是这个形态）
		//   down     —— 任一侧抓取/解析报错（网络 / CORS 被拦 / HTTP 非 2xx / 超时 / 解析崩）
		//   skip     —— 这一轮**根本没抓**（条目两侧都没配来源 / 被跳过）⇒ 不编造结论；
		//               整轮更新时这条例目**连记录都不留**（"没有可抓来源"没有健康可言，见 updateOf）
		// 说明：items 是"**有内容的侧数**"（0~2），不是条目条数 —— 解析结果是一段成品文本，
		// 不重新解析数不出条数，而"最近成功"这个用途只需要这个粒度。
		const SOURCE_HEALTH_VERSION = 1;
		// N 天连续 nomatch ⇒ 提示"源可能改版或停更"。
		// 取 7 天的理由：更短会把"这个池子刚好空档"误报成改版（卡池之间有天然空窗）；
		// 更长则用户早就看见面板空了。做成常量（不要在判定/文案里散写 7），口径与报告都引这一处。
		const SOURCE_HEALTH_NOMATCH_DAYS = 7;
		const SOURCE_HEALTH_DAY_MS = 86400000;

		// 读存档：坏值 / 缺失 / 空串一律当成"没有记录"（**永不抛** —— 它只是辅助信息，
		// 存坏了不该让设置页或刷新链路跟着炸）。返回 { v, at, sources }。
		function parseSourceHealth(raw) {
			const obj = typeof raw === "string"
				? parseJsonStr(raw, null)
				: (raw && typeof raw === "object" ? raw : null);
			const sources = obj && obj.sources && typeof obj.sources === "object" ? obj.sources : {};
			return { v: SOURCE_HEALTH_VERSION, at: Number(obj && obj.at) || 0, sources };
		}

		// 本轮结论（纯函数）：source = 条目元信息（要 url / eventUrl 才知道"这一侧配了没有"），
		// r = fetchEntry 的返回（{ data, gachaFail, eventFail, reason }）。
		function sourceHealthRoundOf(source, r) {
			const id = String((source && source.id) || "");
			if (!id) return { id: "", status: "skip", items: 0, error: "" };
			const hasGacha = !!source.url;
			const hasEvent = !!source.eventUrl;
			if ((!hasGacha && !hasEvent) || (r && r.reason === "skipped")) {
				return { id, status: "skip", items: 0, error: "" };
			}
			const data = (r && r.data) || {};
			// 与面板 / 顶部横幅同一口径：卡池看 banner、活动看 event，空串 = 这一侧没有内容。
			const items = (hasGacha && data.banner ? 1 : 0) + (hasEvent && data.event ? 1 : 0);
			// down 优先于"没内容"：报错有可行动的原因，不能被笼统说成"未公布"。
			const gF = normalizeFail(r && r.gachaFail);
			const eF = normalizeFail(r && r.eventFail);
			const downSide = hasGacha && isDown(gF) ? "gacha" : (hasEvent && isDown(eF) ? "event" : "");
			if (downSide) {
				return { id, status: "down", items, error: sideFailText(downSide, downSide === "gacha" ? gF : eF) };
			}
			if (items === 0) return { id, status: "nomatch", items: 0, error: "" };
			return { id, status: "ok", items, error: "" };
		}

		// 单源累积（纯函数）：prev = 上一条记录（可无），round = 本轮结论，now = 毫秒时间戳。
		// · down     ⇒ failStreak+1，nomatch 连击清掉（中间失败过一次就不再算"连续 nomatch"）
		// · nomatch  ⇒ nomatchStreak+1，起点只在连击里保留（中途成功/失败过就重新起算）
		// · ok       ⇒ 两条连击都清零，okAt = 本轮时间
		// · skip     ⇒ 返回 prev 原样（"没抓"不是结论，绝不能写成成功或失败）
		//              ⚠️ 整轮更新（sourceHealthUpdateOf）对 skip 更狠：记录直接丢掉 —— 见那里的注释。
		function sourceHealthNextOf(prev, round, now) {
			const p = prev && typeof prev === "object" ? prev : null;
			if (!round || round.status === "skip") return p;
			const at = Number(now) || 0;
			const okAt = p ? Number(p.okAt) || 0 : 0;
			const base = { at, okAt, items: 0, error: "", failStreak: 0, nomatchStreak: 0, nomatchSince: 0 };
			if (round.status === "down") {
				return {
					...base,
					error: String(round.error || "") || "抓取异常",
					failStreak: (p ? Number(p.failStreak) || 0 : 0) + 1
				};
			}
			if (round.status === "nomatch") {
				const prevStreak = p ? Number(p.nomatchStreak) || 0 : 0;
				return {
					...base,
					nomatchStreak: prevStreak + 1,
					nomatchSince: prevStreak > 0 && Number(p.nomatchSince) > 0 ? Number(p.nomatchSince) : at
				};
			}
			return { ...base, okAt: at, items: Number(round.items) || 0 };
		}

		// 一轮刷新后的整体更新（纯函数）：rounds = 逐条结论，keepIds = 现存条目 id（含隐藏的）。
		// · 旧记录只搬"条目还在"的那些（删掉的条目不再占存档；隐藏条目本轮没抓 ⇒ 原样保留）；
		// · 本轮 skip 的条目（两侧都没配来源 / 被跳过）：**记录一并丢掉** —— 不把"没抓"写成
		//   "失败"，也不留一条再也不会更新的历史（那会僵成一条假「疑似停更」）。
		function sourceHealthUpdateOf(prevRaw, rounds, now, keepIds) {
			const prev = parseSourceHealth(prevRaw);
			const keep = Array.isArray(keepIds) ? keepIds.filter((x) => typeof x === "string") : null;
			const sources = {};
			for (const [id, rec] of Object.entries(prev.sources)) {
				if (keep && keep.indexOf(id) < 0) continue;
				if (!rec || typeof rec !== "object") continue;
				sources[id] = rec;
			}
			for (const round of Array.isArray(rounds) ? rounds : []) {
				if (!round || !round.id) continue;
				// 只收"现存条目"的结论：与上面搬运同一条不变量（存档里不出现已删除的 id）
				if (keep && keep.indexOf(round.id) < 0) continue;
				// 这一轮**没抓**（条目两侧都没配来源 / 被跳过）⇒ 不算结论，而且记录一并丢弃：
				// 一个"没有可抓来源"的条目没有健康可言，留着旧记录只会僵在那里，
				// 几天后正好伪造出我们要防的那条"疑似停更"。
				// （隐藏条目根本不在 rounds 里，走上面的搬运 ⇒ 原样保留，不会被这里清掉。）
				if (round.status === "skip") {
					delete sources[round.id];
					continue;
				}
				const next = sourceHealthNextOf(sources[round.id], round, now);
				if (next) sources[round.id] = next;
			}
			return { v: SOURCE_HEALTH_VERSION, at: Number(now) || 0, sources };
		}

		// 语义比较：新算出的存档 next 与存储里的旧值 prevRaw 是否**内容相同**。
		// 用途：引擎刷新时决定「要不要再写一笔设置」—— 设置写入是一次宿主往返（实测一次 1.4~3.6s），
		// 每轮无脑写等于给"什么都没变"的健康状态白付一次往返（来源健康上线后刷新总时长 +~20%）。
		//
		// 比较口径：v + sources 逐 id 逐字段，但**忽略三处本轮时间戳**：
		//   · 顶层 at          —— 存档时间戳（UI 不读它，只作"上次记录时间"）
		//   · 每条记录的 at    —— 同上，逐源版本
		//   · 每条记录的 okAt  —— 成功的那一轮会被写成 now（sourceHealthNextOf），与 at 同性质。
		//                          把它算进比较 ⇒ 只要有一个源正常，逐轮都会"不同"，一次也跳不掉
		//                          （实测：忽略前每轮必写，等于没优化）。
		// ⚠️ 如实写明的代价：跳过的轮次不刷新存档里的时间戳，所以健康面板里的「最近成功 X 前」
		//    可能停在**上一次内容变化**（或上一次别的原因触发的写入）的那一轮 —— 健康的行会越走越旧，
		//    某源转入失败的那一轮也可能把「最近成功」显旧。失败行另外两个数字不受影响：
		//    down / nomatch 每轮都会推进 failStreak / nomatchStreak（内容真的变了）⇒ 每轮必写，
		//    「连续失败 N 次 · 原因」始终新鲜。
		// ✅ 这个"偏旧"在**显示侧**补掉，存储口径一个字没动（跳过写入的收益原样保留）：
		//    sourceHealthOf 收 `opts.lastRefreshAt`（本机最近一轮刷新时间），对"当前持续成功"的源
		//    用 max(okAt, lastRefreshAt) 当最近成功时间。语义见下面的 sourceHealthOf。
		//
		// 为什么按字段比而不按 JSON 文本比：旧存档可能来自手改/老版本（数字是字符串、字段缺失），
		// 文本比较会因为键序/空白/类型差异假报"变了"；这里逐字段 Number()/String() 归一。
		function sourceHealthSameOf(prevRaw, next) {
			const prev = parseSourceHealth(prevRaw);
			const n = next && typeof next === "object" ? next : {};
			const a = prev.sources;
			const b = n.sources && typeof n.sources === "object" ? n.sources : {};
			if (prev.v !== SOURCE_HEALTH_VERSION || Number(n.v) !== SOURCE_HEALTH_VERSION) return false;
			const aIds = Object.keys(a);
			const bIds = Object.keys(b);
			if (aIds.length !== bIds.length) return false;
			for (const id of bIds) {
				if (!Object.prototype.hasOwnProperty.call(a, id)) return false;
				const x = a[id], y = b[id];
				if (!x || typeof x !== "object" || !y || typeof y !== "object") return false;
				if ((Number(x.items) || 0) !== (Number(y.items) || 0)) return false;
				if ((Number(x.failStreak) || 0) !== (Number(y.failStreak) || 0)) return false;
				if ((Number(x.nomatchStreak) || 0) !== (Number(y.nomatchStreak) || 0)) return false;
				if ((Number(x.nomatchSince) || 0) !== (Number(y.nomatchSince) || 0)) return false;
				if ((String(x.error) || "") !== (String(y.error) || "")) return false;
			}
			return true;
		}

		// 给 UI 的每源状态（纯函数）：sources = 存档里的 sources 表，now = 毫秒时间戳，
		// opts = { entries: [{ id, name }]（**展示中**的条目，决定范围与顺序）, nomatchDays,
		//          lastRefreshAt }（本机最近一轮刷新时间，可选）。
		//
		// `lastRefreshAt` 只用来**修显示**，不碰存档（见 sourceHealthSameOf 上面那段代价说明）：
		// 健康状况没变时那一笔设置被跳过 ⇒ 存档里的 okAt 停在最后一次真正写入的轮次，稳定 30 天
		// 就会显示"最近成功 30 天前"。而"该源当前是 ok（failStreak / nomatchStreak 都是 0）"
		// 在语义上等价于"此后每一轮都成功"，所以把最近成功时间顶到 lastRefreshAt 是等价换算，
		// 不是编造。三处限定，缺一不可：
		//   · 只看 **ok**：down / stale / never 恰恰意味着"此后并非每轮都成功"，用 lastRefresh
		//     覆盖等于把他们真实的上次成功时间抹成"刚刚"（会与同一行的「连续失败 N 次」自相矛盾）；
		//   · 要求 nomatchStreak === 0：state 的 ok 档**包含**"nomatch 还没到 7 天阈值"那段
		//     （没到阈值不打扰用户），那段时间并没有成功解析出内容 —— 顶成"刚刚成功"就变成
		//     显示谎言，而且这类行本来每轮都在推进 nomatchStreak（内容变了）⇒ 存档是新鲜的，
		//     根本不需要补偿；
		//   · 要求 lastRefreshAt <= now 且 okAt > 0：时钟回拨/坏值时不倒着编一个"最近成功"。
		// 返回 [{ id, name, known, state, failStreak, nomatchDays, nomatchMs, lastOkAt, items, error,
		//         text, tag, tone, reason, agoText }]
		//   展示侧三段（2026-10-28 设置页改四列网格）：tag = 状态胶囊短标签（带灰点/警告/叉），
		//   reason = 原因列（失败原因 / 连续 N 天没解析出内容 / 正常行的解析条数），agoText = 最近成功列；
		//   tone = 颜色档（ok / warn / error），渲染层不再从 state 二次映射 —— 措辞只在这里写一次。
		//   state:
		//     "ok"    —— 正常（最近一轮成功，或连击还没到 N 天 —— 没到阈值不打扰用户）
		//     "down"  —— 连续失败 ≥ 1 次（原因在 error；从未成功也在这一档，因为"为什么失败"更有用）
		//     "stale" —— 连续 nomatch 且**跨过 N 天**（曾经成功过）⇒ 疑似改版或停更
		//     "never" —— 连续 nomatch 且跨过 N 天，而且**一次都没成功过** ⇒ 从装上就没抓到东西
		// `text` 就是设置页那一行（"游戏名 · 连续失败 N 次 · 最近成功 X 前 · 原因"）。
		function sourceHealthOf(sources, now, opts) {
			const list = Array.isArray(opts && opts.entries) ? opts.entries : [];
			const days = Number(opts && opts.nomatchDays) > 0 ? Number(opts.nomatchDays) : SOURCE_HEALTH_NOMATCH_DAYS;
			const at = Number(now) || 0;
			// 本机最近一轮刷新时间（设置里的 lastRefresh；0 / 缺省 = 不知道 ⇒ 不做任何补偿）
			const lastRefreshAt = Math.max(0, Number(opts && opts.lastRefreshAt) || 0);
			const map = sources && typeof sources === "object" ? sources : {};
			return list.map((g) => {
				const id = String((g && g.id) || "");
				const name = String((g && g.name) || id);
				const rec = map[id] && typeof map[id] === "object" ? map[id] : null;
				const okAt = rec ? Number(rec.okAt) || 0 : 0;
				const items = rec ? Number(rec.items) || 0 : 0;
				const failStreak = rec ? Number(rec.failStreak) || 0 : 0;
				const nomatchStreak = rec ? Number(rec.nomatchStreak) || 0 : 0;
				const since = rec ? Number(rec.nomatchSince) || 0 : 0;
				// 连击跨度：只认"当前这一段连击"的起点（成功/失败过就归零，见 sourceHealthNextOf）
				const nomatchMs = nomatchStreak > 0 && since > 0 && at > since ? at - since : 0;
				const nomatchDays = Math.floor(nomatchMs / SOURCE_HEALTH_DAY_MS);
				// 判定顺序：连续失败 > 疑似停更 > 正常。失败优先 —— 那是有明确原因、能动手修的。
				let state = "ok";
				if (failStreak > 0) state = "down";
				else if (nomatchMs >= days * SOURCE_HEALTH_DAY_MS) state = okAt > 0 ? "stale" : "never";
				// 显示用的「最近成功」：只对"当前持续成功"的源把 okAt 顶到本机最近一轮刷新
				//（跳过写入导致的显示偏旧，口径与理由见函数头注释）。判定 state 仍只看真实 okAt。
				const lastOkAt = state === "ok" && rec && okAt > 0 && nomatchStreak === 0
					&& lastRefreshAt > 0 && lastRefreshAt <= at && lastRefreshAt > okAt
					? lastRefreshAt
					: okAt;
				const agoText = lastOkAt > 0 && at > lastOkAt ? "最近成功 " + tickerSpanText(at - lastOkAt) + "前" : "从未成功";
				const parts = [];
				if (state === "down") parts.push("连续失败 " + failStreak + " 次");
				// "连续 N 天"：N 一律用**实际跨度**（向下取整），不用阈值字面量 —— 否则 9 天会说成 7 天。
				if (state === "stale" || state === "never") parts.push("连续 " + (nomatchDays || days) + " 天没解析出内容");
				parts.push(agoText);
				if (state === "down" && rec && rec.error) parts.push(String(rec.error));
				if (state === "stale" || state === "never") parts.push("疑似改版或停更");
				// 设置页四列网格要的三段展示文案（与 text 同源）：
				//   · tag = 状态胶囊：灰点 = 正常、警告 = 停更/从未成功、叉 = 抓取失败；
				//   · reason = 原因列：失败原因（没有就退化成连击次数）/ 连续 N 天没解析出内容 /
				//     正常行的「解析出 N 条」；
				//   · tone = 颜色档（ok / warn / error），供圆点与胶囊选色，渲染层不再从 state 二次映射。
				const tag = state === "down"
					? "✕ 抓取失败"
					: state === "stale"
						? "⚠ 疑似停更"
						: state === "never"
							? "⚠ 从未成功"
							: "● 正常";
				const tone = state === "down" ? "error" : (state === "ok" ? "ok" : "warn");
				let reason = "";
				if (state === "down") reason = rec && rec.error ? String(rec.error) : "连续失败 " + failStreak + " 次";
				else if (state === "stale" || state === "never") reason = "连续 " + (nomatchDays || days) + " 天没解析出内容";
				else if (items > 0) reason = "解析出 " + items + " 条";
				return {
					id,
					name,
					known: !!rec,
					state,
					failStreak,
					nomatchDays,
					nomatchMs,
					lastOkAt,
					items,
					error: rec && rec.error ? String(rec.error) : "",
					text: parts.join(" · "),
					tag,
					tone,
					reason,
					agoText
				};
			});
		}
		//#endregion

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

		//#region 搜索与筛选（待办第 4 项；**纯函数**，设置页与面板共用同一套匹配口径）
		//
		// 为什么单独抽一层、而不是在渲染层各写一份 includes：
		//   · 设置页「搜游戏名」与面板「按卡池/角色名搜」的**归一规则必须一样**（大小写 / 全半角 /
		//     前后空格 / 多关键词），否则同一个词在两处命中结果不同 —— 用户只会觉得"搜不到"；
		//   · 全是纯函数 ⇒ 空查询 / 大小写 / 中英混输 / 全半角 / 前后空格 / 无匹配六种情况能离线钉住
		//     （见 test/cases-filter.mjs）。
		//
		// ⚠️ 两条边界：
		//   ① 过滤是**纯显示层**：不写设置、不改 `lastData`、不影响轮播与提醒
		//      （面板的轮播 memo 仍读未过滤的 games，见 80-components.js）；
		//   ② 空查询 = 不过滤（返回原数组 / 原引用的副本），所以"清空即恢复"不需要额外分支。

		// 归一：全半角（NFKC：全角字母/数字/标点 → 半角）+ 大小写 + 连续空白压成一个空格 + 去首尾空白。
		// 中文/日文汉字过 NFKC 不变 ⇒ 中英混输、全半角混输都能命中同一段文本（"Ｆａｔｅ" ≡ "fate"）。
		function searchNorm(v) {
			return String(v == null ? "" : v).normalize("NFKC").toLowerCase().replace(/[\s\u3000]+/g, " ").trim();
		}
		// 查询串 → 关键词数组：空格分隔、**全部命中**才算命中（AND 语义，与词序无关）。
		// 空查询 ⇒ 空数组 = 不过滤（"清空即恢复"由这一条保证，调用方不另写 if）。
		function searchTokens(query) {
			const q = searchNorm(query);
			return q === "" ? [] : q.split(" ").filter(Boolean);
		}
		// 命中判定：haystack 里出现**全部**关键词。haystack 可以是数组（多字段拼在一起，见 panelEntryHit）。
		function searchHit(haystack, query) {
			const tokens = searchTokens(query);
			if (tokens.length === 0) return true;
			const text = searchNorm(Array.isArray(haystack) ? haystack.filter(Boolean).join("\n") : haystack);
			return tokens.every((t) => text.indexOf(t) >= 0);
		}
		// 设置页「游戏列表」过滤：搜游戏名 + 只看已启用，**组合生效**（两个条件同时满足才留）。
		//   opts.query     —— 搜索词（按游戏名匹配）
		//   opts.onlyShown —— true = 只留"展示中"的；"展示中"的判定由调用方给（opts.isShown），
		//                     设置页传的是**草稿优先**的 shownNow ⇒ 勾/取消当拍就与筛选对齐，
		//                     不用等宿主那一次 1.4~3.6s 的写入往返（也不另立第二套显隐判定）。
		// 返回**新数组**（不改入参、不改顺序）。
		function settingsGamesFilter(entries, opts) {
			const list = Array.isArray(entries) ? entries : [];
			const o = opts || {};
			const onlyShown = o.onlyShown === true;
			if (searchTokens(o.query).length === 0 && !onlyShown) return list.slice();
			const isShown = typeof o.isShown === "function" ? o.isShown : () => true;
			return list.filter((g) => (!onlyShown || isShown(g)) && searchHit(g && g.name, o.query));
		}
		// 面板搜索的命中面：游戏名 / 卡池名（banner）/ 角色名（roles）/ 活动名（event）—— 任一命中即算。
		// ⚠️ 只读条目字段：过滤是**纯显示层**，lastData / 轮播 / 提醒都不经过这里。
		function panelEntryHit(game, query) {
			if (!game) return false;
			return searchHit([game.name, game.banner, game.roles, game.event], query);
		}
		// 面板过滤：空查询 ⇒ **原样返回同一个数组**（上层 useMemo 不失效、零额外开销）。
		function panelGamesFilter(games, query) {
			const list = Array.isArray(games) ? games : [];
			if (searchTokens(query).length === 0) return list;
			return list.filter((g) => panelEntryHit(g, query));
		}
		//#endregion

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
		// 「快到期」判定：某一侧已开始，且结束落在 (now, now + withinHours]；N <= 0 / 缺 ts 一律不算。
		// 纯函数、零宿主依赖（core 也用），单测可直接喂固定时刻。
		function isExpiringSoon(startTs, endTs, nowTs, withinHours) {
			const hours = Number(withinHours);
			if (!(hours > 0)) return false;
			if (typeof startTs !== "number" || typeof endTs !== "number") return false;
			if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return false;
			if (!(startTs <= nowTs)) return false;
			if (!(endTs > nowTs)) return false;
			return endTs - nowTs <= hours * 3600000;
		}

		// 列表版：顺序保持输入；范围无效时直接空数组（"不算"只有这一处实现）。
		function expiringSoonOf(items, nowTs, withinHours) {
			const hours = Number(withinHours);
			if (!(hours > 0) || !Array.isArray(items)) return [];
			return items.filter((it) => it && isExpiringSoon(it.startTs, it.endTs, nowTs, hours));
		}

		// 「快到期」判定（2026-10-28 起**只判结束**）：即将结束 = 已开始且 endTs 在窗口内；
		// 即将开始 = 未开始且 startTs 在窗口内（**该方向已停用**，原行留在下面的实现里，恢复时改回）。
		// 两个方向天然互斥，返回 "" / "end" / "start"。到期提醒（送达）也复用这一处判定。
		function dueKindOf(startTs, endTs, nowTs, withinHours) {
			const hours = Number(withinHours);
			if (!(hours > 0)) return "";
			if (typeof startTs !== "number" || typeof endTs !== "number") return "";
			if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || !Number.isFinite(nowTs)) return "";
			if (!(endTs > startTs)) return "";
			const horizon = hours * 3600000;
			// 2026-10-28：开始方向暂时停用 —— 解析器只产出"覆盖当前时刻"的窗口，startTs 永远 <= now，
			// 所以"即将开始"在真实数据里永远不命中。要恢复：把下一行改回
			// `if (startTs > nowTs) return startTs - nowTs <= horizon ? "start" : "";`
			if (startTs > nowTs) return "";
			if (!(endTs > nowTs)) return "";
			return endTs - nowTs <= horizon ? "end" : "";
		}

		// 「提醒」白名单的判定（普通列表语义）：列表里有 ⇒ 提醒；缺失 / 空数组 ⇒ 一个都不提醒。
		// 只给设置页与将来的到期送达用，轮播不调用它。
		function remindGameAllowed(gameId, remindGames) {
			if (!Array.isArray(remindGames)) return false;
			return remindGames.includes(gameId);
		}

		// 按钮轮播总开关的读取口径：只有明确的 false 才算关（老配置没有这个键 ⇒ 默认开）。
		// 设置页与按钮共用这一处，避免"设置页显示开着、按钮却没反应"。
		function tickerOnOf(v) {
			return v !== false;
		}

		// 配置值的**解包**口径（客户端镜像宿主 src/index.js 的 configValueOf，语义完全一致）。
		// 本插件的设置字段都标了 `.volatile()`：宿主交给 apply 的 `config.xxx` 不是裸值，而是
		// `{ get(), [Symbol.for("cosmokit.volatile.write")] }` 这样的**引用对象**。
		// 直接按裸值比较永远不成立（对象恒 truthy）而且**不报错** —— 设置页读配置也必须走这一处，
		// 否则换一个 DSH 版本就会静默把"显示 / 隐藏"判反。
		const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
		function configValueOf(raw) {
			if (raw && typeof raw === "object" && typeof raw.get === "function" && VOLATILE_WRITE in raw) {
				try {
					return raw.get();
				} catch {
					return void 0;
				}
			}
			return raw;
		}

		// 设置页标题行的 Star 指引是否显示：只有**解包后明确是 true** 才隐藏（用户点过 ✕）。
		// 缺失 / false / 脏值（"false"、0、null、{}…）一律显示 —— 与 DEFAULT_SETTINGS.starHintDismissed=false
		// 同口径。渲染层不自己写 `s.starHintDismissed === true`，否则 volatile 引用对象会被误判成"已关闭"。
		function starHintShownOf(raw) {
			return configValueOf(raw) !== true;
		}

		// 按钮轮播范围的读取口径：只接受正数小时，缺失 / 0 / 负数 / 非数字一律回落默认 72。
		// 归一放在这里，老配置残留的 0 才不会变成"设置页显示 72、按钮却没反应"。
		function tickerRangeOf(v) {
			const h = Number(v);
			return h > 0 ? h : DEFAULT_SETTINGS.tickerHours;
		}

		// 从候选里挑出该轮播的：按紧迫度升序（同刻保持输入顺序），每条补 kind 与 dueMs。
		// 候选由 80-components.js 的 tickerItemsOf 组装（已把落盘文本换成绝对窗口）；轮播不分游戏。
		function tickerPickOf(items, nowTs, tickerHours) {
			const hours = Number(tickerHours);
			if (!(hours > 0) || !Array.isArray(items)) return [];
			const out = [];
			for (const it of items) {
				if (!it) continue;
				const kind = dueKindOf(it.startTs, it.endTs, nowTs, hours);
				if (!kind) continue;
				out.push({ ...it, kind, dueMs: (kind === "end" ? it.endTs : it.startTs) - nowTs });
			}
			// Array.prototype.sort 自 ES2019 起保证稳定 ⇒ 同一毫秒的多条保持输入顺序（可复现）
			return out.sort((a, b) => a.dueMs - b.dueMs);
		}

		// 距离毫秒数 → 一句人话（只有数字 + 单位，标签由调用方加）。
		// 口径（2026-10-25 三次定稿，用户要求）：<1 小时说"分"、<1 天说"小时"、再往上**只说天数**
		// —— ≥1 天不再拼小时段（"3 天 4 小时" → "3 天"，侧栏这一行总共只有 ~12 个汉字宽）。
		// 向下取整（宁可说"3 小时"也不说"4 小时"）—— 侧栏这一行里**说少了**比说多了安全。
		function tickerSpanText(ms) {
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
		function tickerDayWord(ts, nowTs) {
			const a = new Date(ts), b = new Date(nowTs);
			if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return "";
			const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
			const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
			const diff = Math.round((dayA - dayB) / 86400000);
			if (diff <= 0) return "今天";
			if (diff === 1) return "明天";
			return diff + " 天后";
		}

		// 一条轮播条目 → 侧栏那一行的**两段文案**：{ name, status, text }。
		// 为什么拆两段而不是拼好一句交给 CSS 截断：`text-overflow:ellipsis` 截的是**尾巴**，
		// 而这里最不能丢的恰恰是尾巴（"还剩 3 小时 / 明天开池"）。所以渲染层把 name 单独放进
		// 可收缩 + 省略号的盒子、status 放进 flex:none 的盒子 —— 名字再长也只压名字。
		// 口径：
		//   · name = **事项名优先**（2026-10-25 二次定稿，用户 C 方案：「只有游戏名称没有角色/活动
		//     名称，信息不足」）—— 卡池侧给那一期的角色名、活动侧给活动名；**游戏身份交给图标**
		//     （gameIcon，见 tickerItemsOf / tickerSlidesOf），文字不再占宽度去写游戏名。
		//     回退顺序：事项名 title → 游戏名 name → id → "某个游戏"（自定义条目可能没有 title，
		//     绝不能显示 undefined）。
		//   · 结束（kind=end）→ status = "X"（X 由 tickerSpanText 给，两个方向都适用）——
		//     **按钮这一侧不带「还剩」**（2026-10-25 三次定稿，用户要求「· 还剩 8 小时」→「· 8 小时」）；
		//     读屏/悬停要的是完整句子，那里由 statusFull（补回「还剩」）单独拼，见 statusFull 的注释；
		//   · 开始（kind=start）→ status = "今天/明天/N 天后" + "开池"（卡池侧）/ "开始"（活动侧）。
		function tickerCaptionOf(item, nowTs) {
			const it = item || {};
			const name = String(it.title || it.name || it.gameId || "").trim() || "某个游戏";
			const isStart = it.kind === "start";
			const isG = it.side === "gacha";
			const status = isStart
				? tickerDayWord(Number(it.startTs), nowTs) + (isG ? "开池" : "开始")
				: tickerSpanText(Number(it.endTs) - nowTs);
			// 读屏 / 悬停（aria-label / title）用的**完整句子**：结束方向补回「还剩」，
			// 否则"耀嘉音 · 8 小时"念出来不通顺（用户 2026-10-25 明确要求这一处保留「还剩」）。
			// 这是唯一一处单独拼接 —— 按钮那一侧（status / text）不再带「还剩」。
			const statusFull = isStart ? status : "还剩 " + status;
			return { name, status, statusFull, text: name + " · " + status, ariaText: name + " · " + statusFull };
		}

		// 轮播的**每一格**（C 方案，2026-10-25 二次定稿）：整行连同图标一起竖向翻页。
		// 输入 = tickerPickOf 的输出（tickerItemsOf 已给每条补上 gameIcon）。
		// 输出一格一条：{ gameId, gameIcon, gameName, itemName, statusText, text, ariaText, kind }
		//   · gameId / gameIcon → 这一格左侧的图标（状态 i 用**该游戏自己的**图标）；
		//   · itemName + statusText → 文字两段（名字可截断、状态永不截断，见 tickerCaptionOf）；
		//   · gameName 只给悬停/读屏补一句"这是哪款游戏"（图标认得出来，文字里不占宽度）；
		//   · text = 完整一行（"名字 · 状态"，**按钮上显示的那一份**，不带「还剩」）；
		//   · ariaText = 同一行的**读屏版**（结束方向带「还剩」，念出来才是完整句子）；
		//     悬停/aria-label 用它，按钮渲染用 text —— 两处只有这一个词不同，其余同源。
		// ⚠️ 状态 0（"原按钮外观"：日历图标 + 「二游日历」）**不**在这里 —— 那是渲染层的事；
		//    本函数只负责"每格一条轮播条目"，所以没有可轮播的条目时返回 []（⇒ 只有状态 0、不滚动）。
		function tickerSlidesOf(items, nowTs) {
			if (!Array.isArray(items)) return [];
			return items.filter(Boolean).map((it) => {
				const cap = tickerCaptionOf(it, nowTs);
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

		// —— 轮播的**展开序列**与翻页方向（2026-10-25 三次定稿，纯函数）——
		// 用户要求（两条）：
		//   ① **交叉**：每两条轮播条目之间插回一次原按钮 —— 序列从 `[idle, 1, 2, 3, …]` 改成
		//      `[idle, 1, idle, 2, idle, 3, …]`（长度 = 2n）。n = 0 时只剩 idle、不滚动。
		//   ② **翻页方向**：四步一循环 上 → 下 → 下 → 上（不是"条目 up / 按钮 down"，所以相邻
		//      两格方向可以相同）。方向按**切换次数**算，与条目数无关。
		// 输入 = tickerSlidesOf 的输出（n 格轮播条目）；输出 = 展开后的格序列，每格：
		//   { idx, idle, slideIndex, dir }
		//     · idx        —— 展开后的格号（0 起）；渲染层拿它当 key / 记 prevStep；
		//     · idle       —— true = 原按钮外观那一格；false = 一条轮播条目；
		//     · slideIndex —— idle 时 -1，否则是它在 slides 里的下标；
		//     · dir        —— **第 idx 次切换**的翻页方向："up"（旧内容往上走、新内容从下方进）/
		//                     "down"（旧内容往下走、新内容从上方进）。
		//                     ⚠️ 这个字段是"把 idx 当切换序数"算出来的：格号每 2n 回卷一次，而方向规则
		//                     按切换次数走 4 步一循环，两者**只在首轮一致**。所以渲染层**不能**用
		//                     `stepAt(shownStep).dir` 取方向 —— 回卷到格 0 会拿到 tickerDirAt(0) 的
		//                     挂载兜底 down，四步循环每轮回卷丢一次相位（n = 2 时真机上就是
		//                     "连着三次都往下"）。渲染层取方向用 `tickerDirAt(单调切换序)`
		//                     （见 80-components.js 的 flipDir），本字段留给纯函数断言与推演。
		// 为什么单独一个纯函数：n = 0 只有 1 格、2n 长度、四步循环都必须能被固定断言，
		// 渲染层不自己算（算错了不报错，只在真机上看出来）。
		// 翻页方向：**上下下上** 四步一循环，每轮都从"上"开始（与条目数无关）。
		//   idx 0 = 首格（挂载时没有"进入"动作，用 down 兜底）
		//   idx 1 进条目1 = up / idx 2 回按钮 = down / idx 3 进条目2 = down / idx 4 回按钮 = up / idx 5 进条目3 = up …
		const TICKER_DIR_CYCLE = ["up", "down", "down", "up"];
		function tickerDirAt(idx) {
			if (!Number.isFinite(idx) || idx <= 0) return "down";
			return TICKER_DIR_CYCLE[(idx - 1) % 4];
		}
		function tickerStepsOf(slides) {
			const list = Array.isArray(slides) ? slides.filter(Boolean) : [];
			// n = 0：只有"原按钮"这一格（长度 1），渲染层据此完全不滚动
			if (list.length === 0) return [{ idx: 0, idle: true, slideIndex: -1, dir: "down" }];
			const out = [];
			for (let i = 0; i < list.length; i++) {
				// idle / 条目两格的方向都由 tickerDirAt(格号) 决定 —— 四步循环，
				// 不再固定成"idle 就 down、条目就 up"（那样永远只是交替）。
				out.push({ idx: out.length, idle: true, slideIndex: -1, dir: tickerDirAt(out.length) });
				out.push({ idx: out.length, idle: false, slideIndex: i, dir: tickerDirAt(out.length) });
			}
			return out;
		}

		// —— 翻页层里**两行的顺序**（2026-10-25 五次定稿，纯函数）——
		// 背景（用户 2026-10-25："还是不对，和向下翻的动画不一样"）：
		//   窗口 .gacha-cal-btn-txt 固定 22px、overflow:hidden；里面 .gacha-cal-btn-flip 叠着
		//   两行各 22px（共 44px），translateY(±50%) = ±22px 正好一行。
		//   **两层谁在第 1 行（DOM 里的第一个）决定了动画起点窗口里看见什么** ——
		//   而动画起点必须永远是"旧内容（prev）占满窗口"，否则一开场就是空白。
		//   两种方向的 keyframes / fill-mode 各用一套（见 styles/ticker.css）：
		//   · 向下翻 .is-down —— keyframes -50% → 0、fill-mode backwards（+1ms 延迟防重挂载闪跳）：
		//       第 1 行必须是 **cur**。起点 ty=-22px ⇒ 第 1 行 cur 落在窗口上方（看不见）、
		//       第 2 行 prev 占满窗口 [0,22]（旧内容在窗口里）；终点 ty=0 ⇒ cur 占满窗口。
		//       观感：旧行往下滑出、新行从**上方**进来。
		//   · 向上翻 .is-up —— keyframes 0 → -50%、fill-mode forwards：
		//       第 1 行必须是 **prev**。起点 ty=0 ⇒ 第 1 行 prev 正好占满窗口 [0,22]
		//       （旧内容在窗口里，**不是空白**）；终点 ty=-22px ⇒ prev 滑到窗口上方、
		//       第 2 行 cur 占满窗口（forwards 把 -50% 保持住）。
		//       观感：旧行往上滑出、新行从**下方**进来。
		// 旧实现两种方向都写死 [cur, prev]：向上翻时起点 ty=+22px ⇒ **两层都落在窗口下方**
		// ⇒ 一开场窗口里什么都没有（Playwright 探针实测到的空白 30~60ms），
		// 然后新行从上方滑进来 —— 于是"向上翻"和"向下翻"根本不是一个观感。这就是根因。
		// 所以**行顺序必须跟着方向换**；本函数是这条规则的唯一出处，渲染层不自己写三元。
		// 返回：DOM 顺序的两行 [{ step, slot }]；slot 只当 React 的 key（"cur"/"prev" 天然唯一）。
		// 脏输入（dir 不是 "up"）一律按 down —— 与 tickerDirAt 的挂载兜底同一个方向。
		function tickerFlipLinesOf(dir, curStep, prevStep) {
			const curLine = { step: curStep, slot: "cur" };
			const prevLine = { step: prevStep, slot: "prev" };
			return dir === "up" ? [prevLine, curLine] : [curLine, prevLine];
		}

		// —— 落定后**进 DOM 的行**（2026-10-25 六次定稿，纯函数）——
		// 为什么要有"落定"：向上翻用 fill-mode forwards 把终点 translateY(-50%) 保持住
		// （不保持的话动画一结束就会弹回 0、露出 prev 行），于是那 5 秒里翻页层带着一个
		// **持久的 transform**；向下翻结束时 transform 回到 none。两个方向的终点状态因此不对称
		// （用户 2026-10-25 明确要求抹平）。落定的做法 = 动画播完后把"forwards 保持住的终点画面"
		// 换成**等价的静态画面**：只渲染 cur 一行 + CSS 的 .is-settled{animation:none;transform:none}。
		//
		// 关键：落定时**必须只留 cur 一行**（prev 行连 DOM 都不该有）。只关动画、不删 prev 的话，
		// 层上还挂着两行 44px 的高度 —— 视觉上虽被窗口裁掉，但"终点 = 单行"这个事实就成了隐含约定，
		// 任何 padding/height 变动都会让它露出来。所以"哪些行进 DOM"提成本函数，四种组合
		// （settled × up/down）都能被静态断言钉住。
		//
		// 返回：DOM 顺序的行数组 [{ step, slot }]；settled 为真时恒为 [cur]（与方向无关）。
		// 脏输入（settled 是假值）一律按未落定处理 —— 与渲染层 `flipSettled === true` 的口径一致。
		function tickerFlipRenderLinesOf(dir, curStep, prevStep, settled) {
			if (settled) return [{ step: curStep, slot: "cur" }];
			return tickerFlipLinesOf(dir, curStep, prevStep);
		}
		//#endregion

		//#region 排期导出 .ics（待办第 5 项）
		//
		// 目标：点一下把**当前在期**的卡池与活动导出成一份 `.ics` 快照（可导入手机/电脑日历）。
		// ⚠️ 只能是**快照**、不能是订阅：网游排期是"一次性数据"，没有稳定的公开 iCal 源。
		//
		// 三层分工（改之前先读）：
		//   ① `icsEventsOf` —— 纯函数：条目 + 最近一轮抓取结果 + 当前时刻 ⇒ **在期事件**的结构化清单
		//      （uid / 标题 / 绝对起止）。"哪些条目算在期、哪些跳过"只在这一处判定。
		//   ② `icsOf` —— 纯函数：事件清单 + 生成时刻 ⇒ **逐字节确定**的 iCalendar 文本
		//      （RFC 5545：CRLF / 75 octets 折行 / 文本转义 / VCALENDAR 骨架）。
		//   ③ 渲染层（80-components.js）只负责 Blob + a[download]，**不新增宿主路由**
		//      （每多一条 HTTP 面就多一处鉴权/SSRF 要照顾，不值）。
		//
		// ── 时间口径（用户 2026-10-28 定的方向：源站墙钟 → 本机时区 → 输出 UTC）──
		//   源站原文（`bannerDates` / `eventDates`，例 "10-21 11:00 ~ 11-04 10:59"）
		//     → 拆成源站墙钟字段 { y, mo, d, h, mi }（`y` 缺省时用共用 `inferYear` 补，跨年走 `endsNextYear`）
		//     → `sourceInstant(...)`（15-env.js）换成**绝对毫秒** —— 与各解析器造 ts 用的是同一个函数，
		//        所以"导出的是什么时刻"和"面板倒计时算的是什么时刻"不会分叉；
		//     → `icsUtcStamp` 写成 `YYYYMMDDTHHMMSSZ`（UTC，`Z` 结尾）。
		//   ⇒ 文件里全是最稳的 UTC：导入后各机器/各时区显示一致，也不需要 VTIMEZONE。
		//   ⚠️ 条目**没声明 tz**（自定义条目）时 `sourceInstant` 沿用本机时区 —— 那时导出的绝对时刻
		//      依赖本机时区，但"面板按本机时区显示什么，就导出什么"，不自作聪明换一个猜法。
		//   ⚠️ 刻意**不走** `parseDisplayRange`：它的正则不接受 4 位年份，而跨年窗口的源站原文
		//      正是 `2026-12-30 11:00 ~ 2027-01-05 10:59` 这种形态（`fmtWindow` 的输出）。
		const ICS_PRODID = "-//dsh-gacha-calendar//gacha-calendar-ics-snapshot//ZH";
		// 一行物理行的上限（RFC 5545 3.1：内容行 SHOULD NOT 超过 75 octets，**不含** CRLF）。
		const ICS_LINE_OCTETS = 75;
		// UID 的域后缀：RFC 5545 要求 UID 全局唯一，`id:侧:起-止@域` 已足够（可复现、不随机）。
		const ICS_UID_DOMAIN = "@gacha-calendar";
		const ICS_SIDE_LABEL = { gacha: "卡池", event: "活动" };
		// 跳过的原因（给报告/用例看；**不导出**才是默认行为 —— 见 icsEventsOf）
		const ICS_SKIP_TEXT = {
			skipped: "本轮没抓（跳过）",
			"no-title": "没有事项名",
			"no-dates": "没有档期文本",
			"bad-window": "档期不是「起 ~ 止」形态",
			ended: "已结束",
			"not-started": "还没开始"
		};

		// now（Date 或毫秒）→ 毫秒。坏值 ⇒ 0（宁可导出"1970 生成"也不抛，导不出文件才是大问题）。
		function icsNowMsOf(now) {
			const n = now && typeof now.getTime === "function" ? now.getTime() : Number(now);
			return Number.isFinite(n) ? n : 0;
		}

		const icsPad2 = (n) => String(n).padStart(2, "0");

		// 绝对毫秒 → `YYYYMMDDTHHMMSSZ`（UTC）。坏值 ⇒ ""（调用方据此跳过该条）。
		// 只用 getUTC* ⇒ 与运行机器的时区无关（双时区门禁要求逐字节相同）。
		function icsUtcStamp(ts) {
			const n = Number(ts);
			if (!Number.isFinite(n)) return "";
			const d = new Date(n);
			if (!Number.isFinite(d.getTime())) return "";
			return String(d.getUTCFullYear()).padStart(4, "0") + icsPad2(d.getUTCMonth() + 1) + icsPad2(d.getUTCDate())
				+ "T" + icsPad2(d.getUTCHours()) + icsPad2(d.getUTCMinutes()) + icsPad2(d.getUTCSeconds()) + "Z";
		}

		// 绝对毫秒 → `YYYY-MM-DD HH:MM UTC`（DESCRIPTION 里那句"导出时间"用；同样是 UTC、与机器时区无关）。
		function icsUtcHuman(ts) {
			const s = icsUtcStamp(ts);
			if (!s) return "";
			return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8)
				+ " " + s.slice(9, 11) + ":" + s.slice(11, 13) + " UTC";
		}

		// iCalendar TEXT 转义（RFC 5545 3.3.11）：`\` → `\\`、`;` → `\;`、`,` → `\,`、换行 → `\n`。
		// ⚠️ 反斜杠**必须第一个**替换，否则后面补出来的 `\;` 会被再转义一次。
		function icsEscapeText(v) {
			return String(v == null ? "" : v)
				.replace(/\\/g, "\\\\")
				.replace(/;/g, "\\;")
				.replace(/,/g, "\\,")
				.replace(/\r\n|\r|\n/g, "\\n");
		}

		// 单个码点在 UTF-8 下的字节数（**按 octets 折行**用，不能按字符数：一行 25 个汉字就是 75 字节）。
		// 自己数而不用 TextEncoder：core 要能在任何 JS 运行时里跑，且这是纯算术、可逐字节断言。
		function icsUtf8Len(ch) {
			const cp = ch.codePointAt(0);
			if (cp < 0x80) return 1;
			if (cp < 0x800) return 2;
			if (cp < 0x10000) return 3;
			return 4;
		}

		// 一条**逻辑行** → 折行后的物理行（CRLF 分隔，续行以一个空格开头）。
		// 逐**码点**遍历（`for…of` 不会把代理对拆半），累计字节数超过 75 就折 —— 续行的那个空格
		// 本身也算 1 octet，所以续行内容的上限是 74 字节，整行仍是 ≤75 octets。
		function icsFoldLine(line) {
			const text = String(line == null ? "" : line);
			const parts = [];
			let cur = "";
			let bytes = 0;
			for (const ch of text) {
				const n = icsUtf8Len(ch);
				if (bytes + n > ICS_LINE_OCTETS) {
					parts.push(cur);
					cur = " ";
					bytes = 1;
				}
				cur += ch;
				bytes += n;
			}
			parts.push(cur);
			return parts.join("\r\n");
		}

		// 源站墙钟文本 + 源站 tz → 绝对窗口 { startTs, endTs }；读不出（"版本更新后 ~ …" / "长期" /
		// "MM-DD ~ MM-DD, MM-DD ~ MM-DD" 这种一段话）⇒ null，不硬凑一个猜测的时刻。
		// 兼容两种形态：`MM-DD HH:MM`（年份按 now 用共用 `inferYear` 补）与 `YYYY-MM-DD HH:MM`（照原文）。
		// ⚠️ 补年份 / 跨年判定**一律走 25-parser-shared.js 的共用实现**（`inferYear` / `endsNextYear`）：
		//    `test/cases-rule-lint.mjs` 有硬门禁，不许在这里再写一份内联的"结束早于开始 ⇒ 次年"。
		function icsWindowOf(text, tz, now) {
			const parts = String(text == null ? "" : text).split("~").map((x) => x.trim());
			if (parts.length < 2) return null;
			const nowDate = new Date(icsNowMsOf(now));
			const hint = { y: nowDate.getFullYear(), mo: nowDate.getMonth() + 1 };
			const parsePart = (s) => {
				const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
				if (ymd) {
					const p = { y: Number(ymd[1]), mo: Number(ymd[2]), d: Number(ymd[3]), h: ymd[4] ? Number(ymd[4]) : 0, mi: ymd[5] ? Number(ymd[5]) : 0, ymd: true };
					return p.mo >= 1 && p.mo <= 12 && p.d >= 1 && p.d <= 31 ? p : null;
				}
				const md = s.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
				if (!md) return null;
				const mo = Number(md[1]);
				const d = Number(md[2]);
				if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
				return { y: inferYear(null, mo, hint), mo, d, h: md[3] ? Number(md[3]) : 0, mi: md[4] ? Number(md[4]) : 0, ymd: false };
			};
			const a = parsePart(parts[0]);
			const b = parsePart(parts[1]);
			if (!a || !b || a.y == null || b.y == null) return null;
			// 跨年：只在**两端都没写年份**时补（源站自己跨年时会两端都带年份，那时照原文）。
			if (!a.ymd && !b.ymd && endsNextYear(a.mo, a.d, b.mo, b.d)) b.y = a.y + 1;
			// 唯一一处"源站墙钟 → 绝对时刻"的换算：与解析器造 ts 用的是同一个函数。
			const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
			const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
			if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return null;
			return { startTs, endTs };
		}

		// 条目 + 最近一轮抓取结果 + 当前时刻 ⇒ { events, skipped }（全是纯数据，可逐字断言）。
		//   entries —— 与面板同形的条目（`getAllEntries` / `getVisibleEntries` 的输出：内置条目 + 自定义条目）
		//   scraped —— lastData 解析出来的 { id: { banner, roles, bannerDates, event, eventDates, skipped… } }
		//   now     —— Date 或毫秒
		// 规则（"在期"只有这一处判定）：
		//   · 卡池侧标题 = 角色名（`cleanRoleNames`，与面板/轮播同口径）→ 没有角色名就退回卡池名；
		//     活动侧标题 = 活动名。两侧都拼成 `游戏名 · 事项名`。
		//   · 起止 = 源站原文 + 源站 tz → 绝对窗口（icsWindowOf）。
		//   · **覆盖当前时刻**才导出：已结束 / 还没开始都跳过（用户要求"已结束的条目不导出"；
		//     "还没开始"同理不属于"当前在期"，写进日历只会多一堆未来事件）。
		//   · `skipped`（条目两侧都没配来源 / 本轮被跳过）⇒ 跳过：它压根没有档期可写。
		//     不导出，也**不**当成"已结束"（那是两件不同的事，skipped 另记原因）。
		function icsEventsOf(entries, scraped, now) {
			const at = icsNowMsOf(now);
			const rec = scraped && typeof scraped === "object" ? scraped : {};
			const events = [];
			const skipped = [];
			for (const g of Array.isArray(entries) ? entries : []) {
				if (!g || typeof g !== "object") continue;
				const id = String(g.id || "");
				const name = String(g.name || id);
				const sc = rec[id] && typeof rec[id] === "object" ? rec[id] : null;
				const skip = (side, reason) => skipped.push({ gameId: id, side, reason, text: ICS_SKIP_TEXT[reason] || reason });
				if (sc && sc.skipped === true) { skip("", "skipped"); continue; }
				const val = (k) => {
					const v = (sc && sc[k]) || g[k];
					return typeof v === "string" ? v : "";
				};
				for (const side of ["gacha", "event"]) {
					const isG = side === "gacha";
					const title = isG
						? (cleanRoleNames(val("roles"), id) || val("banner"))
						: val("event");
					const dates = isG ? val("bannerDates") : val("eventDates");
					if (!title) { skip(side, "no-title"); continue; }
					if (!dates) { skip(side, "no-dates"); continue; }
					const w = icsWindowOf(dates, g.tz || null, at);
					if (!w || !(w.endTs > w.startTs)) { skip(side, "bad-window"); continue; }
					if (at > w.endTs) { skip(side, "ended"); continue; }
					if (at < w.startTs) { skip(side, "not-started"); continue; }
					events.push({
						// 稳定且唯一：条目 id + 侧 + 起止时间戳（同一份数据重复导入 ⇒ 同一个 UID，日历不会重复）
						uid: id + ":" + side + ":" + w.startTs + "-" + w.endTs + ICS_UID_DOMAIN,
						summary: name + " · " + title,
						side,
						gameId: id,
						// 来源站名（卡池看 source / 活动看 eventSource）→ DESCRIPTION 那句来源说明用
						source: isG ? val("source") : val("eventSource"),
						startTs: w.startTs,
						endTs: w.endTs
					});
				}
			}
			return { events, skipped };
		}

		// 没有 uid 的事件（外部直接调 icsOf 时）→ 从标题 + 起止推一个**稳定**的 UID（FNV-1a，不随机）。
		function icsFallbackUidOf(ev, start, end) {
			const key = String((ev && ev.summary) || "") + "|" + start + "|" + end;
			let h = 0x811c9dc5;
			for (let i = 0; i < key.length; i++) {
				h ^= key.charCodeAt(i);
				h = Math.imul(h, 0x01000193) >>> 0;
			}
			return "ics-" + h.toString(16) + "-" + start + "-" + end + ICS_UID_DOMAIN;
		}

		// DESCRIPTION 的默认内容：一句话（来源站名 + 侧 + 生成时间），**不塞**悬停那种长文案。
		function icsDescOf(ev, genText) {
			const site = String((ev && ev.source) || "").trim() || "各游戏官方/维基来源";
			const side = ev && ev.side ? (ICS_SIDE_LABEL[ev.side] || "") : "";
			return "来源：" + site + (side ? " · " + side : "") + " · 导出 " + genText;
		}

		// 事件清单 + 生成时刻 ⇒ iCalendar 文本（确定性：同样输入逐字节相同；不读时钟、不读时区）。
		//   events      [{ uid?, summary, startTs, endTs, description?, source?, side? }]
		//   generatedAt 生成时刻（毫秒）—— DTSTAMP 与 DESCRIPTION 里的"导出时间"都用它
		//   opts        { calName }（X-WR-CALNAME，默认「二游日历」）
		// 骨架：BEGIN:VCALENDAR / VERSION:2.0 / PRODID / CALSCALE:GREGORIAN / X-WR-CALNAME / … / END:VCALENDAR
		// 每行都折到 ≤75 octets，行间一律 CRLF（`\n` 会让部分日历直接不认）。
		function icsOf(events, generatedAt, opts) {
			const o = opts && typeof opts === "object" ? opts : {};
			const gen = icsUtcStamp(generatedAt) || "19700101T000000Z";
			const genText = icsUtcHuman(generatedAt) || "1970-01-01 00:00 UTC";
			const lines = [
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"PRODID:" + ICS_PRODID,
				"CALSCALE:GREGORIAN",
				"X-WR-CALNAME:" + icsEscapeText(o.calName || "二游日历")
			];
			for (const ev of Array.isArray(events) ? events : []) {
				if (!ev) continue;
				const start = icsUtcStamp(ev.startTs);
				const end = icsUtcStamp(ev.endTs);
				if (!start || !end) continue;   // 坏条目直接跳过：绝不产出半截 VEVENT
				const summary = String(ev.summary || "").trim() || "二游日历";
				lines.push("BEGIN:VEVENT");
				lines.push("UID:" + icsEscapeText(String(ev.uid || "") || icsFallbackUidOf(ev, start, end)));
				lines.push("DTSTAMP:" + gen);
				lines.push("DTSTART:" + start);
				lines.push("DTEND:" + end);
				lines.push("SUMMARY:" + icsEscapeText(summary));
				lines.push("DESCRIPTION:" + icsEscapeText(String(ev.description || "").trim() || icsDescOf(ev, genText)));
				lines.push("END:VEVENT");
			}
			lines.push("END:VCALENDAR");
			return lines.map(icsFoldLine).join("\r\n") + "\r\n";
		}

		// 下载文件名（带日期）：`二游日历-2026-10-28.ics`。日期用**本机**日历日（用户看到的就是今天）。
		// 拿不到合法时刻 ⇒ 退回不带日期的名字（绝不产出 `-NaN-NaN-NaN`）。
		function icsFileNameOf(now) {
			const raw = now && typeof now.getTime === "function" ? now.getTime() : Number(now);
			if (!Number.isFinite(raw)) return "二游日历.ics";
			const d = new Date(raw);
			if (!Number.isFinite(d.getTime())) return "二游日历.ics";
			return "二游日历-" + d.getFullYear() + "-" + icsPad2(d.getMonth() + 1) + "-" + icsPad2(d.getDate()) + ".ics";
		}
		//#endregion
		//#endregion
