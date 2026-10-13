const escapeText = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink = v => {try{const u=new URL(v);return u.protocol==='https:'?u.href:'#';}catch{return '#';}};
const formatSize = n => n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${(n/1024).toFixed(1)} KB`;
async function browserPublicData() {
 const repo = new URLSearchParams(location.search).get('repo') || '';
 if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('下载页面缺少有效的仓库地址，请从管理台打开。');
 const root = 'https://api.github.com/repos/' + repo.split('/').map(encodeURIComponent).join('/');
 async function get(url) {
  const response = await fetch(url, {credentials:'omit', referrerPolicy:'no-referrer', redirect:'error', headers:{Accept:'application/vnd.github+json'}});
  if (!response.ok) throw new Error(response.status === 403 ? 'GitHub API 访问受限，请稍后重试。' : '无法读取公开下载信息，请检查网络和仓库地址。');
  return response.json();
 }
 // The public page never reads or sends credentials from the manager's storage.
 const project = await get(root);
 if (project.private) throw new Error('私有仓库不提供公开下载页面。');
 const routes = await get('./default-routes.json'), releases = [];
 for (let page = 1; page <= 100; page++) {
  const items = await get(root + `/releases?per_page=100&page=${page}`);
  releases.push(...items.filter(r => !r.draft));
  if (items.length < 100) break;
 }
 const renderer = window.markdownit({html:false, linkify:false, breaks:true}).disable('image');
 renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('rel', 'noopener noreferrer'); tokens[index].attrSet('target', '_blank');
  return self.renderToken(tokens, index, options);
 };
 return {project:{name:project.name, repo:project.full_name}, synced_at:new Date().toISOString(), releases:releases.map(r => ({...r,
  body_html:renderer.render(String(r.body || '').replace(/<!-- release-desk-browser:[\s\S]*?-->/g, '')),
  assets:(r.assets || []).map(a => {
   const url = safeLink(a.browser_download_url), parsed = new URL(url, location.href);
   if (parsed.host !== 'github.com' || !parsed.pathname.includes('/releases/download/')) return {...a, routes:[]};
   return {...a, routes:[{name:'GitHub 原始下载', type:'original', url}, ...routes.filter(r => r.enabled).map(r => ({name:r.name, type:'proxy', url:r.template.replace('{url}', url).replace('{url_encoded}', encodeURIComponent(url))}))]};
  })
 }))};
}
async function load() {
 const id=location.pathname.split('/').pop(), main=document.querySelector('#public-main');
 try {
  let data;
  if (document.querySelector('meta[name="release-desk-mode"]')?.content === 'browser') data = await browserPublicData();
  else {const res=await fetch(`/api/public/${encodeURIComponent(id)}`);if(!res.ok)throw new Error('此项目暂无公开的下载信息。');data=await res.json();}
  document.title=`${data.project.name} · 下载`;
  main.innerHTML=`<div class="page-heading"><div><p class="eyebrow">DOWNLOAD CENTER</p><h1>${escapeText(data.project.name)}</h1><p class="subtitle">选择版本与安装包，再选择适合你的下载线路。</p></div><a class="button" href="https://github.com/${escapeText(data.project.repo)}" target="_blank" rel="noopener noreferrer">GitHub 仓库 ↗</a></div><section class="panel">${data.releases.map((r,i)=>`<details class="release" ${i===0?'open':''}><summary><span class="version-symbol">↗</span><div><div class="release-title">${escapeText(r.name||r.tag_name)}<span class="badge ${r.prerelease?'purple':'green'}">${r.prerelease?'预发布':'稳定版'}</span></div><div class="release-meta">${escapeText(r.tag_name)} · ${escapeText(new Date(r.published_at).toLocaleDateString('zh-CN'))}</div></div><span class="release-arrow">›</span></summary><div class="release-content"><div class="markdown release-body">${r.body_html}</div>${r.assets.map(a=>`<div class="route-download"><div class="row-between"><strong class="asset-name">${escapeText(a.name)}</strong><span class="micro muted">${formatSize(a.size)}</span></div>${a.digest?`<p class="field-help mono">${escapeText(a.digest)}</p>`:''}<div class="actions space-top">${a.routes.map(route=>`<a class="button small ${route.type==='original'?'':'primary'}" href="${escapeText(safeLink(route.url))}" target="_blank" rel="noopener noreferrer">${escapeText(route.name)} ↗</a><button class="button small" data-copy="${escapeText(route.url)}" aria-label="复制 ${escapeText(route.name)} 地址">复制</button>`).join('')}</div></div>`).join('')}</div></details>`).join('') || '<div class="empty"><h3>暂无公开版本</h3><p>新版本发布并同步后，会出现在这里。</p></div>'}</section><p class="field-help space-top">最近同步：${escapeText(data.synced_at?new Date(data.synced_at).toLocaleString('zh-CN'):'尚未同步')}。代理线路由项目管理者配置，实际下载情况取决于你所在的网络。</p>`;
 } catch(e){main.innerHTML=`<div class="empty"><h3>暂时无法显示下载</h3><p>${escapeText(e.message)}</p></div>`;}
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy]');if(!b)return;try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='已复制';setTimeout(()=>b.textContent='复制',1800);}catch{b.textContent='复制失败';}});
load();
