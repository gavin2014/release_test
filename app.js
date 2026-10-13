/* Shared interface: local backend or the static browser adapter. */
const browserMode = !!window.ReleaseBrowser;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = v => { try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } };
const size = n => n >= 1024**3 ? `${(n/1024**3).toFixed(2)} GB` : n >= 1024**2 ? `${(n/1024**2).toFixed(1)} MB` : n >= 1024 ? `${(n/1024).toFixed(1)} KB` : `${n || 0} B`;
const date = v => v ? new Date(v).toLocaleString('zh-CN', {hour12:false}) : '尚未同步';
const paths = {
 box:'M21 8l-9 5-9-5m9 5v9M3 7l9-5 9 5v10l-9 5-9-5z',
 tag:'M20 13l-7 7a2 2 0 0 1-3 0L2 12V3h9l9 7a2 2 0 0 1 0 3ZM7 7h.01',
 file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6',
 route:'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
 arrow:'M7 17 17 7M7 7h10v10',
 refresh:'M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6',
 plus:'M12 5v14M5 12h14',
 shield:'m12 3 8 4v6c0 5-8 9-8 9s-8-4-8-9V7ZM8 12l3 3 5-6',
 upload:'M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4',
 link:'m10 13 4-4M7 14l-2 2a3 3 0 0 0 4 4l4-4a3 3 0 0 0 0-4m4-2 2-2a3 3 0 0 0-4-4l-4 4a3 3 0 0 0 0 4',
 clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 github:'M9 19c-5 2-5-2-7-2m14 5v-4a3 3 0 0 0-1-2c4 0 7-2 7-6a5 5 0 0 0-2-4 5 5 0 0 0 0-4s-2 0-4 2a13 13 0 0 0-6 0C8 2 6 2 6 2a5 5 0 0 0 0 4 5 5 0 0 0-2 4c0 4 3 6 7 6a3 3 0 0 0-1 2v4',
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n] || paths.box}"/></svg>`;
let state = {projects:[], jobs:[], routes:[]}, releases = [], projectId = '', page = 'releases', editingNew = false, filter = 'all', search = '';
let selectedFiles = [], prepared = null, importText = '', pending = false, modalAsset = null, lastJobState = '', releaseRequest = 0;
const project = () => state.projects.find(p => p.id === projectId);
const jobs = () => state.jobs.filter(j => j.project_id === projectId);
const statusLabels = {queued:'等待发布', running:'发布中', awaiting_upload:'等待上传与核对', success:'发布成功', failed:'发布失败'};

async function api(path, opts = {}) {
 if (browserMode) return window.ReleaseBrowser.request(path, opts);
 const res = await fetch(path, {...opts, headers:{'X-Release-Client':'ReleaseDesk', ...(opts.body && !(opts.body instanceof FormData) ? {'Content-Type':'application/json'} : {}), ...(opts.headers || {})}});
 const data = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '输入内容不符合要求，请检查后重试。');
 return data;
}
function toast(message, error = false) {
 const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
 $('#toasts').append(el); setTimeout(() => el.remove(), error ? 8000 : 4500);
}
async function busy(button, work) {
 const text = button.innerHTML; button.disabled = true; button.innerHTML = '<span class="spinner"></span> 处理中…';
 try { return await work(); } catch (e) { toast(e.message, true); } finally { button.disabled = false; button.innerHTML = text; }
}
function heading(overline, title, subtitle, action = '') {
 return `<div class="page-heading"><div><p class="eyebrow">${overline}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${action}</div></div>`;
}
function empty(title, desc, action = '') {
 return `<div class="empty"><div class="empty-illustration">${icon('box')}</div><h3>${title}</h3><p>${desc}</p>${action}</div>`;
}
const newButton = () => `<button class="button primary" data-action="new-release" ${!project()?.has_token ? 'disabled' : ''}>${icon('plus')}发布新版本</button>`;
function changePage(next) {
 page = next; $('#crumb').textContent = {releases:'版本总览',jobs:'发布任务',routes:'下载线路',settings:'仓库配置'}[page];
 $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.page === page)); render();
}
function render() {
 if (page === 'releases') renderReleases();
 if (page === 'settings') renderSettings();
 if (page === 'jobs') renderJobs();
 if (page === 'routes') renderRoutes();
}
async function loadState() {
 state = await api('/api/state');
 if (!state.projects.some(p => p.id === projectId)) projectId = state.projects[0]?.id || '';
 $('#project-picker').innerHTML = state.projects.length ? state.projects.map(p => `<option value="${esc(p.id)}">${esc(p.repo)}</option>`).join('') : '<option value="">尚未连接仓库</option>';
 $('#project-picker').value = projectId;
 $('#task-count').textContent = state.jobs.filter(j => ['queued','running','awaiting_upload'].includes(j.status)).length;
}
async function loadReleases() {
 const req = ++releaseRequest, id = projectId;
 if (!id) { releases = []; return; }
 const result = await api(`/api/projects/${id}/releases`);
 if (req === releaseRequest && id === projectId) releases = result.releases;
}
function how() {
 return `<div class="how-it-works"><div class="how-title">让发布成为习惯<small>${browserMode?'浏览器直连 GitHub，管理每个版本':'准备一次，自动完成发布'}</small></div><div class="step"><span class="step-number">01</span><div><strong>连接 GitHub 仓库</strong><small>填写仓库地址与 API Key</small></div></div><div class="step"><span class="step-number">02</span><div><strong>准备版本与附件</strong><small>${browserMode?'填写说明，核对安装包':'填写说明，上传安装包'}</small></div></div><div class="step"><span class="step-number">03</span><div><strong>发布并分享下载</strong><small>查看结果，选择下载线路</small></div></div></div>`;
}
function proxyRestriction(release = null) {
 if (project()?.private) return '当前仓库为私有仓库，公共下载代理无法使用你的 GitHub 登录权限，因此不会生成代理链接。原始链接需要在浏览器中登录有权限的 GitHub 账户。';
 if (release?.draft) return '当前版本仍是草稿，尚无公开附件，正式发布后才会生成代理下载链接。';
 return '';
}
function proxyNotice(release = null) {
 const reason = proxyRestriction(release);
 if (!reason) return '';
 const enabled = state.routes.filter(r => r.enabled).map(r => r.name);
 return `<div class="note-box banner proxy-notice"><strong>${enabled.length ? `${esc(enabled.join('、'))} 已启用，但不适用于当前${project()?.private ? '仓库' : '版本'}` : '当前仅提供 GitHub 原始下载'}</strong><br>${reason}</div>`;
}
function renderReleases() {
 const p = project(), published = releases.filter(r => !r.draft), assets = releases.flatMap(r => r.assets || []);
 const running = jobs().filter(j => ['running','queued','awaiting_upload'].includes(j.status)).length;
 const routeCount = new Set(assets.flatMap(a => (a.routes || []).map(r => r.id))).size;
 $('#main').innerHTML = heading('RELEASE CENTER', '每一次发布，都井然有序。', p ? `${esc(p.repo)} · 管理版本、发布资源与下载入口` : '连接你的 GitHub 仓库，把版本说明、安装包与下载线路放在一起。',
  `<button class="button" data-action="sync" ${!p?.has_token ? 'disabled' : ''}>${icon('refresh')}同步版本</button>${newButton()}`) +
 `<div class="stats">${[
 ['已发布版本', published.length, '稳定版与预发布版本', 'tag'],
 ['发布附件', assets.length, `${size(assets.reduce((a,b)=>a+b.size,0))} · 已同步资源`, 'file'],
 ['附件下载线路', routeCount, !assets.length ? '有发布附件后生成链接' : p?.private ? '私有仓库 · 仅 GitHub 原始地址' : '当前附件已生成的线路种类', 'route'],
 ['进行中的任务', running, running ? (browserMode ? '等待上传附件与核对发布' : '附件上传后自动发布') : '所有发布任务就绪', 'clock']
 ].map(([label,value,note,i])=>`<div class="stat"><div><div class="stat-label">${label}</div><div class="stat-value">${value.toString().padStart(2,'0')}</div><div class="stat-note">${note}</div></div><div class="stat-icon">${icon(i)}</div></div>`).join('')}</div>` +
 (p?.sync_error ? `<div class="error-box banner">${esc(p.sync_error)} 当前显示最近一次成功同步的数据。</div>` : '') + proxyNotice() +
 `<section class="panel"><div class="panel-title"><h2>版本记录<span class="count">${releases.length}</span></h2><div class="toolbar"><div class="tabs"><button class="tab ${filter==='all'?'active':''}" data-filter="all">全部</button><button class="tab ${filter==='stable'?'active':''}" data-filter="stable">稳定版</button><button class="tab ${filter==='pre'?'active':''}" data-filter="pre">预发布</button></div><input class="search" id="release-search" aria-label="搜索版本" placeholder="搜索版本号或标题…" value="${esc(search)}"></div></div><div id="release-list"></div></section>` + how() +
 (p ? `<div class="notification"><span>最近同步：${date(p.synced_at)}</span>${!p.private ? `<a class="inline-link" href="${browserMode ? esc(window.ReleaseBrowser.publicUrl(p.repo)) : `/download/${p.id}`}" target="_blank" rel="noopener">打开下载展示页 ↗</a>` : '<span>私有仓库 · 仅展示原始下载地址</span>'}</div>` : '');
 renderReleaseList();
}
function renderReleaseList() {
 const list = $('#release-list'); if (!list) return;
 if (!project()) {
  list.innerHTML = empty('从连接第一个仓库开始', '只需一个 GitHub 仓库地址和 API Key。<br>连接后，你的版本记录和下载资源将在这里呈现。', `<button class="button primary" data-action="add-project">${icon('plus')}连接 GitHub 仓库</button>`); return;
 }
 const items = releases.filter(r => (filter==='all' || (filter==='pre' ? r.prerelease : !r.prerelease && !r.draft)) && `${r.tag_name} ${r.name}`.toLowerCase().includes(search.toLowerCase()));
 list.innerHTML = items.length ? items.map((r,i) => releaseCard(r, i === 0)).join('') : empty(releases.length ? '没有匹配的版本' : '这里将记录你的每次发布', releases.length ? '试试其他版本号或筛选条件。' : '仓库已连接。同步现有版本，或准备你的第一个发布。', releases.length ? '' : newButton());
}
function releaseCard(r, opened) {
 const assets = r.assets || [];
 return `<details class="release" ${opened?'open':''}><summary><span class="version-symbol">${icon('tag')}</span><div><div class="release-title">${esc(r.name || r.tag_name)}<span class="badge ${r.draft?'orange':r.prerelease?'purple':'green'}">${r.draft?'草稿':r.prerelease?'预发布':'稳定版'}</span></div><div class="release-meta"><span>${esc(r.tag_name)}</span><span>${date(r.published_at || r.created_at)}</span><span>${assets.length} 个附件</span></div></div><span class="release-arrow">›</span></summary><div class="release-content"><div class="release-body markdown">${r.body_html || '<p>此版本尚未填写说明。</p>'}</div><div class="asset-list">${assets.map(a => `<div class="asset-row">${icon('file')}<span class="asset-name">${esc(a.name)}</span><span class="asset-info">${size(a.size)} · ${a.download_count || 0} 次下载</span><button class="button small" data-asset="${a.id}">下载线路 ↗</button></div>`).join('') || '<div class="asset-row muted micro">此版本没有附件</div>'}</div><div class="release-bottom"><span>GitHub 附件下载计数 · 不代表各代理线路的完成次数</span><a href="${esc(safeUrl(r.html_url))}" target="_blank" rel="noopener noreferrer">查看 GitHub Release ↗</a></div></div></details>`;
}
function renderSettings() {
 const p = editingNew ? null : project();
 $('#main').innerHTML = heading('REPOSITORY SETTINGS', p ? '仓库配置' : '连接你的 GitHub 仓库', '一次配置，持续管理。版本数据通过 GitHub 官方接口读取与发布。', p ? `<button class="button" data-action="add-project">${icon('plus')}添加仓库</button>` : '') +
 `<div class="settings-grid"><section class="panel"><div class="panel-title"><h2>${p ? '仓库连接' : '添加新仓库'}</h2><span class="badge ${p?.has_token?'green':''}">${p?.has_token?'已保存凭据':'等待连接'}</span></div><form id="config-form" class="panel-body"><input type="hidden" name="id" value="${esc(p?.id || '')}"><div class="field"><label for="repo-url">GitHub 仓库地址<span class="required">*</span></label><input id="repo-url" name="repository" required placeholder="https://github.com/your-name/your-app" value="${esc(p?.repo || '')}" ${p?'readonly':''} autocomplete="off"><p class="field-help">支持完整仓库地址或 <code>owner/repository</code>。更换仓库可添加新项目。</p></div><div class="field"><label for="api-key">API Key / Personal Access Token<span class="required">*</span></label><div class="password-wrap"><input id="api-key" type="password" name="api_key" placeholder="${p?.has_token?(browserMode?'已保存在浏览器，留空保留现有 Key':'已加密保存，留空保留现有 Key'):'github_pat_… 或 ghp_…'}" ${p?.has_token?'':'required'} autocomplete="new-password" spellcheck="false"><button type="button" data-action="toggle-key">显示</button></div><p class="field-help">用于访问和发布到此仓库。保存后不会再次显示完整 Key。</p></div>${browserStorageField(p)}<div class="form-grid"><div class="field"><label for="project-name">显示名称</label><input id="project-name" name="name" placeholder="例如：我的桌面工具" value="${esc(p?.name || '')}"></div><div class="field"><label for="target-branch">发布目标分支</label><input id="target-branch" name="branch" placeholder="自动使用仓库默认分支" value="${esc(p?.branch || '')}"></div></div><div id="connection-result" role="status"></div><div class="form-footer"><span class="inline-info">${icon('shield')}${browserMode?'凭据保存在当前浏览器':'本机加密保存 · Windows DPAPI'}</span><div class="actions"><button type="button" class="button" data-action="test-connection">测试连接</button><button type="submit" class="button primary">保存并连接 ${icon('arrow')}</button></div></div>${p?.has_token?'<div class="space-top"><button type="button" class="button small danger" data-action="clear-key">清除此仓库的 API Key</button></div>':''}</form></section><div class="stack"><aside class="panel guide"><div class="guide-icon">${icon('github')}</div><h3>如何获取 API Key？</h3><ol><li>打开 GitHub 的 Token 设置，创建 Fine-grained token。</li><li>选择要管理的仓库，设置 <strong>Contents → Read and write</strong>。</li><li>复制生成的 Token，填入左侧 API Key。</li></ol><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">前往 GitHub 创建 Token ↗</a><div class="note-box space-top">测试连接只读取仓库。组织仓库可能需要管理员批准；正式发布时会检查实际写权限。</div></aside><aside class="panel guide"><h3>一个仓库，一份发布记录</h3><p>可以添加多个仓库，从顶部切换。每个仓库的版本、发布任务与监听目录分别管理。</p><p>${browserMode?'Token 由当前浏览器直接发送到 GitHub API，不写入静态站点文件，也不发送到下载代理。':'下载代理只处理公开附件，API Key 始终由本机后端用于连接 GitHub。'}</p></aside></div></div>` +
 (!browserMode && p ? `<section class="panel space-top"><div class="panel-title"><h2>按目录自动发布</h2><label class="switch"><input type="checkbox" id="watch-toggle" ${p.watch?'checked':''} ${!p.has_token?'disabled':''}>${p.watch?'已启用':'已关闭'}</label></div><div class="panel-body"><p class="subtitle space-bottom">在下方目录按 <code>v1.2.0/release.md + assets/</code> 存放文件。开启后每 10 秒检查，遇到 <code>status: ready</code> 且校验通过的版本会自动发布到 GitHub。</p><code class="path">${esc(p.inbox)}</code>${p.scan_error?`<div class="error-box space-top">${esc(p.scan_error)}</div>`:''}<p class="field-help">已接收的版本不重复发布。失败任务请在「发布任务」中重试。可在发布预览中下载合规的 release.md。</p></div></section>` : '');
 if (browserMode) $('#main').insertAdjacentHTML('beforeend', '<div class="note-box banner">浏览器版在 GitHub Pages 上直接运行。请在发布任务中通过 GitHub 上传附件，再核对发布；本机目录自动监听需使用本机版。</div>');
 $('#config-form').addEventListener('submit', saveConfiguration);
 $('#watch-toggle')?.addEventListener('change', async e => {
  const checked = e.target.checked;
  try { await api(`/api/projects/${p.id}/watch`, {method:'POST', body:JSON.stringify({enabled:checked})}); await loadState(); renderSettings(); toast(checked?'目录监听已开启，ready 版本将自动发布':'目录监听已关闭'); } catch (err) {e.target.checked = !checked; toast(err.message,true);}
 });
}
function configPayload() { return Object.fromEntries(new FormData($('#config-form'))); }
function browserStorageField(p) {
 if (!browserMode) return '';
 return `<div class="field"><label for="storage-mode">Token 保存方式</label><select id="storage-mode" name="storage_mode"><option value="session" ${p?.storage_mode!=='local'?'selected':''}>仅当前标签页会话</option><option value="local" ${p?.storage_mode==='local'?'selected':''}>记住到此浏览器</option></select><p class="field-help">记住后保存在此站点的 Local Storage 中，不是加密保险箱。仅在可信设备上使用；同一 github.io 域名下的页面共享浏览器存储权限。Token 仅随请求发送到 GitHub API。</p></div>`;
}
function browserJobActions(j) {
 if (!browserMode || !j.release_id || j.status === 'success') return '';
 return `<div class="note-box space-top"><strong>上传附件后，再核对并发布</strong><p>1. 下载 SHA256SUMS，与所选安装包一起放到同一目录。<br>2. 在 GitHub 草稿编辑页添加这些附件并保存草稿，或在此目录执行下方命令。<br>3. 返回这里点击「核对附件并发布」，系统将检查每个文件的名称、大小和 SHA-256。</p><div class="actions"><a class="button small" href="${esc(safeUrl(j.edit_url))}" target="_blank" rel="noopener noreferrer">去 GitHub 上传附件 ↗</a><button class="button small" data-job-sums="${j.id}">下载 SHA256SUMS</button><button class="button small" data-job-command="${j.id}">复制上传命令</button><button class="button small primary" data-job-finish="${j.id}">核对附件并发布</button></div><code class="route-url">${esc(window.ReleaseBrowser.commandFor(j))}</code><p class="field-help">命令使用 GitHub CLI 的登录状态（先运行 gh auth login），不包含本站保存的 Token。静态站点无法直接上传二进制附件，安装包内容不会保存在浏览器存储中。</p></div>`;
}
async function saveConfiguration(e) {
 e.preventDefault(); const button = e.submitter;
 await busy(button, async () => {
  const result = await api('/api/projects',{method:'POST',body:JSON.stringify(configPayload())});
  $('#api-key').value = ''; projectId = result.id; editingNew = false;
  await loadState(); await loadReleases(); changePage('releases'); toast(browserMode?'仓库已连接，Token 已按所选方式保存在当前浏览器。':'仓库连接已保存，API Key 已加密。');
 });
}
function renderJobs() {
 $('#main').innerHTML = heading('PUBLISHING ACTIVITY','每个版本，都有完整记录。','查看发布进度、附件校验与执行日志。中断的任务可以从已有结果恢复。', newButton()) +
 `<section class="panel"><div class="panel-title"><h2>发布任务<span class="count">${jobs().length}</span></h2><span class="micro muted">状态每 4 秒自动刷新</span></div>${jobs().length ? jobs().map(jobCard).join('') : empty('还没有发布任务',browserMode?'在版本总览中准备新版本，然后上传附件并核对发布。':'在版本总览中发布新版本，或者开启目录自动发布。',newButton())}</section>`;
}
function jobCard(j) {
 const logsOpen = window.openJobLogs?.has(j.id);
 return `<article class="job-card"><div class="row-between"><div class="job-title">${esc(j.spec.title)}<span class="badge ${j.status==='success'?'green':j.status==='failed'?'red':'orange'}">${statusLabels[j.status]}</span></div><span class="micro muted">${esc(j.spec.tag)}</span></div><p class="job-desc">${esc(j.step)}</p>${j.error?`<div class="error-box">${esc(j.error)}</div>`:''}${j.status==='running'?`<progress value="${j.progress.sent}" max="${j.progress.total || 1}"></progress><p class="field-help">${esc(j.progress.file)} · ${size(j.progress.sent)} / ${size(j.progress.total)}</p>`:''}${browserJobActions(j)}<div class="job-footer"><span>${date(j.created_at)}</span><span>已核对 ${j.uploaded.length} / ${j.assets.length} 个附件</span><div class="actions"><button class="button small" data-job-manifest="${j.id}">导出说明</button>${j.status==='failed'||(browserMode&&j.status==='queued')?`<button class="button small primary" data-retry="${j.id}">重试发布</button>`:''}${j.release_url?`<a class="button small" href="${esc(safeUrl(j.release_url))}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>`:''}</div></div><details class="space-top" data-log="${j.id}" ${logsOpen?'open':''}><summary class="micro muted">执行日志 · ${j.logs.length} 条</summary><div class="job-log">${j.logs.map(l=>`<div><time>${date(l.time)}</time>${esc(l.message)}</div>`).join('') || '等待任务开始'}</div></details></article>`;
}
function renderRoutes() {
 $('#main').innerHTML = heading('DOWNLOAD CHANNELS','给下载，多一个选择。','配置适用于公开 Release 附件的代理线路。启用后，具体下载链接在附件的「下载线路」中查看。', project() ? '<button class="button" data-page="releases">查看附件下载链接 ↗</button>' : '')+ proxyNotice() +
 `<div class="settings-grid"><section class="panel"><div class="panel-title"><h2>下载线路<span class="count">${state.routes.length+1}</span></h2><span class="micro muted">按列表顺序展示</span></div><div class="route-item"><div class="row-between"><span class="route-name">GitHub 原始下载 <span class="badge green">默认</span></span><span class="micro muted">始终保留</span></div><p class="route-template">使用 GitHub API 返回的附件下载地址</p></div>${state.routes.map((r,i)=>`<div class="route-item"><div class="row-between"><div class="route-name">${esc(r.name)} <span class="badge ${r.enabled?'green':''}">${r.enabled?'已启用':'未启用'}</span></div><div class="route-actions"><button class="button small" data-route-up="${i}" ${i===0?'disabled':''} aria-label="上移 ${esc(r.name)}">↑</button><button class="button small" data-route-toggle="${esc(r.id)}">${r.enabled?'停用':'启用'}</button><button class="button small" data-route-edit="${esc(r.id)}">编辑</button><button class="button small danger" data-route-delete="${esc(r.id)}">删除</button></div></div><p class="route-template">${esc(r.template)}</p></div>`).join('')}<form id="route-form" class="route-form"><input type="hidden" name="id"><h3 class="modal-subtitle">添加代理线路</h3><div class="form-grid"><div class="field"><label for="route-name">线路名称</label><input name="name" id="route-name" placeholder="例如：自建下载代理" required maxlength="60"></div><div class="field"><label for="route-template">下载地址模板</label><input name="template" id="route-template" placeholder="https://proxy.example.com/{url}" required></div></div><p class="field-help"><code>{url}</code> 代表原始 GitHub 下载地址；查询参数形式可使用 <code>{url_encoded}</code>。</p><div class="actions space-top"><button class="button primary" type="submit">保存线路</button><button class="button" type="button" data-action="reset-route">清空</button></div></form></section><div class="stack"><aside class="panel guide"><div class="guide-icon">${icon('route')}</div><h3>代理线路 ≠ 独立镜像</h3><p>代理通过其他地址取得 GitHub 附件。独立镜像则需要把文件上传到自己的存储。</p><p>当前版本提供原始下载与可配置代理，独立对象存储尚未接入。</p><div class="note-box space-top">预置 GH-Proxy、GHProxy.net、GHFast 和 GH-Proxy 备用入口，新工作空间默认启用。GH-Proxy 的两个域名属于同一服务；可按需关闭或修改。</div></aside><aside class="panel guide"><h3>检测会显示什么？</h3><p>${browserMode?'浏览器受跨域限制，静态版不提供自动测速。请打开具体下载地址验证当前网络可用性。':'检测从当前电脑发起，展示响应时间和部分内容是否可获取。结果带检测时间，不能保证所有地区的下载速度。'}</p><p>检测不会携带 GitHub API Key。私有仓库只保留原始下载链接。</p></aside></div></div>`;
 $('#route-form').addEventListener('submit', async e => {
  e.preventDefault(); await busy(e.submitter, async()=>{
   const form=Object.fromEntries(new FormData(e.target));
   const updated=structuredClone(state.routes), idx=updated.findIndex(r=>r.id===form.id);
   const item={...form,enabled:idx>=0 ? updated[idx].enabled : true};
   if(idx>=0) updated[idx]=item; else updated.push(item);
   await persistRoutes(updated); toast('下载线路已保存');
  });
 });
}
async function persistRoutes(routes) { await api('/api/routes',{method:'PUT',body:JSON.stringify({routes})}); await loadState(); await loadReleases(); renderRoutes(); }
function openModal(content) { $('#modal-content').innerHTML = content; if (!$('#modal').open) $('#modal').showModal(); }
function modalHead(title, subtitle) { return `<div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭弹窗">×</button></div>`; }
function openPublish() {
 if (!project()?.has_token) { changePage('settings'); return; }
 selectedFiles=[]; prepared=null; importText='';
 openModal(modalHead('发布新版本',esc(project().repo)+' · 先检查内容，再发布到 GitHub')+`<form id="publish-form"><div class="modal-body"><div class="form-grid"><div class="field"><label for="version">版本号<span class="required">*</span></label><input name="version" id="version" placeholder="1.2.0" required><p class="field-help">不带 v 前缀。beta 等后缀自动标记为预发布。</p></div><div class="field"><label for="release-title">发布标题</label><input name="title" id="release-title" placeholder="例如：v1.2.0 — 新增批量导出" maxlength="200"></div></div><div class="field"><div class="row-between"><label for="release-notes">版本说明<span class="required">*</span></label><label class="button small import-label">导入 release.md<input type="file" id="manifest-input" accept=".md,.markdown,text/markdown"></label></div><textarea id="release-notes" name="notes" rows="7" required placeholder="## 新增&#10;- 本次版本的新功能&#10;&#10;## 修复&#10;- 修复的问题"></textarea><p id="import-hint" class="field-help">支持 Markdown，附件的 SHA-256 将自动计算。</p></div><div class="field"><label for="target-commit">目标提交 SHA（可选）</label><input id="target-commit" name="target_commit" placeholder="留空使用已配置分支的当前提交" maxlength="40"></div><div class="field"><label>发布附件<span class="required">*</span></label><div class="dropzone" id="dropzone"><strong>点击选择，或将安装包拖到这里</strong><small>可选择多个文件 · 单文件小于 2 GiB · 英文文件名</small><input id="asset-input" type="file" multiple aria-label="选择发布附件"></div><div id="selected-files"></div></div><div id="prepare-error"></div><div class="hidden" id="local-upload"><p class="field-help">${browserMode?'正在浏览器中计算 SHA-256，文件不会上传…':'正在上传到本机并计算校验值…'}</p><progress id="local-progress" value="0" max="100"></progress></div></div><div class="modal-footer"><span class="micro muted">检查内容不会创建 GitHub Release</span><div class="actions"><button type="button" class="button" data-action="close-modal">取消</button><button type="submit" class="button primary">检查发布内容 ${icon('arrow')}</button></div></div></form>`);
 $('#asset-input').addEventListener('change',e=>{addFiles(e.target.files);e.target.value='';});
 const zone=$('#dropzone'); zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover');}); zone.addEventListener('dragleave',()=>zone.classList.remove('dragover')); zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragover');addFiles(e.dataTransfer.files);});
 $('#manifest-input').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f)return;
  if(f.size>100000){toast('版本说明不能超过 100 KB',true);return;}
  importText=await f.text();
  $('#release-notes').value=importText; $('#release-notes').readOnly=true;
  $('#version').required=false; $('#version').disabled=true; $('#release-title').disabled=true; $('#target-commit').disabled=true;
  $('#import-hint').textContent='将按导入文件中的版本号、说明和附件摘要进行校验。请同时选择清单中的所有附件。';
 });
 $('#publish-form').addEventListener('submit',prepareRelease);
}
function addFiles(files) {
 for(const f of files){const index=selectedFiles.findIndex(a=>a.name===f.name); if(index>=0)selectedFiles[index]=f; else selectedFiles.push(f);}
 $('#selected-files').innerHTML=selectedFiles.map((f,i)=>`<div class="file-preview"><span>${esc(f.name)}</span><span>${size(f.size)}</span><button type="button" data-remove-file="${i}" aria-label="移除 ${esc(f.name)}">×</button></div>`).join('');
}
function uploadForm(url, form) {
 if (browserMode) return window.ReleaseBrowser.prepare(projectId, form, value => {if ($('#local-progress')) $('#local-progress').value = value;});
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest(); xhr.open('POST',url); xhr.setRequestHeader('X-Release-Client','ReleaseDesk');
  xhr.upload.onprogress=e=>{if(e.lengthComputable && $('#local-progress'))$('#local-progress').value=e.loaded/e.total*100;};
  xhr.onload=()=>{let d;try{d=JSON.parse(xhr.responseText);}catch{reject(new Error('服务返回异常，请重试。'));return;}if(xhr.status>=200&&xhr.status<300)resolve(d);else reject(new Error(typeof d.detail==='string'?d.detail:'请检查输入内容。'));};
  xhr.onerror=()=>reject(new Error('本机连接中断，请检查服务是否运行。'));xhr.send(form);
 });
}
async function prepareRelease(e) {
 e.preventDefault(); if(!selectedFiles.length){toast('请先选择发布附件',true);return;}
 const button=e.submitter, form=new FormData(e.target);
 form.set('manifest',importText); for(const f of selectedFiles)form.append('files',f,f.name);
 pending=true; $('#local-upload').classList.remove('hidden'); $('#prepare-error').innerHTML='';
 try { button.disabled=true; prepared=await uploadForm(`/api/projects/${projectId}/prepare`,form); showPreview(); }
 catch(err){$('#prepare-error').innerHTML=`<div class="error-box space-top">${esc(err.message)}</div>`;}
 finally{pending=false;button.disabled=false;$('#local-upload')?.classList.add('hidden');}
}
function showPreview() {
 const s=prepared.spec;
 openModal(modalHead('发布内容已就绪',esc(project().repo)+' · '+esc(s.tag))+`<div class="modal-body"><div class="success-box">${browserMode?'附件清单与 SHA-256 已在浏览器中校验。下一步创建 GitHub 草稿，然后上传附件并返回核对发布。':'附件清单与 SHA-256 已校验。点击「发布到 GitHub」后，将创建草稿、上传全部附件，再正式发布。'}</div><h3 class="modal-subtitle">${esc(s.title)} <span class="badge ${s.prerelease?'purple':'green'}">${s.prerelease?'预发布':'稳定版'}</span></h3><div class="markdown">${prepared.notes_html}</div><h3 class="modal-subtitle">${s.assets.length} 个发布附件 + 自动生成的 SHA256SUMS</h3><div class="asset-list">${s.assets.map(a=>`<div class="asset-row">${icon('file')}<div><div class="asset-name">${esc(a.name)} · ${size(a.size)}</div><div class="field-help mono">${a.sha256}</div></div></div>`).join('')}</div><p class="field-help">目标：${esc(s.target_commit || project().branch)}。同版本已有不同内容时会停止，不覆盖现有发布。</p><div id="publish-error"></div></div><div class="modal-footer"><button class="button" data-action="download-manifest">下载 release.md</button><button class="button primary" data-action="confirm-publish">${icon('upload')}${browserMode?'创建 GitHub 草稿':'发布到 GitHub'}</button></div>`);
}
async function confirmPublish(button) {
 await busy(button,async()=>{
  pending=true;
  try {await api(`/api/projects/${projectId}/publish/${prepared.id}`,{method:'POST'});$('#modal').close();await loadState();changePage('jobs');toast('发布任务已创建，可在这里查看进度。');}
  finally{pending=false;}
 });
}
function downloadText(content, name) {
 const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function checkText(check) {
 if(!check)return browserMode?'尚未检测 · 请打开链接验证；静态版不提供跨域自动测速':'尚未检测 · 点击检测查看本机连接结果';
 const stale=Date.now()-new Date(check.checked_at).getTime()>15*60*1000;
 return `${stale?'历史检测 · ':''}${check.source} · ${date(check.checked_at)} · ${check.elapsed_ms} ms · ${check.message}`;
}
function showAsset(id) {
 const release=releases.find(r=>(r.assets||[]).some(a=>String(a.id)===String(id)));
 const a=release?.assets.find(a=>String(a.id)===String(id)); if(!a)return;
 modalAsset=a.id;
 const reason=proxyRestriction(release);
 const blocked=reason ? state.routes.filter(r=>r.enabled).map(r=>`<div class="route-download route-unavailable"><div class="row-between"><div class="route-name">${esc(r.name)} <span class="badge orange">当前附件不适用</span></div><span class="micro muted">未生成下载链接</span></div><p class="field-help">${reason}</p></div>`).join('') : '';
 openModal(modalHead('下载线路',esc(a.name)+' · '+size(a.size))+`<div class="modal-body">${proxyNotice(release)}${a.digest?`<p class="field-help mono space-bottom">${esc(a.digest)}</p>`:''}${a.routes.map(r=>`<div class="route-download"><div class="row-between"><div class="route-name">${esc(r.name)} <span class="badge ${r.type==='original'?'':'orange'}">${r.type==='original'?'原始地址':'下载代理'}</span></div><div class="download-actions">${browserMode?'':`<button class="button small" data-probe="${esc(r.id)}" ${project().private || release.draft?'disabled':''}>检测</button>`}<button class="button small" data-copy="${esc(r.url)}">复制</button><a class="button small primary" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">下载 ↗</a></div></div><code class="route-url">${esc(r.url)}</code><div class="route-check">${reason?'需要 GitHub 访问权限，未进行公开线路检测':esc(checkText(r.check))}</div></div>`).join('') || '<div class="note-box">当前附件没有可展示的下载地址。</div>'}${blocked}<p class="field-help space-top">代理线路可在「下载线路」中配置。${project().private?'私有附件下载需要浏览器登录有权限的 GitHub 账户。':(browserMode?'静态版请直接打开链接验证可用性，下载后可用 SHA-256 核对文件。':'检测只读取少量数据，不代表完整文件已校验或所有地区都可访问。')}</p></div>`);
}
async function handleAction(action, el) {
 if(action==='add-project'){editingNew=true;changePage('settings');}
 if(action==='new-release')openPublish();
 if(action==='sync')await busy(el,async()=>{await api(`/api/projects/${projectId}/sync`,{method:'POST'});await loadState();await loadReleases();renderReleases();toast('GitHub 版本已同步');});
 if(action==='toggle-key'){const input=$('#api-key');input.type=input.type==='password'?'text':'password';el.textContent=input.type==='password'?'显示':'隐藏';}
 if(action==='test-connection'){
  if(!$('#config-form').reportValidity())return;
  await busy(el,async()=>{const result=await api('/api/projects/test',{method:'POST',body:JSON.stringify(configPayload())});$('#connection-result').innerHTML=`<div class="success-box">${esc(result.repository)} · ${result.private?'私有仓库':'公开仓库'}<br>${esc(result.message)}</div>`;});
 }
 if(action==='clear-key'){
  openModal(modalHead('清除 API Key',browserMode?'清除此仓库在浏览器中的 Token，保留发布记录':'仅清除此仓库的本机凭据，保留历史记录')+`<div class="modal-body"><p class="subtitle">${browserMode?'清除后需重新填写 Token 才能管理此仓库；版本缓存与任务记录仍保留在浏览器。':'清除后，目录监听会关闭。重新填写 API Key 后可以继续管理。'}</p></div><div class="modal-footer"><button class="button" data-action="close-modal">取消</button><button class="button danger" data-action="confirm-clear-key">清除凭据</button></div>`);
 }
 if(action==='confirm-clear-key')await busy(el,async()=>{await api(`/api/projects/${projectId}/credential`,{method:'DELETE'});$('#modal').close();await loadState();renderSettings();toast('凭据已清除');});
 if(action==='close-modal'){if(pending){toast('正在处理文件，请稍候');return;}$('#modal').close();}
 if(action==='reset-route'){$('#route-form').reset();$('#route-form input[name=id]').value='';$('#route-form h3').textContent='添加代理线路';}
 if(action==='confirm-publish')await confirmPublish(el);
 if(action==='download-manifest')downloadText(prepared.manifest,'release.md');
}
document.addEventListener('click',async e=>{
 const el=e.target.closest('button,a');if(!el)return;
 try{
  if(el.dataset.page){editingNew=false;changePage(el.dataset.page);}
  if(el.dataset.action)await handleAction(el.dataset.action,el);
  if(el.dataset.filter){filter=el.dataset.filter;renderReleases();}
  if(el.dataset.asset)showAsset(el.dataset.asset);
  if(el.dataset.copy){await navigator.clipboard.writeText(el.dataset.copy);toast('下载地址已复制');}
  if(el.dataset.removeFile!==undefined){selectedFiles.splice(Number(el.dataset.removeFile),1);addFiles([]);}
  if(el.dataset.retry)await busy(el,async()=>{await api(`/api/jobs/${el.dataset.retry}/retry`,{method:'POST'});await loadState();renderJobs();});
  if(el.dataset.jobManifest && browserMode) downloadText(window.ReleaseBrowser.getJob(el.dataset.jobManifest).manifest,'release.md');
  if(el.dataset.jobSums) downloadText(window.ReleaseBrowser.getJob(el.dataset.jobSums).sums,'SHA256SUMS');
  if(el.dataset.jobCommand){await navigator.clipboard.writeText(window.ReleaseBrowser.commandFor(window.ReleaseBrowser.getJob(el.dataset.jobCommand)));toast('上传命令已复制');}
  if(el.dataset.jobFinish) await busy(el,async()=>{try{await api(`/api/jobs/${el.dataset.jobFinish}/finish`,{method:'POST'});toast('附件校验通过，版本已发布');}finally{await loadState();await loadReleases();renderJobs();}});
  if(el.dataset.jobManifest && !browserMode){const r=await fetch(`/api/jobs/${el.dataset.jobManifest}/manifest`,{headers:{'X-Release-Client':'ReleaseDesk'}});if(!r.ok)throw new Error('导出失败');downloadText(await r.text(),'release.md');}
  if(el.dataset.routeToggle){const routes=structuredClone(state.routes);const r=routes.find(x=>x.id===el.dataset.routeToggle);r.enabled=!r.enabled;await persistRoutes(routes);}
  if(el.dataset.routeDelete)await persistRoutes(state.routes.filter(r=>r.id!==el.dataset.routeDelete));
  if(el.dataset.routeUp!==undefined){const routes=structuredClone(state.routes),i=Number(el.dataset.routeUp);if(i>0){[routes[i-1],routes[i]]=[routes[i],routes[i-1]];await persistRoutes(routes);}}
  if(el.dataset.routeEdit){const r=state.routes.find(r=>r.id===el.dataset.routeEdit);const form=$('#route-form');form.elements.id.value=r.id;form.elements.name.value=r.name;form.elements.template.value=r.template;$('h3',form).textContent='编辑代理线路';form.scrollIntoView({behavior:'smooth',block:'center'});}
  if(el.dataset.probe)await busy(el,async()=>{await api(`/api/projects/${projectId}/assets/${modalAsset}/probe/${el.dataset.probe}`,{method:'POST'});await loadReleases();showAsset(modalAsset);});
 }catch(err){toast(err.message,true);}
});
document.addEventListener('input',e=>{if(e.target.id==='release-search'){search=e.target.value;renderReleaseList();}});
$('#add-project').addEventListener('click',()=>{editingNew=true;changePage('settings');});
$('#project-picker').addEventListener('change',async e=>{projectId=e.target.value;editingNew=false;search='';try{await loadReleases();render();}catch(err){toast(err.message,true);}});
$('#modal').addEventListener('cancel',e=>{if(pending)e.preventDefault();});
window.openJobLogs=new Set();
document.addEventListener('toggle',e=>{const id=e.target.dataset?.log;if(id){if(e.target.open)window.openJobLogs.add(id);else window.openJobLogs.delete(id);}},true);
async function tick(){
 if(pending||document.hidden)return;
 try{
  await loadState();const signature=JSON.stringify(jobs().map(j=>[j.id,j.status]));
  if(signature!==lastJobState){lastJobState=signature;await loadReleases();if(page==='releases')renderReleases();}
  if(page==='jobs')renderJobs();
 }catch{/* Keep usable state on temporary local connection loss. */}
}
(async()=>{try{await loadState();await loadReleases();render();setInterval(tick,4000);}catch(err){$('#main').innerHTML=empty(browserMode?'暂时无法读取浏览器工作空间':'暂时无法连接本机服务',esc(err.message),'<a class="button" href="./">重新加载</a>');}})();
