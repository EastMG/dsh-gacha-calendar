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
		// opts = { entries: [{ id, name }]（**展示中**的条目，决定范围与顺序）, nomatchDays }。
		// 返回 [{ id, name, known, state, failStreak, nomatchDays, nomatchMs, lastOkAt, items, error, text }]
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
				const agoText = okAt > 0 && at > okAt ? "最近成功 " + tickerSpanText(at - okAt) + "前" : "从未成功";
				const parts = [];
				if (state === "down") parts.push("连续失败 " + failStreak + " 次");
				// "连续 N 天"：N 一律用**实际跨度**（向下取整），不用阈值字面量 —— 否则 9 天会说成 7 天。
				if (state === "stale" || state === "never") parts.push("连续 " + (nomatchDays || days) + " 天没解析出内容");
				parts.push(agoText);
				if (state === "down" && rec && rec.error) parts.push(String(rec.error));
				if (state === "stale" || state === "never") parts.push("疑似改版或停更");
				return {
					id,
					name,
					known: !!rec,
					state,
					failStreak,
					nomatchDays,
					nomatchMs,
					lastOkAt: okAt,
					items,
					error: rec && rec.error ? String(rec.error) : "",
					text: parts.join(" · ")
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
		//   两种方向的 keyframes / fill-mode 各用一套（见 70-styles.js）：
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
		//#endregion
