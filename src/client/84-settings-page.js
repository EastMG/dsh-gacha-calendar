		// ── 通知身份（可选）：宿主路由 /api/gacha-calendar-notify-identity ──────────────────────
		// GET = 读状态（是否已启用 + 快捷方式路径 + 预留的图标路径）；POST { enabled } = 建 / 删开始菜单
		// 快捷方式。⚠️ 每次调用宿主都要起一次 PowerShell 去读写 .lnk（0.3~1s），所以只在设置页挂载时读
		// 一次、点完再读一次，不做轮询。失败原因原样显示在按钮下面那行小字里（不弹窗）。
		const NOTIFY_IDENTITY_API = "/api/gacha-calendar-notify-identity";
		// 宿主错误码 → 人话；认不出来就原样显示（不吞掉 —— 用户要能看出到底为什么失败）
		const notifyIdentityErrorText = (code) => {
			const text = String(code || "").trim();
			if (text === "windows-only") return "仅 Windows 可用";
			if (text === "loopback-only") return "只能在本机 DSH 里操作";
			if (text === "cross-site-not-allowed") return "跨站请求被拒绝";
			if (text === "payload-too-large") return "请求内容过大";
			if (text === "invalid-json" || text === "enabled-must-be-boolean") return "请求格式不对";
			// 改名时目标位置已经有一条**不属于本插件**的同名快捷方式：宿主拒绝覆盖（见启用脚本 ①）
			if (text === "shortcut-name-taken") return "这个名字已被开始菜单里另一条快捷方式占用，换个名字";
			return text || "未知错误";
		};
		async function readNotifyIdentity() {
			const res = await fetch(NOTIFY_IDENTITY_API, { headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("HTTP " + res.status);
			const body = await res.json();
			if (!body || typeof body.enabled !== "boolean") throw new Error("返回格式不对");
			return body;
		}
		// 宿主回的 { enabled, name } → 设置页本地状态。name 一律再过一遍 notifyNameOf（默认「二游日历」）：
		// 宿主已经清洗过，这里只是防御 —— 名字会显示给用户，不能出现空串 / undefined。
		const notifyIdentityOfBody = (body) => ({
			enabled: !!(body && body.enabled === true),
			name: notifyNameOf(body && body.name)
		});
		async function writeNotifyIdentity(enabled, name) {
			const res = await fetch(NOTIFY_IDENTITY_API, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				// name 每次都带：启用时宿主要拿它给快捷方式起名 / 写 DisplayName；
				// 已启用状态下改名（enabled=true + 新 name）时宿主会**先删旧 .lnk 再按新名字重建**。
				body: JSON.stringify({ enabled: enabled === true, name: notifyNameOf(name) })
			});
			let body = null;
			try { body = await res.json(); } catch { body = null; }
			if (!body || body.ok !== true) {
				throw new Error(notifyIdentityErrorText(body && body.error) || ("HTTP " + res.status));
			}
			return body;
		}

		// ── 「发送测试通知」：宿主路由 /api/gacha-calendar-notify-test ─────────────────────────
		// 点一下立刻弹一条系统通知（发送者 = 上面那一行当前身份），用来确认通知链路通不通。
		// 只发一次、不轮询；失败原因复用上面那份错误码 → 人话的映射（同一套宿主错误码）。
		const NOTIFY_TEST_API = "/api/gacha-calendar-notify-test";
		async function sendNotifyTest() {
			const res = await fetch(NOTIFY_TEST_API, { method: "POST" });
			let body = null;
			try { body = await res.json(); } catch { body = null; }
			if (!body || body.ok !== true) throw new Error(String((body && body.error) || ("HTTP " + res.status)));
			return body;
		}

		// engine：core 引擎（设置页的「解析器自检」用它跑 selfCheck()）
		function CalendarSettingsPage({ scope, engine }) {
			// 设置表单服务本体（用于在写不进去时列出宿主真正 serve 的 namespace，见 formStateText）
			const ctxConfigForms = scope && scope.configForms ? scope.configForms : null;
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [adding, setAdding] = (0, react.useState)(false);
			// 添加表单临时值（名称/图标手动填；卡池与活动内容由链接解析产出）
			const [form, setForm] = (0, react.useState)({ name: "", icon: "", url: "", eventUrl: "", color: "" });
			// 取色器的**本地草稿**（{ id: "#rrggbb" }）：写入是异步的，而 `s`（设置快照）在本次会话里
			// 不会即时推新 ⇒ 受控 input 会立刻用旧值重渲染 ⇒ 用户看到"调完自己变回去"（2026-10-16 反馈）。
			// 用草稿值显示即可消除该现象；落盘仍走 setGameColor → commit（实测 store 里是对的）。
			const [colorDraft, setColorDraft] = (0, react.useState)({});
			// 「展示」复选框的本地草稿（{ id: boolean }）：同样的原因 —— 受控 checked 读 `s`，
			// 而 `s` 在本次会话里不即时推新 ⇒ 点一下立刻被旧值覆盖回去（用户看到的"完全点不了"）。
			const [showDraft, setShowDraft] = (0, react.useState)({});
			// 「展示」写入的**串行链**（见下面 setEntryShown）：连点时后一笔等前一笔落盘后再算，
			// 保证终态 = 最后一次点击的目标状态，而不是两笔写入互相覆盖（宿主往返 1.4~3.6s）。
			const showWriteChain = (0, react.useRef)(Promise.resolve());
			// 「提醒」复选框的本地草稿与串行链（与「展示」同一套理由：写入往返期间受控值会读旧 `s`）。
			const [remindDraft, setRemindDraft] = (0, react.useState)({});
			const remindWriteChain = (0, react.useRef)(Promise.resolve());
			// 「到期提醒」档位**胶囊**的本地草稿（{ end, start }，null = 跟随已保存的设置值）。
			// 实际只渲染「结束」一行（`remindChipRow("start", ...)` 于 2026-10-28 起注释掉），
			// 但草稿结构与「全部取消」仍维护 start 那份 —— 恢复显示时不必再补状态。
			// 受控值读草稿而不读 `s`：宿主一次写入往返 1.4~3.6s，`s` 不会即时推新 ——
			// 直接读 `s` 会把用户刚点的那一下吞掉（与上面「展示」草稿同一个病）。
			const [remindNodesDraft, setRemindNodesDraft] = (0, react.useState)({ end: null, start: null });
			// 标题行 Star 指引的本地「已关闭」标记：点 ✕ 的**当拍**就隐藏（宿主一次写入往返
			// 1.4~3.6s，直接等 `s.starHintDismissed` 推新会有一段时间"点了没反应"）。
			// 持久化仍走 commit("starHintDismissed", true)，重启后由已保存的配置继续隐藏。
			const [starHintDismissedDraft, setStarHintDismissedDraft] = (0, react.useState)(false);
			const [customInputs, setCustomInputs] = (0, react.useState)({});
			const [eventCustomInputs, setEventCustomInputs] = (0, react.useState)({});
			// 解析器自检（只读）：运行中标记 + 上一次的报告
			const [selfChecking, setSelfChecking] = (0, react.useState)(false);
			const [selfReport, setSelfReport] = (0, react.useState)(null);
			// 「来源健康」的展开开关：默认**收起**（只列异常项；用户抱怨过设置页太长）。
			const [healthAll, setHealthAll] = (0, react.useState)(false);
			// 游戏列表的搜索词 + 「只看已启用」（待办第 4 项）：**临时 UI 状态、一律不落盘**。
			// 理由：搜索词是"找一下就走"的东西，落盘会让下次打开设置页莫名其妙只剩几行；
			// 「只看已启用」同理（它是当次翻找的辅助，不是偏好，也没有对应用户可解释的设置项）。
			// 两者都只是 `settingsGamesFilter` 的入参 —— 不改排序、不改显隐、不写任何配置键。
			const [gameQuery, setGameQuery] = (0, react.useState)("");
			const [onlyShown, setOnlyShown] = (0, react.useState)(false);
			// 排期导出 .ics（待办第 5 项）的一行结果：`已导出 N 条（跳过 M 条）` / 失败原因。
			// 只在本页存活，不落盘（导出结果没有可解释的设置项）。
			const [icsNote, setIcsNote] = (0, react.useState)("");
			// 逐个来源跑一遍，报告「解析出 0 条 / 抓取报错」；不改动设置与缓存
			const runSelfCheck = async () => {
				if (selfChecking) return;
				setSelfChecking(true);
				try {
					const started = Date.now();
					const report = await engine.selfCheck();
					setSelfReport({ ...report, elapsedMs: Date.now() - started });
				} catch (err) {
					setSelfReport({ error: String((err && err.message) || err) });
				} finally {
					setSelfChecking(false);
				}
			};
			// ── 排期导出 .ics（待办第 5 项）：一次性**快照**，不是订阅 ──────────────────
			// 数据 = 与面板同一条链：**展示中**条目（getVisibleEntries + 用户排序）+
			// lastData 里那一轮的 banner / roles / bannerDates / event / eventDates。
			// 「哪些算在期、哪些跳过」全在纯函数 icsEventsOf；文本格式（CRLF / 折行 / 转义）全在 icsOf；
			// 这里只做三件事：取数据 → 拼文本 → Blob 下载（不新增宿主路由）。
			const exportIcs = () => {
				const now = new Date();
				try {
					const scraped = parseJsonStr(s.lastData, {});
					const result = icsEventsOf(applyOrder(getVisibleEntries(s), s.order), scraped, now);
					const text = icsOf(result.events, now.getTime(), { calName: "二游日历" });
					const saved = downloadTextFile(icsFileNameOf(now), text, "text/calendar");
					if (!saved) { setIcsNote("导出失败：浏览器不允许下载"); return; }
					const skippedNote = result.skipped.length ? "（跳过 " + result.skipped.length + " 条）" : "";
					setIcsNote(result.events.length
						? "已导出 " + result.events.length + " 条" + skippedNote
						: "当前没有在期条目" + skippedNote);
				} catch (err) {
					setIcsNote("导出失败：" + String((err && err.message) || err));
				}
			};
			// 数据源 = 宿主 configForms 表单的**订阅**（T1）。scope 就是 dsh-client-ui-settings 的
			// ConfigFormController：getSnapshot / subscribe / set / unset / mutate 都在它上面，
			// 而 subscribe 挂在它的 snapshot store 上，写入成功会经
			// mutate → mirror.acceptView → derive → store.set 同步通知到我们（源码证据见报告 T1）。
			// ⇒ 不再需要"每次 commit 里手写重读快照"：那是同一个 store 的另一种读法，
			//    却要在每次写入后多渲染一次整页（拖色时每帧一次），而且只能覆盖本组件发起的写入。
			// 订阅时补读一次，覆盖"首次渲染 → effect 订阅"之间可能落下的一次变更
			//（快照引用未变时 React 直接跳过，不会多一次渲染）。
			(0, react.useEffect)(() => {
				setSnapshot(scope.getSnapshot());
				return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
			}, [scope]);
			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };
			// 标题行 Star 指引是否显示：已保存的配置（经 60-helpers.js 的 starHintShownOf 解包
			// volatile 引用）+ 当拍草稿。只认"明确 true = 已关闭"；缺失 / 脏值一律显示。
			const starHintShown = starHintShownOf(s.starHintDismissed) && !starHintDismissedDraft;
			// 表单可用性（写不进去时在页面上如实说明，见下面渲染处）。
			// 文案与 formRejectHint 同源：只解释"为什么写不了"，不猜。
			const formReady = snapshot.status === "ready" && snapshot.mode !== "memory";
			const formStateText = snapshot.mode === "memory"
				? "本次连接不是本机，宿主不接受写入"
				: snapshot.status === "loading"
					? "配置表单还没送到，请稍后重试"
					: snapshot.status === "unavailable"
						? "宿主未 serve 条目「" + (scope.entryId || "?") + "」" + servedNamespacesText(ctxConfigForms)
						: "宿主拒绝了写入（表单状态 " + String(snapshot.status) + "）";

			const allEntries = getAllEntries(s);
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			const shown = Array.isArray(s.shown) ? s.shown : [];
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const urls = parseJsonStr(s.customUrls, {});
			const customs = parseJsonStr(s.customEntries, []);

			const order = Array.isArray(s.order) && s.order.length > 0 ? s.order : allEntries.map((x) => x.id);
			// ordered = **全量**条目按用户排序（上移/下移的真实边界用它算）；
			// sorted = 搜索/筛选后要渲染的行（见下面 shownNow 之后的 settingsGamesFilter）。
			const ordered = applyOrder(allEntries, order);
			// ── 来源健康（待办第 3 项「解析器自检」卡片的内容，不是并列的第二块）──────────────
			// 数据 = 引擎每轮刷新写回的 `sourceHealth` 存档（与 lastData 并列但**独立**的一个键）。
			// 这里只做"读存档 → 纯函数折算成每源状态"，**渲染路径不做任何 IO**（不 fetch、不读文件）。
			// 范围 = **展示中**的条目（与刷新 / 自检同一口径）：隐藏条目本轮不抓，记录会僵在隐藏前
			// 那一刻，把它们列出来只会误导。now 取渲染时刻 —— "X 前"不需要秒级精度，任意一次
			// 设置写入 / 刷新推送都会重算这一块。
			// lastRefreshAt = 本机最近一轮刷新时间（引擎每轮必写的那笔 lastRefresh，与 sourceHealth
			// 是否被跳过无关 ⇒ 它是"最近一次真的刷过"的可靠下界）。交给纯函数做显示侧补偿：健康存档
			// 在"状态没变"的轮次被跳过写入（见 60-helpers.js 的 sourceHealthSameOf），
			// 不补偿的话全部源稳定时这里会显示"最近成功 30 天前"。
			const healthRows = sourceHealthOf(
				parseSourceHealth(s.sourceHealth).sources,
				Date.now(),
				{
					entries: applyOrder(getVisibleEntries(s), order).map((g) => ({ id: g.id, name: g.name || g.id })),
					lastRefreshAt: Number(s.lastRefresh) || 0
				}
			);
			// known = 有过记录（从没刷过 / 旧版本升上来的老存档没有记录）。**注意**：没有记录
			// 不再等于"整块不渲染"（那正是用户看不到这个功能的原因）—— 卡片改由一句空状态兜住，
			// 见下面 JSX 里 healthKnown.length === 0 那一支。
			const healthKnown = healthRows.filter((h) => h.known);
			const healthBad = healthKnown.filter((h) => h.state !== "ok");
			// 自检报告一行结论要用的两个数：来源数（条目的两侧都算，未配置也算一个来源）、
			// "没内容"的来源数（无匹配/未公布 + 失败；未配置是合法状态，不算）。summary 是
			// core 的 selfCheck() 给的；error 那一支没有 summary，给 0 兜住。
			const selfSources = selfReport && selfReport.summary
				? selfReport.summary.ok + selfReport.summary.nomatch + selfReport.summary.unconfigured + selfReport.summary.down
				: 0;
			const selfBad = selfReport && selfReport.summary
				? selfReport.summary.nomatch + selfReport.summary.down
				: 0;
			const currentMinutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
			// 旧配置可能存了分钟值（不在按天选项里），额外补一个"自定义"选项避免 select 空白
			const inOptions = REFRESH_OPTIONS.some((o) => o.minutes === currentMinutes);
			// 按钮轮播的两个控件：开关 tickerOn（默认开）+ 范围 tickerHours（提前多久算"要来了"）。
			// 老配置残留的 0 由 tickerRangeOf 归一到 72，下拉里不会冒出「自定义（0 小时）」。
			const currentTicker = tickerRangeOf(s.tickerHours);
			const tickerInOptions = TICKER_OPTIONS.some((o) => o.hours === currentTicker);
			// 总开关的当前值：缺省 = 开（与 DEFAULT_SETTINGS / schema 的 default(true) 同口径，
			// 判定走 helpers 的 tickerOnOf，与侧栏按钮那一侧共用同一处口径）
			const tickerOn = tickerOnOf(s.tickerOn);
			// 「到期提醒（送达）」总开关：同样"只有明确 false 才算关"（65-remind.js 的 remindOnOf）。
			const remindOn = remindOnOf(s.remindOn);
			// 通知身份（可选）的本地状态：null = 还在读；{ enabled, name } = 宿主给的真相。
			// 只影响通知横幅顶部的应用名，与「提醒」开关无关（关掉身份也照样弹，名字退回 PowerShell）。
			const [notifyIdentity, setNotifyIdentity] = (0, react.useState)(null);
			const [notifyIdentityBusy, setNotifyIdentityBusy] = (0, react.useState)(false);
			const [notifyIdentityError, setNotifyIdentityError] = (0, react.useState)("");
			// 应用名（`notifyName`）输入框的**本地草稿**：null = 跟随已保存的设置值。
			// 受控值读草稿而不是读 `s`：宿主一次写入往返 1.4~3.6s，`s` 不会即时推新 —— 直接读 `s`
			// 会在用户打字期间把内容顶回去（与上面「展示」「提醒」的草稿同一个病）。
			const [notifyNameDraft, setNotifyNameDraft] = (0, react.useState)(null);
			const notifyNameSaved = notifyNameOf(s.notifyName);
			const notifyNameShown = notifyNameDraft === null ? notifyNameSaved : notifyNameDraft;
			// 挂载时读一次（不轮询）。宿主的 GET **先读 identity.json（毫秒级）**：有缓存就直接回，
			// 没有缓存也会**立刻**回一个保守值（未启用 + 配置名），同时在后台探一次并写回
			// ⇒ 设置页不会卡「读取中…」，也不会等 PowerShell。拿到保守值时显示「PowerShell（默认）」，
			// 那对"真的没启用"是正确文案；用户在后台探测写完之后的下一次 GET（点「发送测试通知」/重新挂载）
			// 就会看到准确值（见下面 refreshNotifyIdentity）。
			// 读失败按"未启用"显示 + 小字说明原因，不挡住页面其它部分 —— 身份只是一个 App 名，坏了不该让设置页变红。
			(0, react.useEffect)(() => {
				let alive = true;
				readNotifyIdentity()
					.then((body) => { if (alive) setNotifyIdentity(notifyIdentityOfBody(body)); })
					.catch((err) => {
						if (!alive) return;
						setNotifyIdentity({ enabled: false, name: notifyNameSaved });
						setNotifyIdentityError("读取失败：" + notifyIdentityErrorText((err && err.message) || err));
					});
				return () => { alive = false; };
			}, []);
			// 重新读一次身份并更新显示（GET 毫秒级；失败就保持原显示，不打扰用户）。
			// 为什么需要它：第一次 GET 可能拿到的是**保守值**（宿主当时还没有 identity.json，探测在后台跑）。
			// 用户点「发送测试通知」时顺手再读一次 ⇒ 后台探测早已写回 ⇒ 那一行从「PowerShell（默认）」
			// 自动变成准确值（例如「二游日历」），不会出现"读到保守值就一直不更新"。
			const refreshNotifyIdentity = async () => {
				try {
					const body = await readNotifyIdentity();
					setNotifyIdentity(notifyIdentityOfBody(body));
					return true;
				} catch {
					return false;
				}
			};
			// 点按钮：取反 → POST（带上当前名字）→ 用宿主回读的 enabled 刷新显示（不是乐观假设"点成功了"）。
			// 失败时把原因写进行尾那行小字，并再读一次真实状态（例如"启用成功但回读不一致"这类半成功）。
			const toggleNotifyIdentity = async () => {
				if (notifyIdentityBusy) return;
				const target = !(notifyIdentity && notifyIdentity.enabled);
				setNotifyIdentityBusy(true);
				setNotifyIdentityError("");
				try {
					const body = await writeNotifyIdentity(target, notifyNameShown);
					setNotifyIdentity(notifyIdentityOfBody(body));
				} catch (err) {
					setNotifyIdentityError((target ? "启用失败：" : "移除失败：") + notifyIdentityErrorText((err && err.message) || err));
					try {
						const body = await readNotifyIdentity();
						setNotifyIdentity(notifyIdentityOfBody(body));
					} catch { /* 读不到就维持原显示 */ }
				} finally {
					setNotifyIdentityBusy(false);
				}
			};
			// 「发送测试通知」：点了立刻 POST 一次；成功 = 显示发送者（与正文同一套身份名），
			// 失败 = 原因。不弹窗、不轮询、不落任何状态（测试通知与真实提醒完全隔离）。
			// 发完之后**顺手再 GET 一次身份**（refreshNotifyIdentity）：这条 POST 在"没有 identity.json"时
			// 会真探测一次并写回缓存 ⇒ 紧接着的 GET 就拿到准确值，把「PowerShell（默认）」换成真实身份。
			const [notifyTest, setNotifyTest] = (0, react.useState)(null);
			const [notifyTestBusy, setNotifyTestBusy] = (0, react.useState)(false);
			const sendTestNotify = async () => {
				if (notifyTestBusy) return;
				setNotifyTestBusy(true);
				setNotifyTest(null);
				try {
					const body = await sendNotifyTest();
					setNotifyTest({ ok: true, text: "" });
					await refreshNotifyIdentity();
				} catch (err) {
					setNotifyTest({ ok: false, text: "发送失败：" + notifyIdentityErrorText((err && err.message) || err) });
				} finally {
					setNotifyTestBusy(false);
				}
			};

			// 保存失败必须可见：旧实现只 await 不 catch，写被宿主拒绝时控件弹回原值、
			// 用户只会觉得"点了没反应"（「重置排序」写 null 被拒就是这种病的极端例子）
			//
			// DSH 0.1.7 起这里多了一个坑：`configForms` 的 set() **返回布尔值而不是抛错**
			// （旧 settingsScope 的 set() 失败会抛）。所以只写 try/catch 的话，
			// "宿主拒绝写入"会被当成成功，控件照样弹回、依旧没有任何提示。
			// 必须显式判返回值：false = 宿主没接受（多半是该字段没进表单 / 修订号冲突 / 页面只读）。
			//
			// 根修（2026-10-16，第二次）：写入后**不再**手写 `setSnapshot(scope.getSnapshot())` ——
			// 受控值的数据源改成上面的 scope.subscribe（订阅推送，写法见该 effect 的注释）。
			// 返回值改成"是否被宿主接受"，供取色器节流（任务 2）判断要不要把值放回待写队列。
			const [saveError, setSaveError] = (0, react.useState)("");
			const commit = async (key, value) => {
				try {
					const accepted = await scope.set(key, value);
					if (accepted === false) throw new Error(formRejectHint(scope, key));
					setSaveError("");
					return true;
				} catch (err) {
					setSaveError("\u4FDD\u5B58\u5931\u8D25\uFF1A" + String((err && err.message) || err || "未知错误"));
					return false;
				}
			};

			// 点标题行右侧的 ✕：先当拍隐藏（同一个渲染周期里整块消失），再落盘 `starHintDismissed: true`。
			// 落盘失败时下面会显示 saveError；本会话**不再**弹回来 —— 用户意图明确，不跟写入延迟打架。
			const dismissStarHint = () => {
				setStarHintDismissedDraft(true);
				void commit("starHintDismissed", true);
			};

			// 应用名提交（失焦 / 回车）：空 ⇒ 默认「二游日历」；非法文件名字符与超长由 notifyNameOf 收干净
			// （与宿主同一个函数，所以"设置页看到的"和"落到系统里的"不会分叉）。
			//
			// 顺序是**先重建、后写配置**：已启用身份时宿主的 POST 会先删掉旧名字的 .lnk 再按新名字建，
			// 建成功才写 `notifyName`。反过来（先写配置）在"名字被别人的快捷方式占用"时会留下
			// 「配置叫新名字、系统里却没有对应快捷方式」的坏状态，用户只看到名字改了、通知还是 PowerShell。
			const commitNotifyName = async () => {
				if (notifyIdentityBusy) return;
				const next = notifyNameOf(notifyNameDraft === null ? notifyNameSaved : notifyNameDraft);
				setNotifyNameDraft(null);
				if (next === notifyNameSaved) return;                 // 没变：不写设置、不重建快捷方式
				if (notifyIdentity && notifyIdentity.enabled) {
					setNotifyIdentityBusy(true);
					setNotifyIdentityError("");
					try {
						const body = await writeNotifyIdentity(true, next);
						setNotifyIdentity(notifyIdentityOfBody(body));
					} catch (err) {
						setNotifyIdentityError("改名失败：" + notifyIdentityErrorText((err && err.message) || err));
						setNotifyNameDraft(next);                     // 保留用户输入：可以重试 / 换个名字
						return;
					} finally {
						setNotifyIdentityBusy(false);
					}
				}
				await commit("notifyName", next);
			};

			// 「提醒」节点档位**胶囊**（2026-10-28：文本框 / "解析为" 预览 / 红框提示全部删掉）。
			// 点一下 = 立刻把**归一化后的整串**写回（降序、逗号分隔、无空格）。
			// 切换与归一化全走 65-remind.js 的 remindNodesToggleOf（内部就是判定侧的 remindNodesOf，
			// 同一口径，不在这边另写一份解析）。
			// 全部点掉 ⇒ 写**空串**（= 该方向不提醒）；判定侧把显式空串读成空档、**不**回落默认。
			//
			// 为什么要草稿 + 串行链（与上面「展示」的 setEntryShown 同一套理由）：
			//   · 宿主一次写入往返 1.4~3.6s，`s` 不会即时推新 ⇒ 受控值读草稿，点击立刻反映在胶囊上；
			//   · 连点两下时两笔写入排成一条链，保证"最后一次点击"最后落盘，
			//     不会因为两次 set 快慢颠倒而回退。
			//   ⚠️ 目标文本在**点击时**就算好再入链（不是入链后读快照重算）：胶囊是"切换"语义，
			//      若等落盘后拿旧快照重算，往返窗口内的第二下会以旧值为基准 ⇒ 第一下被吞掉。
			const remindNodesWriteChain = (0, react.useRef)(Promise.resolve());
			const toggleRemindNode = (which, keyName, savedText, fallbackNodes, node) => {
				const base = remindNodesDraft[which] === null ? String(savedText || "") : remindNodesDraft[which];
				const text = remindNodesToggleOf(base, node, fallbackNodes);
				setRemindNodesDraft((p) => ({ ...p, [which]: text }));   // 立刻显示新的选中态
				const run = remindNodesWriteChain.current.then(async () => {
					const ok = await commit(keyName, text);
					// 宿主没接受 ⇒ 撤掉草稿，胶囊回到真实值（saveError 横幅已经在说明原因）。
					// 只撤"还是这一笔文本"的草稿：后面还排着更新的点击时，别把那个意图也抹掉。
					if (!ok) setRemindNodesDraft((p) => (p[which] === text ? { ...p, [which]: null } : p));
				});
				remindNodesWriteChain.current = run.catch(() => {});
				return run;
			};
			// 草稿只在"宿主还没追上"的窗口里存在：一旦已保存值与草稿是**同一组档位**，就撤掉草稿
			// （理由同上面「展示」草稿的 A5 修复：外部改了配置，本页不能永久停在旧值）。
			// 比较的是**解析后的档位**而不是原文：空串 / "6，2" 这类写法差异不该把草稿留住。
			const remindEndSavedText = String(s.remindEndNodes || "");
			const remindStartSavedText = String(s.remindStartNodes || "");
			const remindNodesKeyOf = (text, fallbackNodes) => remindNodesOf(text, fallbackNodes).join(",");
			(0, react.useEffect)(() => {
				setRemindNodesDraft((prev) => {
					let next = prev;
					const drop = (which, savedText, fallbackNodes) => {
						if (next[which] === null) return;
						if (remindNodesKeyOf(next[which], fallbackNodes) !== remindNodesKeyOf(savedText, fallbackNodes)) return;
						if (next === prev) next = { ...prev };
						next[which] = null;
					};
					drop("end", remindEndSavedText, REMIND_DEFAULT_END_NODES);
					drop("start", remindStartSavedText, REMIND_DEFAULT_START_NODES);
					return next;
				});
			}, [remindEndSavedText, remindStartSavedText]);

			const setOrder = async (nextIds) => { await commit("order", nextIds); };
			const move = async (id, delta) => {
				// order 可能缺少新条目的 id（如新增的 ba-jp），按默认顺序补齐后再移动
				let base = order;
				const allIds = allEntries.map((x) => x.id);
				if (allIds.some((x) => !base.includes(x))) {
					base = base.slice();
					for (const x of allIds) if (!base.includes(x)) base.push(x);
				}
				const idx = base.indexOf(id);
				const target = idx + delta;
				if (idx < 0 || target < 0 || target >= base.length) return;
				const next = base.slice();
				next.splice(idx, 1);
				next.splice(target, 0, id);
				await setOrder(next);
			};
			// 重置排序：写空数组而不是 null —— 宿主 settings schema 是 z.array(z.string())，
			// 写 null 会被校验拒绝（旧实现因此永久点不动，还抛未捕获 rejection）；applyOrder 对空数组等价"未设置"
			const resetOrder = async () => { await commit("order", []); };

			// 展示开关（勾选/取消勾选）
			// 三态语义见 60-helpers.js 的 isEntryHidden：hidden = 明确关掉，shown = 明确打开
			// （shown 用来把「出厂默认隐藏 defaultHidden」的条目重新打开）。
			// 每次切换都把 id 从**另一个**列表里摘掉，避免两边同时存在造成判定歧义。
			//
			// A1 修复（2026-10-17）：**决策与显示必须同源**。
			//   复选框的显示值 = `shownNow(g)`（草稿优先）；而旧实现是"显示一处、决策另一处"：
			//   显示用草稿，决策却交给 toggleHidden(g.id) —— 后者用**渲染快照 `s`** 反判
			//   isHiddenNow。宿主一次写入往返实测 1.4~3.6s，第二次点击落在往返窗口内时 `s`
			//   还是旧的 ⇒ 又走「隐藏」分支 ⇒ 复选框显示"已显示"、store 里其实仍是隐藏
			//   （刷新才现原形；审计已真机复现）。
			//   现在 onChange 用**同一个** `shownNow(g)` 取反得到目标状态，交给下面按目标状态
			//   落盘的函数；该函数不再反判快照里的成员"当前值"，而是由目标状态**强制**决定
			//   id 在两个列表里的归属（病根就是"store 里到底是什么"不可信，所以不能"看着
			//   不用写就不写"），并且：
			//     · 串行化：连点两次时第二笔在第一笔落盘后再算 ⇒ 终态 = 最后一次点击；
			//     · 列表内容取**执行时的最新快照**（scope.getSnapshot() 是纯读、不触发渲染，
			//       与 2026-10-16「写后不再手写 setSnapshot」的根修不冲突）⇒ 不会拿旧列表
			//       覆盖掉别的行刚写进去的改动。
			const shownNow = (g) => (Object.prototype.hasOwnProperty.call(showDraft, g.id) ? !!showDraft[g.id] : !isEntryHidden(g, s));
			// ── 游戏列表的搜索 / 筛选（待办第 4 项）────────────────────────────────────
			// 要渲染的行 = 「搜游戏名」∩「只看已启用」，**组合生效**；顺序沿用 ordered（不改用户拖的排序）。
			// 全走 60-helpers.js 的 settingsGamesFilter（纯函数，与面板那边共用同一套归一规则）。
			// 「展示中」用**草稿优先**的 shownNow 判定：勾/取消后当拍筛选就跟着变，不落后一次写入往返。
			// ⚠️ 只在**显示层**过滤：`ordered`（全量、用于上移/下移的真实边界）与任何设置写入都不动。
			const sorted = settingsGamesFilter(ordered, {
				query: gameQuery,
				onlyShown,
				isShown: (g) => shownNow(g)
			});
			const setEntryShown = (id, shouldShow) => {
				const run = showWriteChain.current.then(async () => {
					const snap = scope.getSnapshot();
					const live = snap && snap.status === "ready" ? snap.value : null;
					const lh = live && Array.isArray(live.hidden) ? live.hidden : hidden;
					const lw = live && Array.isArray(live.shown) ? live.shown : shown;
					// 目标状态 ⇒ 终态内容：开 = hidden 里没有它且 shown 里有它（defaultHidden 的条目靠 shown 才能显示）；
					//                    关 = hidden 里有它且 shown 里没有它。
					const nextHidden = shouldShow ? lh.filter((x) => x !== id) : (lh.includes(id) ? lh : [...lh, id]);
					const nextShown = shouldShow ? (lw.includes(id) ? lw : [...lw, id]) : lw.filter((x) => x !== id);
					await commit("hidden", nextHidden);
					await commit("shown", nextShown);
				});
				showWriteChain.current = run.catch(() => {});
				return run;
			};
			// ── 「提醒」白名单（给将来的「到期提醒（送达）」，不属于轮播）────────────────
			// ⚠️ 设置页这一列当前**暂时隐藏**（SHOW_REMIND_COLUMN = false，送达未实现）；
			// 下面这套状态与写入链路原样保留，改回 true 即恢复，不用重写。
			// remindGames = 要提醒的条目 id 列表；空数组 = 一个都不提醒（没有"空 = 全部"的哨兵）。
			// 写入链路与「展示」相同：目标状态驱动 + 串行链 + 执行时读最新快照（避免连点互相覆盖）。
			const remindIds = Array.isArray(s.remindGames) ? s.remindGames : [];
			const remindAllowedNow = (id) => (Object.prototype.hasOwnProperty.call(remindDraft, id)
				? !!remindDraft[id]
				: remindGameAllowed(id, remindIds));
			const setEntryRemind = (id, shouldRemind) => {
				const run = remindWriteChain.current.then(async () => {
					const snap = scope.getSnapshot();
					const live = snap && snap.status === "ready" ? snap.value : null;
					const cur = live && Array.isArray(live.remindGames) ? live.remindGames : remindIds;
					// 普通列表：加 = 并入，减 = 摘掉；减到空就写空（= 一个都不提醒）。
					const next = shouldRemind
						? (cur.includes(id) ? cur.slice() : [...cur, id])
						: cur.filter((x) => x !== id);
					await commit("remindGames", next);
				});
				remindWriteChain.current = run.catch(() => {});
				return run;
			};
			// 「全部提醒」写的是当前展示中的 id；与逐行勾选共用串行链，避免两笔写入互相覆盖。
			const resetRemindAll = () => {
				const run = remindWriteChain.current.then(async () => {
					const next = allEntries.filter((g) => shownNow(g)).map((g) => g.id);
					setRemindDraft({});
					await commit("remindGames", next);
				});
				remindWriteChain.current = run.catch(() => {});
				return run;
			};

			// ── A5（低）：两个草稿一旦写入就**永不清除** ⇒ 会话内长期遮蔽 store 值 ──────────────
			// 症状：别的页面实例 / 外部 RPC（settings/mutate）改了同一个 id 之后，本页控件还停在
			// 旧草稿上，只有刷新（重新挂载、草稿清空）才对齐。
			// 修法：**仅当 store 现值已经等于草稿值**时，把该条目从草稿里删掉 —— 显示值不变
			// （回落去读 store），但草稿不再挡着后续的外部写入。
			//   ⚠️ 不能无条件清：写入还没落盘时 store 还是旧值，那会把用户刚点的意图抹掉（控件弹回）。
			// 依赖键按**值**派生（宿主每次写入都换掉数组对象，按引用当依赖会白跑；理由同面板 A3）。
			const hiddenKey = (Array.isArray(s.hidden) ? s.hidden : []).join("\u0000");
			const shownKey = (Array.isArray(s.shown) ? s.shown : []).join("\u0000");
			const remindGamesKey = (Array.isArray(s.remindGames) ? s.remindGames : []).join("\u0000");
			const entriesById = {};
			for (const x of allEntries) entriesById[x.id] = x;
			(0, react.useEffect)(() => {
				const store = parseJsonStr(s.gameColors, {});
				let changed = false;
				const next = {};
				for (const id of Object.keys(colorDraft)) {
					const cur = typeof store[id] === "string" ? store[id] : "";
					// 值已相等（十六进制大小写不敏感）⇒ 草稿使命完成，删掉它
					if (cur && cur.toLowerCase() === String(colorDraft[id] || "").toLowerCase()) { changed = true; continue; }
					next[id] = colorDraft[id];
				}
				if (changed) setColorDraft(next);
			}, [s.gameColors, colorDraft]);
			(0, react.useEffect)(() => {
				let changed = false;
				const next = {};
				for (const id of Object.keys(showDraft)) {
					const g = entriesById[id];
					// 条目已被删除 ⇒ 草稿没有意义，丢掉；否则 store 的可见性已与草稿相等 ⇒ 丢掉
					if (!g || (!isEntryHidden(g, s) === !!showDraft[id])) { changed = true; continue; }
					next[id] = showDraft[id];
				}
				if (changed) setShowDraft(next);
			}, [hiddenKey, shownKey, s.customEntries, showDraft]);
			// 白名单草稿的同一套清理：store 值已相等（或条目被删）⇒ 丢掉草稿；依赖按值而不是数组引用。
			(0, react.useEffect)(() => {
				let changed = false;
				const next = {};
				for (const id of Object.keys(remindDraft)) {
					const g = entriesById[id];
					if (!g || (remindGameAllowed(id, remindIds) === !!remindDraft[id])) { changed = true; continue; }
					next[id] = remindDraft[id];
				}
				if (changed) setRemindDraft(next);
			}, [remindGamesKey, s.customEntries, remindDraft]);
			// 删除条目：内置条目记入 removed；自定义条目从 customEntries 移除
			const removeEntry = async (g) => {
				if (g.custom) {
					const next = customs.filter((c) => c.id !== g.id);
					await commit("customEntries", JSON.stringify(next));
				} else {
					await commit("removed", [...removed, g.id]);
				}
			};
			// 恢复条目：清空删除记录与自定义条目
			const restoreAll = async () => {
				await commit("removed", []);
				await commit("customEntries", "[]");
			};
			// 爬取地址：默认/备选源/自定义。customUrls[id] 存选中值：
			// - 无 key → 默认源；- 值 === "custom:<用户输入>" → 自定义输入；- 其它（如 "proxy:https://..."）→ 备选源值
			const entryUrlMode = (id, g) => {
				// T3：不再每行重新 parseJsonStr —— 本组件渲染开头已经解析出 `urls`（见上面
				// `const urls = parseJsonStr(s.customUrls, {})`），而这里每渲染一次就有 28 行 × 2 个选择器
				// 各 parse 一遍（真机实测：12 次取色拖动共 2316 次 JSON.parse 的主因之一）。
				// 直接用同一份已解析结果，语义完全一致（同一字符串 + 同一个 parseJsonStr 回退语义）。
				if (!urls || typeof urls !== "object" || !Object.prototype.hasOwnProperty.call(urls, id)) return "default";
				const v = urls[id];
				if (typeof v === "string" && v.startsWith("custom:")) return "custom";
				// 备选源标识（老配置的 proxy:/gk-*: 在这里翻译成新标识）。
				// "" = 该标识已并入"默认源"（如 ba-global 的旧 GameKee 备选 → 默认就是 GameKee）→ 回显"默认"，
				// 否则 <select> 的值匹配不到任何 option，控件会显示空白（用户以为来源丢了）。
				return normalizeSourceId(v) || "default";
			};
			const setUrlMode = async (id, mode, g) => {
				const next = { ...(urls || {}) };
				if (mode === "default") delete next[id];
				else if (mode === "custom") next[id] = "custom:" + (customInputs[id] ?? "");
				else next[id] = mode; // 备选源标识（url 或 id）
				await commit("customUrls", JSON.stringify(next));
			};
			const setCustomUrl = async (id, value) => {
				setCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(urls || {}) };
				next[id] = "custom:" + value;
				await commit("customUrls", JSON.stringify(next));
			};
			// 活动来源地址：默认/自定义（存 customEventUrls），判定同上（custom: 前缀）
			const eventUrls = parseJsonStr(s.customEventUrls, {});
			const eventUrlMode = (id) => {
				// T3：同 entryUrlMode —— 复用本渲染开头解析好的 eventUrls，不再逐行 parse。
				const eu = eventUrls;
				if (!eu || typeof eu !== "object" || !Object.prototype.hasOwnProperty.call(eu, id)) return "default";
				const v = eu[id];
				// 同 entryUrlMode：已并入默认源的旧标识（normalizeSourceId 归一为空串）→ 回显"默认"
				return String(v ?? "").startsWith("custom:") ? "custom" : (normalizeSourceId(v) || "default");
			};
			const setEventUrlMode = async (id, mode) => {
				const next = { ...(eventUrls || {}) };
				if (mode === "custom") next[id] = "custom:" + (eventCustomInputs[id] ?? "");
				// 修（2026-10-16 真机取证）：原来这里是无条件 `else delete next[id]` ⇒ 选**备选活动源**
				// （如"米游社公告"）时把 key 删掉、写回 "{}"，控件立刻弹回"默认"，用户永远选不上。
				// 真机请求体证据：{"op":"set","path":["customEventUrls"],"value":"{}"}（响应 ok:true）。
				// 与上面的卡池来源同构：default 才删，其余（备选源的 url/id）原样存入。
				else if (mode === "default") delete next[id];
				else next[id] = mode;
				await commit("customEventUrls", JSON.stringify(next));
			};
			const setCustomEventUrl = async (id, value) => {
				setEventCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(eventUrls || {}) };
				next[id] = "custom:" + value;
				await commit("customEventUrls", JSON.stringify(next));
			};
			// 每游戏主题色：写入 gameColors（{ id: "#rrggbb" }）。非法/空值 = 删除该项 ⇒ 回落到出厂色/名字哈希。
			//
			// 写入节流（任务 2）：<input type="color"> 在原生取色器里**拖动**时会高频发 input 事件，
			// 原实现每个事件都 commit 一次（= 一次 settings/mutate + 一次整页重渲染；真机实测 12 次连续
			// 事件 = 12 次 mutate + 2738ms 长任务）。现在：
			//   · onChange 只更新本地草稿（颜色立刻跟着手指变，视觉不变）+ 把值记进 pending；
			//   · 落盘推迟到 **120ms 静默期**结束（尾沿去抖）⇒ 连续拖动只有最后一次值真正发出去；
			//   · blur / pointerup / keyup 立即 flush ⇒ "停手就生效"；
			//   · pending 只在**写入被宿主接受后**才清 ⇒ 两次写入交叠时不会丢掉另一次的值，
			//     写失败也会留在队列里等下一次 flush 重试。
			const liveSettings = (0, react.useRef)(s);
			liveSettings.current = s;
			const colorWrite = (0, react.useRef)({ timer: null, pending: null });
			const flushGameColors = async () => {
				const cw = colorWrite.current;
				if (cw.timer !== null) { window.clearTimeout(cw.timer); cw.timer = null; }
				const batch = cw.pending;
				if (!batch || !Object.keys(batch).length) return;
				// 基线用**最新快照**（ref 读，避免计时器闭包停在旧渲染），再叠加尚未落盘的 pending
				const next = { ...parseJsonStr(liveSettings.current.gameColors, {}) };
				for (const id of Object.keys(batch)) {
					const v = batch[id];
					if (v && /^#[0-9a-f]{6}$/i.test(v)) next[id] = v; else delete next[id];
				}
				const accepted = await commit("gameColors", JSON.stringify(next));
				if (accepted) {
					const cur = colorWrite.current.pending;
					if (cur) for (const id of Object.keys(batch)) if (cur[id] === batch[id]) delete cur[id];
				}
			};
			const setGameColor = (id, value) => {
				colorWrite.current.pending = { ...(colorWrite.current.pending || {}), [id]: value };
				if (colorWrite.current.timer !== null) window.clearTimeout(colorWrite.current.timer);
				colorWrite.current.timer = window.setTimeout(() => { colorWrite.current.timer = null; flushGameColors(); }, 120);
			};
			// A2（低）：取色器的落盘计时器原先**没有卸载清理**（本组件另外两处计时器都有：
			// useCycle 与面板的每分钟时钟）。宿主一次写入往返 1.4~3.6s，用户"改完色立刻切走设置页"
			// 时那个 120ms 尾沿计时器仍会在**已卸载**的组件上触发 flushGameColors ⇒ 白发一次
			// settings/mutate（真机实测：切走后仍多一笔 gameColors 写入）。
			// 卸载时**只清计时器、不 flush**（flush 就是发请求）；pending 一并丢弃，
			// 于是卸载后既不会有请求、也不可能再碰本组件的 state（commit 里的 setSaveError）。
			(0, react.useEffect)(() => () => {
				const cw = colorWrite.current;
				if (!cw) return;
				if (cw.timer !== null) { window.clearTimeout(cw.timer); cw.timer = null; }
				cw.pending = null;
			}, []);
			// 添加自定义条目：名称/图标手动填，卡池与活动内容由链接解析产出
			const addEntry = async () => {
				if (!form.name.trim() || !form.url.trim()) return;
				const id = "custom-" + Date.now().toString(36);
				const entry = {
					id,
					name: form.name.trim(),
					icon: form.icon.trim(),
					url: form.url.trim(),
					eventUrl: form.eventUrl.trim(),
					// 主题色（可选）：留着作为该条目的出厂色，设置里的取色器仍可覆盖它
					color: form.color.trim()
				};
				await commit("customEntries", JSON.stringify([...customs, entry]));
				setForm({ name: "", icon: "", url: "", eventUrl: "", color: "" });
				setAdding(false);
			};
			const updateForm = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

			// 每游戏主题色覆盖表（设置里存 JSON 字符串；解析失败回空表 = 全部用出厂色/名字哈希）
			const gameColorMap = parseJsonStr(s.gameColors, {});
			// 选择器/输入框统一样式；textOverflow/overflow 让长选项文本省略截断，避免与下拉箭头重叠
			const inputStyle = { padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", borderRadius: 6, fontSize: 12, maxWidth: "100%", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" };
			const labelStyle = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "none" };

			// 「提醒」档位胶囊（实际只显示「结束」一行：「开始」那一行 2026-10-28 起已注释掉，
			// 但 which="start" 那条分支与草稿仍在，恢复时取消注释即可）：受控值 = 草稿优先、否则已保存值；
			// 选中态 = **判定侧真会用的档位**（remindNodesOf：显式空串 ⇒ 一颗都不选中）。
			// 可选集合 = 该方向的**出厂档位**（REMIND_DEFAULT_*_NODES，直接拿常量当 choices，
			// 不另抄一份）—— 不做自定义输入。
			const remindNodesValue = (which, saved) => (remindNodesDraft[which] === null ? String(saved || "") : remindNodesDraft[which]);
			// 一行 = 「标签 + 一排胶囊」：标签与胶囊之间 8px、胶囊之间 6px（视觉不挤）。
			// 胶囊是真的 <button>（可 Tab / 可回车 / aria-pressed 报告选中态），
			// 选中态走 .gacha-cal-chip--on（主题浅色底 + 深色字；未选中 = 灰描边 + 次级字色；
			// 两者的 hover 都在 styles/chip.css 里，各有轻微变化）。
			const remindChipRow = (which, labelText, savedText, fallbackNodes, keyName, titleText, noteText) => {
				const nodes = remindNodesOf(remindNodesValue(which, savedText), fallbackNodes);
				return (0, react_jsx_runtime.jsxs)("div", {
					key: which,
					style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
					children: [
						(0, react_jsx_runtime.jsx)("span", { style: { flex: "none", fontSize: 12, color: "var(--dsw-alias-label-secondary)" }, title: titleText, children: labelText }),
						(0, react_jsx_runtime.jsxs)("div", {
							style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
							children: fallbackNodes.map((n) => {
								const on = nodes.includes(n);
								return (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-pressed": on ? "true" : "false",
									className: "gacha-cal-chip" + (on ? " gacha-cal-chip--on" : ""),
									title: (on ? "取消这档提醒：" : "选上这档提醒：") + remindNodeText(n),
									onClick: () => toggleRemindNode(which, keyName, savedText, fallbackNodes, n),
									children: remindNodeText(n)
								}, n);
							})
						}),
						noteText ? (0, react_jsx_runtime.jsx)("span", { style: { flex: "none", fontSize: 11, color: "var(--dsw-alias-label-tertiary)" }, children: noteText }) : null
					]
				});
			};

			return (0, react_jsx_runtime.jsxs)("div", {
				style: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 720, fontSize: 13, padding: "2px 0 8px" },
				children: [
					// 标题行（2026-10-28 二次改）：**左侧** = 标题 + 版本号，**右侧** = Star 指引 + 关闭 ✕。
					// 用户要的形态：
					//     二游日历   v0.12.6                         ⭐ 觉得好用？去 GitHub 点个 Star  ✕
					// 布局：整行仍是 flex / alignItems:center / flexWrap:wrap；Star 组（链接 + ✕）
					// 用 marginLeft:"auto" 推到最右（不放链接自己身上，好让两者一起换行、一起消失）。
					//   · 标题：沿用 SETTINGS_SECTION_LABEL，fontSize 16 / fontWeight 600 不变；
					//   · 版本号：`v` + PLUGIN_VERSION（12px 三级字色，见 styles/settings-header.css 的 .gacha-cal-version）。
					//     ⚠️ **不许手写 "v0.12.6"**：PLUGIN_VERSION 由 build.mjs 用根 package.json 的 version
					//     注入（05-version.js 的占位符 → build.mjs 的 VERSION_TOKEN），cases-star.mjs 有防漂移守卫；
					//   · Star 链接：仍是 <a> + target="_blank" + rel，文案是用户要的原句（不加标点），
					//     样式复用 .gacha-cal-star-link（文字链接，不是按钮）；
					//   · 关闭 ✕：小 button（aria-label="不再显示"），点一下写 `starHintDismissed: true`，
					//     整组当拍消失、且持久化（重启也不再显示）。判定走 starHintShownOf（configValueOf 解包）。
					(0, react_jsx_runtime.jsxs)("div", {
						className: "gacha-cal-settings-title",
						style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
						children: [
							(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600 }, children: SETTINGS_SECTION_LABEL }),
							(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-version", title: "插件版本（与 package.json 的 version 一致）", children: "v" + PLUGIN_VERSION }),
							starHintShown ? (0, react_jsx_runtime.jsxs)("div", {
								style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flex: "none" },
								children: [
									(0, react_jsx_runtime.jsx)("a", {
										className: "gacha-cal-star-link",
										href: "https://github.com/EastMG/dsh-gacha-calendar",
										target: "_blank",
										rel: "noreferrer noopener",
										title: "去 GitHub 给这个插件点个 Star",
										children: "⭐ 觉得好用？去 GitHub 点个 Star"
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "gacha-cal-star-close",
										"aria-label": "不再显示",
										title: "不再显示这个提示",
										onClick: dismissStarHint,
										children: "✕"
									})
								]
							}) : null
						] }),
					saveError ? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: saveError }) : null,
					// 配置表单本身的状态：只在"写不进去"时才出现，平时不占位。
					// 这一行是给"控件点了弹回原值、却没有任何提示"这类问题留的现场：
					// memory = 非本机连接（只读）；loading/unavailable = 宿主没把表单送到；
					// ready 但写仍被拒 = 该字段没进表单或修订号冲突。
					(formReady ? null : (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: "\u914D\u7F6E\u53EA\u8BFB\uFF1A" + formStateText })),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !!s.autoRefresh, onChange: (e) => commit("autoRefresh", e.target.checked) }),
								(0, react_jsx_runtime.jsx)("span", { children: "自动刷新" })
							] }),
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "刷新频率" }),
								(0, react_jsx_runtime.jsxs)("select", { className: "gacha-cal-select", value: String(currentMinutes), onChange: (e) => commit("refreshMinutes", Number(e.target.value)), children: [
									!inOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentMinutes), children: "自定义（" + currentMinutes + " 分钟）" }) : null,
									REFRESH_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.minutes), children: o.label }, o.minutes))
								] })
							] })
						] }),
						// 按钮轮播 = 开关 + 范围，不分游戏；下面列表里的「提醒」不控制轮播。
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, title: "有卡池或活动在 N 小时内结束或开始时，侧栏按钮轮播显示", children: [
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: tickerOn, onChange: (e) => commit("tickerOn", e.target.checked) }),
								(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "按钮轮播" })
							] }),
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "轮播范围" }),
								(0, react_jsx_runtime.jsxs)("select", { className: "gacha-cal-select", value: String(currentTicker), onChange: (e) => commit("tickerHours", Number(e.target.value)), children: [
									!tickerInOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentTicker), children: "自定义（" + currentTicker + " 小时）" }) : null,
									TICKER_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.hours), children: o.label }, o.hours))
								] })
							] })
						] }),
						// 「到期提醒（送达）」总开关（默认开）：到点时由**宿主半边**弹系统通知。
						// 下面一行是节点档位胶囊（字符串配置 "72,24,6,2"；开始那一行 2026-10-28 起已注释掉，
						// 原因见 65-remind.js 的 remindConfigOf 把 startNodes 置空）：解析、归一化、
						// 全部取消（空串 = 该方向不提醒）全走 65-remind.js，与判定侧同一份口径。
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, title: "到点时用系统通知提醒：结束前若干小时，同一件事只发最紧急的一档", children: [
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: remindOn, onChange: (e) => commit("remindOn", e.target.checked) }),
								(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "提醒" })
							] }),
							(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: "到期前弹系统通知（仅 DSH 运行期间）" })
						] }),
						remindChipRow("end", "结束提醒", remindEndSavedText, REMIND_DEFAULT_END_NODES, "remindEndNodes", "结束前多久提醒（可多选；全不选 = 结束不提醒）"),
						// 2026-10-28：开始提醒已暂时停用（多数来源不提前提供档期；宿主侧 remindConfigOf 也把
						// startNodes 置空），恢复时把下面这一行取消注释即可：
						// remindChipRow("start", "开始提醒", remindStartSavedText, REMIND_DEFAULT_START_NODES, "remindStartNodes", "开始前多久提醒（可多选；全不选 = 开始不提醒）", "多数来源不提前提供档期，已搁置"),
						// ── 通知身份（可选）：**一行**。「启用」= 当前用户开始菜单里建一条带 AUMID 的快捷方式，
						// 通知横幅顶部才会显示下面那个名字；「移除」= 删掉它并退回 PowerShell。
						// 2026-10-28：三行压成一行 —— 原来那两行说明文字挪进按钮的 title（信息不丢、不再占行）；
						// 名称是 110px 的窄输入框，空 ⇒ 写回默认「二游日历」；窄窗口允许换行（flexWrap）。
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { flex: "none", fontSize: 12, color: "var(--dsw-alias-label-secondary)" }, children: "通知身份" }),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "gacha-cal-sort-btn",
								disabled: notifyIdentityBusy || notifyIdentity === null,
								title: "更改系统通知的发送者：会在开始菜单建一条无害的快捷方式（可随时移除）",
								onClick: toggleNotifyIdentity,
								children: notifyIdentityBusy ? "处理中…" : (notifyIdentity && notifyIdentity.enabled ? "移除" : "启用")
							}),
							// 「发送测试通知」：立刻弹一条，验证通知链路（不影响到期提醒的去重状态）
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "gacha-cal-sort-btn",
								disabled: notifyTestBusy,
								title: "立刻弹一条系统通知，确认通知链路通不通",
								onClick: sendTestNotify,
								children: notifyTestBusy ? "发送中…" : "发送测试通知"
							}),
							// 应用名：**窄输入框**（110px）。失焦或回车提交；空 ⇒ 写回默认「二游日历」；
							// 非法文件名字符 / 超长由 notifyNameOf 清洗（与宿主同一处口径）。
							// 已启用身份时改名会顺便重建快捷方式（见 commitNotifyName）。
							(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, flex: "none" }, title: "通知横幅顶部的应用名（最多 40 字；文件名非法字符会被去掉）", children: [
								(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" }, children: "名称" }),
								(0, react_jsx_runtime.jsx)("input", {
									type: "text",
									value: notifyNameShown,
									placeholder: DEFAULT_SETTINGS.notifyName,
									"aria-label": "通知身份名称",
									style: { width: 110, padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", borderRadius: 6, fontSize: 12 },
									onChange: (e) => setNotifyNameDraft(e.target.value),
									onBlur: () => { void commitNotifyName(); },
									onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }
								})
							] }),
							// 状态：`当前：…`。名字最长 40 字，直接铺开会把整行挤到第二行 ⇒ 截断到 240px
							// 配 title 显示全文（720px 卡片里整行仍然放得下，窄窗口才换行）。
							(0, react_jsx_runtime.jsx)("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: "系统通知横幅顶部当前显示的应用名", children: "当前：" + (notifyIdentity === null ? "读取中…" : notifyIdentity.enabled ? notifyIdentity.name : "PowerShell（默认）") }),
							notifyTest && !notifyTest.ok ? (0, react_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-error-primary, #d4380d)" }, children: notifyTest.text }) : null,
							notifyIdentityError ? (0, react_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-error-primary, #d4380d)" }, children: notifyIdentityError }) : null
						] }),
					] }),
					// ── 实验特性开关：新「二游日历」面板视图（默认关）──
					// 文案从简：只说"实验性新版UI，开发中"。默认值仍是 false（关着 = 原来的表格视图）。
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
							(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: s.newPanel === true, onChange: (e) => commit("newPanel", e.target.checked) }),
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "实验：新「二游日历」面板视图" }),
						] }),
						// 每行都 ≤48 字（_copy_verify.mjs 有「设置页每条文案 ≤ 48 字」的硬门禁）
						(0, react_jsx_runtime.jsxs)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, lineHeight: 1.6 }, children: [
							(0, react_jsx_runtime.jsx)("div", { children: "实验性新版UI，开发中" })
						] })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }, children: [
							// 左侧一组 = 标题 + 搜索框 + 「只看已启用」（待办第 4 项）。
							// 三者**挤在同一行**（不新起一行 ⇒ 设置页不变长）：卡片宽 720px，
							// 标题 ~60 + 搜索 128 + 复选框 ~88 + 右侧按钮组 ~180 仍放得下；
							// 窄窗口靠外层 flexWrap 换行，不会把按钮挤丢。
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "游戏列表" }),
								// 搜游戏名：大小写 / 全半角不敏感，空格分隔 = 多个关键词都要命中（与面板同一套归一）。
								// **临时 UI 状态、不写设置**；清空（或按 Esc）即恢复全部行。
								(0, react_jsx_runtime.jsx)("input", {
									type: "text",
									value: gameQuery,
									placeholder: "搜游戏名",
									"aria-label": "按游戏名搜索",
									title: "按游戏名过滤（大小写 / 全半角不敏感；空格分隔 = 每个词都要命中）",
									style: { ...inputStyle, flex: "0 1 128px", minWidth: 84, fontSize: 11, padding: "2px 6px" },
									onChange: (e) => setGameQuery(e.target.value),
									onKeyDown: (e) => { if (e.key === "Escape") setGameQuery(""); }
								}),
								// 只看已启用：只列当前**展示中**的条目。口径 = 上面那个 shownNow（草稿优先），
								// 与「展示」列显示的值同一个来源 ⇒ 不会出现"勾已取消、行还在"。
								(0, react_jsx_runtime.jsxs)("label", { title: "只列当前展示中的条目（不写设置）", style: { display: "flex", alignItems: "center", gap: 4, flex: "none", fontSize: 11, cursor: "pointer", color: "var(--dsw-alias-label-secondary)" }, children: [
									(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: onlyShown, onChange: (e) => setOnlyShown(e.target.checked) }),
									(0, react_jsx_runtime.jsx)("span", { children: "只看已启用" })
								] })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
								// 「导出 .ics」（待办第 5 项）：把**当前在期**的卡池与活动导出成一次性快照，
								// 导入手机/电脑日历。塞进这一组已有按钮里（不新起一行）：设置页已经很长，
								// 而这三个都是"对整张游戏列表做的动作"，放一起语义也顺。
								// 文案「导出 .ics」是用户点名的四个字，别再改。
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-sort-btn",
									style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 },
									title: "导出当前在期的卡池与活动（.ics 快照，可导入手机/电脑日历）",
									onClick: exportIcs,
									children: "导出 .ics"
								}),
								// 导出结果一行小字（只在点过之后出现，不占常驻版面）
								icsNote ? (0, react_jsx_runtime.jsx)("span", { style: { alignSelf: "center", fontSize: 11, color: "var(--dsw-alias-label-tertiary)", whiteSpace: "nowrap" }, title: icsNote, children: icsNote }) : null,
								// 「全部提醒」= 把当前展示中的 id 写进白名单；空数组的意思是"一个都不提醒"。
								// 暂时隐藏（SHOW_REMIND_COLUMN=false）：按钮与处理函数都保留，改回 true 即恢复。
								SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, title: "把所有展示中的游戏都加入「提醒」白名单", onClick: resetRemindAll, children: "全部提醒" }) : null,
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, onClick: resetOrder, children: "重置排序" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 10px", borderRadius: 6 }, onClick: restoreAll, children: "恢复条目" })
							] })
						] }),
						// 表头行（与数据行同 grid 列；全部居中，与下方各列边界对齐）
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: SETTINGS_GAME_GRID, gap: 12, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6E38\u620F" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5C55\u793A" }),
							// 「提醒」列暂时隐藏：false 时这一格不渲染（列宽模板也已少一格，不会留空列）
							SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u63D0\u9192" }) : null,
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5361\u6C60\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6D3B\u52A8\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u989C\u8272" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u64CD\u4F5C" })
						] }),
						// 结果为空：**一行**「没有匹配的游戏」（不是空白表格，也不隐藏表头 —— 表头还在，
						// 用户一眼知道"是筛掉了，不是坏了"）。
						sorted.length === 0
							? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, padding: "8px 0" }, children: "没有匹配的游戏" })
							: null,
						sorted.map((g) => {
							// 上移/下移的**真实边界**按全量顺序（ordered）算：过滤只影响显示、不改变排位
							const i = ordered.indexOf(g);
							const mode = entryUrlMode(g.id, g);
							const evMode = eventUrlMode(g.id);
							const showGachaInput = mode === "custom";
							const showEventInput = evMode === "custom";
							return (0, react_jsx_runtime.jsxs)("div", {
								key: g.id,
								style: { borderBottom: "1px solid var(--dsw-alias-border-l1)" },
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "grid", gridTemplateColumns: SETTINGS_GAME_GRID, gap: 12, alignItems: "center", padding: "8px 0" },
										children: [
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 }, children: [
												(0, react_jsx_runtime.jsx)(GameIcon, { icon: g.icon, name: g.name, size: 22 }),
												(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name gacha-cal-settings-name", style: { flex: "1 1 auto", minWidth: 0 }, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) })
											] }),
											(0, react_jsx_runtime.jsx)("label", { title: "展示/隐藏这一条", style: { ...labelStyle, cursor: "pointer", justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: shownNow(g),
													onChange: () => {
														const next = !shownNow(g);
														// A1：上面这行就是「决策与显示同源」——目标状态取自当前显示值（shownNow），不再用渲染快照 s 反判当前状态
														setShowDraft((p) => ({ ...p, [g.id]: next }));
														setEntryShown(g.id, next);
													}
												})
											] }),
											// 「提醒」与「展示」独立：它只决定将来的到期送达要不要包含这一条。
											// 未展示的行面板里本来就没有，提醒也无从送达 ⇒ 复选框置灰。
											// 暂时隐藏（SHOW_REMIND_COLUMN=false）：这一格不渲染，但 onChange 链路原样保留。
											SHOW_REMIND_COLUMN ? (0, react_jsx_runtime.jsx)("label", {
												style: { ...labelStyle, cursor: shownNow(g) ? "pointer" : "default", justifySelf: "center", opacity: shownNow(g) ? 1 : 0.45 },
												children: (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: remindAllowedNow(g.id),
													disabled: !shownNow(g),
													onChange: () => {
														const next = !remindAllowedNow(g.id);
														setRemindDraft((p) => ({ ...p, [g.id]: next }));
														setEntryRemind(g.id, next);
													}
												})
											}) : null,
											// 卡池来源选择器
											(0, react_jsx_runtime.jsxs)("select", {
												value: mode,
												className: "gacha-cal-select",
												onChange: (e) => setUrlMode(g.id, e.target.value, g),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g) }),
													(g.altSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.label)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "\u81EA\u5B9A\u4E49" })
												]
											}),
											// 活动来源选择器（未配置活动源默认项为"未配置"，选择"自定义"后展开输入行）
											(0, react_jsx_runtime.jsxs)("select", {
												value: evMode,
												className: "gacha-cal-select",
												onChange: (e) => setEventUrlMode(g.id, e.target.value),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g, "eventUrl") }),
													(g.eventAltSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.fetcher)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "自定义" })
												]
											}),
											// 主题色：点开系统取色器即时写回 gameColors（点右下「重置」样的小方块可取消覆盖）
											(0, react_jsx_runtime.jsx)("label", { title: "主题色（点开系统取色器）", style: { justifySelf: "center", display: "inline-flex", alignItems: "center", cursor: "pointer" }, children: (0, react_jsx_runtime.jsx)("input", {
												type: "color",
												value: colorDraft[g.id] || (/^#[0-9a-f]{6}$/i.test(String(gameColorMap[g.id] || "")) ? gameColorMap[g.id] : (() => { const c = scheduleGameColor(g, gameColorMap); return /^#[0-9a-f]{6}$/i.test(c) ? c : "#3b5bfd"; })()),
												onChange: (e) => { const v = e.target.value; setColorDraft((p) => ({ ...p, [g.id]: v })); setGameColor(g.id, v); },
												// 松手/失焦/按键抬起后立即落盘（不等 120ms 去抖窗口）。
												// ⚠️ 原生取色器是**独立的系统窗口**，不保证把 pointerup 交回页面 ⇒
												//     真正兜底的是 setGameColor 里那个 120ms 尾沿计时器（"停手就生效"）。
												onBlur: () => { flushGameColors(); },
												onPointerUp: () => { flushGameColors(); },
												onKeyUp: () => { flushGameColors(); },
												className: "gacha-cal-color"
											}) }),
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 4, justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-sort-btn--icon", title: "\u4E0A\u79FB", disabled: i === 0, onClick: () => move(g.id, -1), children: (0, react_jsx_runtime.jsx)("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: (0, react_jsx_runtime.jsx)("path", { d: "M6 14.5l6-6 6 6" }) }) }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-sort-btn--icon", title: "\u4E0B\u79FB", disabled: i === ordered.length - 1, onClick: () => move(g.id, 1), children: (0, react_jsx_runtime.jsx)("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: (0, react_jsx_runtime.jsx)("path", { d: "M6 9.5l6 6 6-6" }) }) }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-sort-btn--icon gacha-cal-del-btn", title: "\u5220\u9664", onClick: () => removeEntry(g), children: (0, react_jsx_runtime.jsx)("svg", {
													width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
													children: [
														(0, react_jsx_runtime.jsx)("path", { d: "M4 7h16" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M6.5 7l.9 12.1A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.9L17.5 7" })
													]
												}) })
											] })
										]
									}),
									// 自定义输入行：选择"自定义"后整行展开（全宽，不挤压列）
									showGachaInput || showEventInput ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "0 4px 6px" }, children: [
										showGachaInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "卡池来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "https://…/api.php 或含排期的网页",
												value: customInputs[g.id] ?? (urls && typeof urls === "object" ? String(urls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null,
										showEventInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "活动来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "https://…/api.php 或含排期的网页",
												value: eventCustomInputs[g.id] ?? (eventUrls && typeof eventUrls === "object" ? String(eventUrls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomEventUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null
									] }) : null
								]
							});
						}),
						adding ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: 8, padding: 10, marginTop: 6 }, children: [
							(0, react_jsx_runtime.jsx)("div", { style: { fontWeight: 600 }, children: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" }),
							(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "名称与图标手动填写；卡池与活动由来源链接解析产出" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "名称（必填）", value: form.name, onChange: updateForm("name"), style: { ...inputStyle, flex: "1 1 140px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "图标 URL（可选）", value: form.icon, onChange: updateForm("icon"), style: { ...inputStyle, flex: "1 1 240px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "color", title: "主题色（可选；留空则按名称自动分配）", value: /^#[0-9a-f]{6}$/i.test(form.color) ? form.color : (() => { const c = scheduleGameColor({ id: "custom-preview", name: form.name }); return /^#[0-9a-f]{6}$/i.test(c) ? c : "#3b5bfd"; })(), onChange: updateForm("color"), className: "gacha-cal-color", style: { flex: "0 0 28px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "卡池来源链接（必填）", value: form.url, onChange: updateForm("url"), style: { ...inputStyle, flex: "1 1 300px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "活动来源链接（可选）", value: form.eventUrl, onChange: updateForm("eventUrl"), style: { ...inputStyle, flex: "1 1 300px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { width: "auto", height: "auto", padding: "3px 12px", borderRadius: 6 }, disabled: !form.name.trim() || !form.url.trim(), onClick: addEntry, children: "\u6DFB\u52A0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: () => setAdding(false), children: "\u53D6\u6D88" })
							] })
						] }) : (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { alignSelf: "flex-start", marginTop: 6 }, onClick: () => setAdding(true), children: "+ \u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" })
					] }),
					// 解析器自检（待办第 3 项）——**一套卡片**，不是两块并列。
					// 用户 2026-10-28 明确：「来源健康」是原来那套手动自检的**升级替代**，同一张卡里并存两套
					// 就是重复（旧卡是两块：一块手动跑自检、一块列健康，中间还夹一句重复说明）。
					// 现在的形态（只有一种）：
					//   · 标题「解析器自检」+ 唯一按钮「立即检查」= 按需把所有源抓一遍（engine.selfCheck()，
					//     只读），busy 时按钮禁用并写「检查中…」；
					//   · 卡片内容 = 来源健康列表，**永远可见**：一条记录都没有时也给一行状态
					//     （"整块不渲染"正是用户看不到这个功能的原因）；
					//   · 默认只列异常（健康的来源不占地方），「显示全部」才展开 —— 不把卡片撑长；
					//   · 自检报告并入这块列表的**下方**（原来是下面单独一块），不再单列。
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "解析器自检" }),
							(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-refresh gacha-cal-sort-btn", disabled: selfChecking, onClick: runSelfCheck, children: selfChecking ? "检查中…" : "立即检查" })
						] }),
						// ── 来源健康（待办第 3 项）：**无条件下渲染** ─────────────────────────
						// 三档状态都在这一块里（空 / 全正常 / 有异常），卡片不会有"什么都不显示"的情况：
						//   · 没有任何记录（没刷过 / 从旧版本升上来）⇒ 一行空状态（还顺手带一句口径说明）；
						//   · 全部正常 ⇒ 一行汇总「全部正常（N 个来源）」，不列任何来源；
						//   · 有异常 ⇒ 汇总写"N 个来源需要关注"，逐条列出（游戏名 · 连续失败 N 次 ·
						//     最近成功 X 前 · 原因）——健康的来源仍然不占地方。
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }, children: [
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("span", {
									style: { color: healthBad.length ? "var(--dsw-alias-state-warn-label)" : "var(--dsw-alias-label-tertiary)" },
									children: healthKnown.length === 0
										? "来源健康：还没有刷新记录（刷新一次数据后这里会显示每个来源的情况；无匹配/未公布 与 抓取失败 会分开标）"
										: healthBad.length
											? "来源健康：" + healthBad.length + " 个来源需要关注"
											: "来源健康：全部正常（" + healthKnown.length + " 个来源）"
								}),
								healthKnown.length > 0 ? (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-sort-btn",
									style: { width: "auto", height: "auto", padding: "1px 8px", borderRadius: 6, fontSize: 11 },
									onClick: () => setHealthAll((v) => !v),
									children: healthAll ? "只看异常" : "显示全部 " + healthKnown.length + " 个"
								}) : null
							] }),
							// 文案与色阶都由纯函数 sourceHealthOf 给定（text 就是「名字 · 连续失败 N 次 · …」那句）；
							// down = 失败红、stale/never = 疑似停更黄、ok = 三级灰。
							(healthAll ? healthKnown : healthBad).map((h) => (0, react_jsx_runtime.jsx)("div", {
								title: h.name + " · " + h.text,
								style: {
									color: h.state === "down"
										? "var(--dsw-alias-state-error-primary, #d4380d)"
										: (h.state === "ok" ? "var(--dsw-alias-label-tertiary)" : "var(--dsw-alias-state-warn-label)")
								},
								children: "· " + h.name + " · " + h.text
							}, h.id)),
							// 自检报告（只有点过「立即检查」才有）：贴在列表**下方**，与健康列表同一块。
							selfReport ? (selfReport.error
								? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", paddingTop: 2 }, children: "自检失败：" + selfReport.error })
								: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, paddingTop: 2 }, children: [
									(0, react_jsx_runtime.jsx)("div", { children: "刚检查完：" + selfReport.total + " 款游戏的 " + selfSources + " 个来源里 " + selfBad + " 个没内容（成功 " + selfReport.summary.ok + " / 无匹配/未公布 " + selfReport.summary.nomatch + " / 未配置 " + selfReport.summary.unconfigured + " / 失败 " + selfReport.summary.down + "）· 用时 " + (selfReport.elapsedMs / 1000).toFixed(1) + "s" }),
									selfReport.problems.length === 0
										? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-business-primary)" }, children: "✓ 所有来源都正常" })
										: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [
											(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)" }, children: "需要关注：" }),
											selfReport.problems.map((p, i) => (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-primary)" }, children: "· " + p }, i))
										] })
								] })) : null
						] })
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "数据来自各游戏官方公告、官方 Wiki 与第三方站；无数据时对应列留空" })
				]
			});
		}
		//#endregion
