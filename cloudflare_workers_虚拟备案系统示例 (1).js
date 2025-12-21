// worker.js
// 轻量级虚拟备案系统（≤13KiB 设计）
// 功能：备案提交（校验+防重复）、备案查询
// Cloudflare Workers + KV

export default {
  async fetch(req, env) {
  const u = new URL(req.url);

  if (u.pathname === '/api/register' && req.method === 'POST')
    return reg(req, env);

  if (u.pathname === '/api/query' && req.method === 'GET')
    return query(u, env);

  if (u.pathname === '/api/admin/delete' && req.method === 'POST')
    return adminDelete(req, env);

  if (u.pathname === '/')
    return page();

  return new Response('404', { status: 404 });
}

};

// ===== 工具函数 =====
const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json;charset=utf-8' } });
const okDomain = d => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d);
const genId = () => 'VICP-' + Math.random().toString(36).slice(2, 10).toUpperCase();

// ===== 备案提交 =====
async function reg(req, env) {
  const { site, domain, owner } = await req.json();
  if (!site || !domain || !owner) return j({ err: '参数缺失' }, 400);
  if (!okDomain(domain)) return j({ err: '域名不合法' }, 400);

  // 防重复：域名只能备案一次
  const domainKey = 'D:' + domain;
  const exist = await env.RECORD_KV.get(domainKey);
  if (exist) return j({ err: '该域名已备案', recordId: exist }, 409);

  const id = genId();
  const data = { id, site, domain, owner, time: Date.now() };

  // 双索引存储
  await env.RECORD_KV.put(id, JSON.stringify(data));
  await env.RECORD_KV.put(domainKey, id);

  return j({ ok: true, recordId: id });
}

// ===== 查询备案 =====
async function query(u, env) {
  const id = u.searchParams.get('id');
  if (!id || !/^VICP-[A-Z0-9]{8}$/.test(id)) return j({ err: '备案号无效' }, 400);

  const data = await env.RECORD_KV.get(id);
  if (!data) return j({ err: '未找到备案' }, 404);

  return j(JSON.parse(data));
}

// ===== 页面 =====
function page() {
  return new Response(`<!doctype html><meta charset=utf-8><title>虚拟备案</title>
<h3>备案提交</h3>
<input id=s placeholder=网站名><input id=d placeholder=域名><input id=o placeholder=负责人>
<button onclick=r()>提交</button>
<h3>备案查询</h3>
<input id=q placeholder=备案号><button onclick=c()>查询</button>
<h3>管理员删除</h3>
<input id=u placeholder=账号><input id=pw type=password placeholder=密码>
<input id=did placeholder=备案号>
<button onclick=del()>删除</button>
<pre id=p></pre>
<script>
async function r(){p.textContent=JSON.stringify(await (await fetch('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({site:s.value,domain:d.value,owner:o.value})})).json(),0,2)}
async function c(){p.textContent=JSON.stringify(await (await fetch('/api/query?id='+q.value)).json(),0,2)}
async function del(){p.textContent=JSON.stringify(await (await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:u.value,pass:pw.value,id:did.value})})).json(),0,2)}
</script>`,{headers:{'content-type':'text/html;charset=utf-8'}});
}

// ===== 管理员删除 =====
async function adminDelete(req, env) {
  const { user, pass, id } = await req.json();
  if (user !== 'root' || pass !== 'password') return j({ err: '鉴权失败' }, 403);
  if (!id) return j({ err: '缺少备案号' }, 400);

  const data = await env.RECORD_KV.get(id);
  if (!data) return j({ err: '备案不存在' }, 404);

  const obj = JSON.parse(data);
  await env.RECORD_KV.delete(id);
  await env.RECORD_KV.delete('D:' + obj.domain);

  return j({ ok: true });
}
