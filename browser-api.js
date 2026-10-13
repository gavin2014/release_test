/* Pure static adapter. Credentials are sent only to api.github.com. */
(() => {
 'use strict';
 const scope = `release-desk:${new URL('.', location.href).pathname}:v2:`;
 const now = () => new Date().toISOString();
 const clone = value => structuredClone(value);
 const encoder = new TextEncoder();
 const previews = new Map();
 const markdown = window.markdownit({html:false, linkify:false, breaks:true});
 // Avoid remote image requests from untrusted release notes in a credential-bearing page.
 markdown.disable('image');
 markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, index, options);
 };
 const renderNotes = text => markdown.render(String(text || '').replace(/<!-- release-desk-browser:[\s\S]*?-->/g, ''));
 function readState() {
  const raw = localStorage.getItem(scope + 'workspace');
  if (!raw) return {projects:[], jobs:[], releases:{}, routes:null};
  try {
   const value = JSON.parse(raw);
   if (!Array.isArray(value.projects) || !Array.isArray(value.jobs) || !value.releases) throw new Error();
   return value;
  } catch { throw new Error('浏览器中的工作空间数据无法读取。请先备份站点存储，再清除此站点数据。'); }
 }
 function saveState(value) {
  try { localStorage.setItem(scope + 'workspace', JSON.stringify(value)); }
  catch { throw new Error('浏览器存储不可用或空间不足，请允许此站点保存数据后重试。'); }
 }
 const credentialKey = id => scope + 'credential:' + id;
 const tokenFor = id => sessionStorage.getItem(credentialKey(id)) || localStorage.getItem(credentialKey(id)) || '';
 function setToken(id, token, mode) {
  const keep = mode === 'local' ? localStorage : sessionStorage;
  const remove = mode === 'local' ? sessionStorage : localStorage;
  // Write first; do not discard an existing credential if the storage is full.
  keep.setItem(credentialKey(id), token);
  remove.removeItem(credentialKey(id));
 }
 function clearToken(id) {
  sessionStorage.removeItem(credentialKey(id));
  localStorage.removeItem(credentialKey(id));
 }
 function findProject(db, id) {
  const p = db.projects.find(item => item.id === id);
  if (!p) throw new Error('未找到此仓库，请重新选择。');
  return p;
 }
 function parseRepo(text) {
  const value = String(text || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/^git@github\.com:/i, '').replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value) || value.split('/')[1] === '..') throw new Error('请输入 GitHub 仓库地址或 owner/repository。');
  return value;
 }
 const repoPath = repo => '/repos/' + repo.split('/').map(encodeURIComponent).join('/');
 async function github(path, token, method = 'GET', body) {
  if (!path.startsWith('/repos/') || path.startsWith('//')) throw new Error('GitHub 请求地址无效。');
  let response;
  try {
   response = await fetch('https://api.github.com' + path, {
    method, credentials:'omit', redirect:'error', referrerPolicy:'no-referrer',
    headers:{Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28',
     ...(token ? {Authorization:'Bearer ' + token} : {}), ...(body !== undefined ? {'Content-Type':'application/json'} : {})},
    ...(body !== undefined ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(60000)
   });
  } catch { throw new Error('无法连接 GitHub API，请检查网络后重试。若上次请求已完成，会核对远端结果后恢复。'); }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
   const hints = {401:'Token 无效或已过期，请在仓库配置中更新。',403:'访问被拒绝，请检查 Token 权限、组织审批或 API 频率限制。',404:'资源不存在，或当前 Token 无权访问。',422:'GitHub 未接受内容，请检查版本、提交或仓库权限。'};
   const error = new Error(`GitHub HTTP ${response.status}：${hints[response.status] || '请求失败，请稍后重试。'}`);
   error.status = response.status;
   throw error;
  }
  return data;
 }
 async function list(path, token) {
  const result = [];
  for (let page = 1; page <= 100; page++) {
   const items = await github(`${path}?per_page=100&page=${page}`, token);
   if (!Array.isArray(items)) throw new Error('GitHub 返回了无法识别的列表。');
   result.push(...items);
   if (items.length < 100) return result;
  }
  throw new Error('列表超过 10000 条，请在 GitHub 中管理更早的记录。');
 }
 function validateRoute(route) {
  const name = String(route.name || '').trim(), template = String(route.template || '').trim();
  if (!name || name.length > 60 || template.length > 500) throw new Error('线路名称或地址长度不符合要求。');
  if ((template.match(/\{url\}|\{url_encoded\}/g) || []).length !== 1 || /[{}]/.test(template.replace(/\{url\}|\{url_encoded\}/g, ''))) throw new Error('模板须包含一个 {url} 或 {url_encoded}。');
  let url;
  try { url = new URL(template); } catch { throw new Error('代理地址无效。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || /[{}]/.test(url.host)) throw new Error('代理必须使用固定域名和不含凭据的标准 HTTPS 地址。');
  return {id:route.id || crypto.randomUUID(), name, template, enabled:!!route.enabled};
 }
 function links(asset, routes, privateRepo, draft) {
  let original;
  try { original = new URL(asset.browser_download_url); } catch { return []; }
  if (original.protocol !== 'https:' || original.host !== 'github.com' || !original.pathname.includes('/releases/download/')) return [];
  const result = [{id:'github', name:'GitHub 原始下载', type:'original', url:original.href}];
  if (!privateRepo && !draft) for (const route of routes.filter(r => r.enabled)) result.push({id:route.id, name:route.name, type:'proxy', url:route.template.replace('{url}', original.href).replace('{url_encoded}', encodeURIComponent(original.href))});
  return result;
 }
 function releasesFor(db, p) {
  return (db.releases[p.id] || []).map(r => ({...r, body_html:renderNotes(r.body), assets:(r.assets || []).map(a => ({...a, routes:links(a, db.routes, p.private, r.draft)}))}));
 }
 async function synchronize(db, p) {
  const token = tokenFor(p.id), root = repoPath(p.repo);
  const metadata = await github(root, token);
  const releases = await list(root + '/releases', token);
  // Whitelist API fields: never persist headers, credentials or fetch responses.
  db.releases[p.id] = releases.map(r => ({id:r.id, name:r.name, tag_name:r.tag_name, body:r.body, html_url:r.html_url,
   draft:r.draft, prerelease:r.prerelease, created_at:r.created_at, published_at:r.published_at,
   assets:r.assets.map(a => ({id:a.id, name:a.name, size:a.size, digest:a.digest, state:a.state, download_count:a.download_count, browser_download_url:a.browser_download_url}))}));
  p.private = metadata.private; p.synced_at = now(); p.sync_error = '';
  saveState(db);
 }
 async function connected(body, db) {
  const repo = parseRepo(body.repository);
  const old = body.id ? findProject(db, body.id) : db.projects.find(p => p.repo.toLowerCase() === repo.toLowerCase());
  if (old && old.repo.toLowerCase() !== repo.toLowerCase()) throw new Error('请添加新项目来管理其他仓库。');
  const token = String(body.api_key || '').trim() || (old ? tokenFor(old.id) : '');
  if (!token || /\s/.test(token)) throw new Error('请填写有效的 API Key。');
  const metadata = await github(repoPath(repo), token);
  const branch = String(body.branch || metadata.default_branch).trim();
  const commit = await github(repoPath(repo) + '/commits/' + encodeURIComponent(branch), token);
  if (!/^[0-9a-f]{40}$/i.test(commit.sha)) throw new Error('无法解析目标分支的提交。');
  return {old, token, metadata, branch};
 }
 const init = (async () => {
  const db = readState();
  if (!db.routes) {
   const response = await fetch('./default-routes.json', {credentials:'omit'});
   if (!response.ok) throw new Error('无法读取默认下载线路。');
   db.routes = (await response.json()).map(validateRoute); saveState(db);
  }
 })();
 // A rejected initialization is surfaced by request(), without an unhandled rejection.
 init.catch(() => {});
 async function hashFile(file, progress) {
  const h = window.sha256.create();
  for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
   const bytes = await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer();
   h.update(bytes); progress(bytes.byteLength);
  }
  return h.hex();
 }
 function manifest(spec) {
  const meta = {schema_version:1, version:spec.version, title:spec.title, status:'ready',
   ...(spec.target_commit ? {target_commit:spec.target_commit} : {}), assets:spec.assets.map(a => ({file:'assets/' + a.name, sha256:a.sha256}))};
  return '---\n' + window.jsyaml.dump(meta, {noRefs:true, lineWidth:-1}) + '---\n\n' + spec.notes + '\n';
 }
 async function prepare(id, form, progress = () => {}) {
  await init; findProject(readState(), id);
  const imported = String(form.get('manifest') || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let notes = String(form.get('notes') || '').trim(), meta = {};
  if (imported) {
   if (encoder.encode(imported).length > 100000) throw new Error('版本说明不能超过 100 KB。');
   const match = imported.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
   if (!match) throw new Error('release.md 须以 --- 包围的 YAML 配置开头。');
   try { meta = window.jsyaml.load(match[1], {schema:window.jsyaml.JSON_SCHEMA}); }
   catch { throw new Error('版本说明顶部的 YAML 格式错误。'); }
   if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.schema_version !== 1 || !['ready','draft'].includes(meta.status)) throw new Error('schema_version 必须为 1，status 必须为 ready 或 draft。');
   notes = match[2].trim();
  }
  const version = String(imported ? meta.version || '' : form.get('version') || '');
  const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
  if (!match || (match[4] && match[4].split('.').some(x => /^0\d+$/.test(x)))) throw new Error('版本号须为 1.2.0 或 1.2.0-beta.1 格式，不带 v 前缀。');
  const title = (imported ? meta.title : form.get('title')) || 'v' + version;
  const target = (imported ? meta.target_commit : form.get('target_commit')) || '';
  if (typeof title !== 'string' || title.length > 200) throw new Error('标题须为 200 字以内的文本。');
  if (typeof target !== 'string' || (target && !/^[0-9a-f]{40}$/i.test(target))) throw new Error('目标提交须为完整的 40 位 Git SHA。');
  if (!notes || encoder.encode(notes).length > 100000) throw new Error('请填写不超过 100 KB 的更新说明。');
  const files = form.getAll('files'), names = new Set();
  if (!files.length || files.length > 100) throw new Error('每个版本须包含 1 至 100 个附件。');
  let expected = null;
  if (imported) {
   if (!Array.isArray(meta.assets) || meta.assets.length !== files.length) throw new Error('所选附件须与导入清单完全一致。');
   expected = new Map();
   for (const a of meta.assets) {
    if (!a || typeof a.file !== 'string' || !/^assets\/[^/\\]+$/.test(a.file) || typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(a.sha256) || expected.has(a.file.slice(7))) throw new Error('导入清单中的附件路径、摘要或名称无效。');
    expected.set(a.file.slice(7), a.sha256.toLowerCase());
   }
  }
  let completed = 0; const total = files.reduce((sum, f) => sum + f.size, 0), assets = [];
  for (const file of files) {
   if (!(file instanceof File) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(file.name) || file.name.endsWith('.') || /^(SHA256SUMS)$/i.test(file.name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(file.name)) throw new Error('附件名不符合规范，请使用英文字母、数字、点、短横线或下划线。');
   if (names.has(file.name.toLowerCase())) throw new Error('附件名称重复。');
   names.add(file.name.toLowerCase());
   if (!file.size || file.size >= 2 * 1024 ** 3) throw new Error('附件不能为空且单文件必须小于 2 GiB。');
   const digest = await hashFile(file, n => {completed += n; progress(completed / total * 100);});
   if (expected && expected.get(file.name) !== digest) throw new Error(file.name + ' 未在清单中，或 SHA-256 不匹配。');
   assets.push({name:file.name, size:file.size, sha256:digest});
  }
  assets.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const spec = {version, tag:'v' + version, title:title.trim(), notes, target_commit:target.toLowerCase(), prerelease:version.includes('-'), assets};
  const result = {id:crypto.randomUUID(), project_id:id, spec, manifest:manifest(spec), notes_html:renderNotes(notes)};
  previews.set(result.id, result);
  return clone(result);
 }
 function addLog(job, message) { job.step = message; job.logs.push({time:now(), message}); }
 async function tagCommit(root, token, tag) {
  let ref;
  try { ref = (await github(root + '/git/ref/tags/' + encodeURIComponent(tag), token)).object; }
  catch (e) { if (e.status === 404) return ''; throw e; }
  for (let i = 0; ref.type === 'tag' && i < 10; i++) ref = (await github(root + '/git/tags/' + ref.sha, token)).object;
  if (ref.type !== 'commit') throw new Error('无法解析现有 Tag，请在 GitHub 检查。');
  return ref.sha;
 }
 function owned(release, job) {
  if (release.tag_name !== job.spec.tag || !String(release.body || '').includes(job.marker)) throw new Error('同版本已存在其他 Release；不会覆盖，请使用新版本号。');
 }
 async function ensureDraft(db, p, job) {
  const token = tokenFor(p.id), root = repoPath(p.repo);
  if (!token) throw new Error('请先在仓库配置中填写 API Key。');
  if (!job.commit) {
   const commit = await github(root + '/commits/' + encodeURIComponent(job.spec.target_commit || p.branch), token);
   job.commit = commit.sha; saveState(db);
  }
  const tag = await tagCommit(root, token, job.spec.tag);
  if (tag && tag !== job.commit) throw new Error('现有 Tag 指向不同提交，任务已停止。不会移动 Tag。');
  let release;
  if (job.release_id) release = await github(root + '/releases/' + job.release_id, token);
  else release = (await list(root + '/releases', token)).find(r => r.tag_name === job.spec.tag);
  if (release) owned(release, job);
  else release = await github(root + '/releases', token, 'POST', {
   tag_name:job.spec.tag, target_commitish:job.commit, name:job.spec.title,
   body:job.spec.notes + '\n\n' + job.marker, draft:true, prerelease:job.spec.prerelease
  });
  owned(release, job);
  job.release_id = release.id; job.release_url = release.html_url;
  job.edit_url = release.html_url.replace('/releases/tag/', '/releases/edit/');
  job.status = 'awaiting_upload'; job.error = '';
  addLog(job, release.draft ? '草稿已保存。请上传安装包与 SHA256SUMS，然后核对并发布。' : '远端版本已发布，请核对附件以完成本地记录。');
  saveState(db);
  return release;
 }
 async function startJob(db, p, previewId) {
  const preview = previews.get(previewId);
  if (!preview || preview.project_id !== p.id) throw new Error('预览已失效，请重新选择附件检查。');
  const fingerprint = window.sha256(JSON.stringify(preview.spec));
  let job = db.jobs.find(j => j.project_id === p.id && j.spec.version === preview.spec.version);
  if (job && job.fingerprint !== fingerprint) throw new Error('同版本已提交不同内容，请使用新版本号。');
  if (job && !['failed','queued'].includes(job.status)) return clone(job);
  if (!job) {
   const id = crypto.randomUUID();
   const sums = preview.spec.assets.map(a => `${a.sha256}  ${a.name}\n`).join('');
   job = {id, project_id:p.id, repo:p.repo, spec:clone(preview.spec), fingerprint, marker:`<!-- release-desk-browser:${id}:${fingerprint} -->`,
    sums, manifest:preview.manifest, created_at:now(), status:'queued', step:'正在创建草稿', error:'', logs:[], uploaded:[],
    assets:[...clone(preview.spec.assets), {name:'SHA256SUMS', size:encoder.encode(sums).length, sha256:window.sha256(sums)}]};
   db.jobs.unshift(job); saveState(db);
  }
  try { await ensureDraft(db, p, job); }
  catch (e) {job.status = 'failed'; job.error = e.message; addLog(job, '创建草稿未完成，可重试恢复。'); saveState(db); throw e;}
  return clone(job);
 }
 async function finishJob(db, p, job) {
  try {
   const release = await ensureDraft(db, p, job), root = repoPath(p.repo), token = tokenFor(p.id);
   const assets = await list(root + '/releases/' + release.id + '/assets', token);
   if (assets.length !== job.assets.length) throw new Error(`附件数量不一致：需要 ${job.assets.length} 个，GitHub 上有 ${assets.length} 个。请上传全部文件及 SHA256SUMS。`);
   job.uploaded = [];
   for (const expected of job.assets) {
    const asset = assets.find(a => a.name === expected.name);
    if (!asset || asset.size !== expected.size || asset.state !== 'uploaded') throw new Error(`${expected.name} 缺失、大小不匹配或上传未完成。`);
    if (!asset.digest) throw new Error(`${expected.name} 暂无 GitHub SHA-256。请稍后重试，或在 GitHub 重新上传后再核对。`);
    if (asset.digest.toLowerCase() !== 'sha256:' + expected.sha256) throw new Error(`${expected.name} 的 SHA-256 不匹配，请重新上传正确文件。`);
    job.uploaded.push(expected.name);
   }
   const tag = await tagCommit(root, token, job.spec.tag);
   if (tag && tag !== job.commit) throw new Error('现有 Tag 指向不同提交，请检查仓库。');
   if (!tag && !release.draft) throw new Error('已发布版本的 Tag 不存在，请在 GitHub 检查。');
   if (release.draft) {
    const published = await github(root + '/releases/' + release.id, token, 'PATCH', {draft:false});
    if (published.draft) throw new Error('GitHub 尚未完成发布，请稍后重试。');
    job.release_url = published.html_url;
   }
   job.status = 'success'; job.error = ''; addLog(job, '全部附件与 SHA-256 一致，版本已正式发布。'); saveState(db);
   try { await synchronize(db, p); } catch { p.sync_error = '版本已发布，稍后点击同步版本刷新列表。'; saveState(db); }
   return clone(job);
  } catch (e) {
   job.status = 'awaiting_upload'; job.error = e.message; addLog(job, '等待补齐附件或重试核对。'); saveState(db); throw e;
  }
 }
 function commandFor(job) {
  const quote = value => '"' + String(value).replace(/"/g, '') + '"';
  return `gh release upload ${quote(job.spec.tag)} ${job.assets.map(a => quote('./' + a.name)).join(' ')} --repo ${quote(job.repo)}`;
 }
 async function dispatch(path, opts) {
  await init;
  const db = readState(), method = opts.method || 'GET', body = opts.body ? JSON.parse(opts.body) : {};
  const segments = path.split('/').filter(Boolean);
  if (path === '/api/state') return {projects:db.projects.map(p => ({...p, has_token:!!tokenFor(p.id), storage_mode:localStorage.getItem(credentialKey(p.id)) ? 'local' : 'session'})), jobs:clone(db.jobs), routes:clone(db.routes)};
  if (path === '/api/projects/test') {
   const c = await connected(body, db); return {repository:c.metadata.full_name, private:c.metadata.private, message:'可以读取仓库；正式发布时将检查写入权限。'};
  }
  if (path === '/api/projects' && method === 'POST') {
   const {old, token, metadata, branch} = await connected(body, db);
   const p = old || {id:crypto.randomUUID(), repo:metadata.full_name};
   Object.assign(p, {name:String(body.name || metadata.name).trim(), branch, private:metadata.private, watch:false});
   setToken(p.id, token, body.storage_mode === 'local' ? 'local' : 'session');
   if (!old) db.projects.push(p);
   saveState(db);
   try { await synchronize(db, p); } catch (e) {p.sync_error = e.message; saveState(db);}
   return clone(p);
  }
  if (path === '/api/routes' && method === 'PUT') {
   if (!Array.isArray(body.routes) || body.routes.length > 30) throw new Error('最多配置 30 条代理线路。');
   const routes = body.routes.map(validateRoute);
   if (new Set(routes.map(r => r.id)).size !== routes.length) throw new Error('线路 ID 重复。');
   db.routes = routes; saveState(db); return {routes};
  }
  if (segments[1] === 'projects') {
   const p = findProject(db, segments[2]);
   if (segments[3] === 'releases') return {releases:releasesFor(db, p)};
   if (segments[3] === 'sync') {await synchronize(db, p); return {ok:true};}
   if (segments[3] === 'credential' && method === 'DELETE') {clearToken(p.id); return {ok:true};}
   if (segments[3] === 'publish') return startJob(db, p, segments[4]);
  }
  if (segments[1] === 'jobs') {
   const job = db.jobs.find(j => j.id === segments[2]);
   if (!job) throw new Error('未找到此任务。');
   const p = findProject(db, job.project_id);
   if (segments[3] === 'finish') return finishJob(db, p, job);
   if (segments[3] === 'retry') {
    try {await ensureDraft(db, p, job); return clone(job);}
    catch(e) {job.status = 'failed'; job.error = e.message; saveState(db); throw e;}
   }
  }
  throw new Error('此操作需要本机版支持。');
 }
 async function request(path, opts = {}) {
  // Serialize network mutations across tabs sharing this workspace.
  if ((opts.method || 'GET') !== 'GET' && navigator.locks) return navigator.locks.request(scope + 'mutation', () => dispatch(path, opts));
  return dispatch(path, opts);
 }
 window.ReleaseBrowser = {request, prepare, manifest, commandFor, renderNotes,
  publicUrl:repo => './download.html?repo=' + encodeURIComponent(repo),
  getJob:id => clone(readState().jobs.find(j => j.id === id))};
})();
