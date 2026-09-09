export default async (req) => {
  try {
    const input = await req.json();
    const url = normalizeUrl(input.url || req.headers.get('x-listmonk-url') || '');
    const username = String(input.username || req.headers.get('x-listmonk-user') || '');
    const token = String(input.token || req.headers.get('x-listmonk-token') || '');
    if (!url || !/^https:\/\//i.test(url)) return json({detail:'Listmonk URL must use HTTPS.'},400);
    const host = new URL(url).hostname.toLowerCase();
    if (host !== 'campaigns.my-arenagames.com') return json({detail:'For security, this web version is restricted to campaigns.my-arenagames.com.'},400);
    if (!username || !token) return json({detail:'Listmonk username and API token are required.'},400);
    if (input.action === 'connect') {
      const r = await lmFetch(url,username,token,'GET','/lists?status=active&per_page=1&minimal=true');
      if (!r.ok) return json({detail:friendlyError(r.status,await text(r))},r.status);
      return json({connected:true,url});
    }
    if (input.action !== 'request') return json({detail:'Unsupported action.'},400);
    const path = String(input.path || '');
    const allowed = /^\/(lists|templates|campaigns)(\/\d+\/test|\/\d+\/status)?(?:\?.*)?$/;
    if (!allowed.test(path)) return json({detail:'Endpoint not allowed.'},400);
    const method = String(input.method || 'GET').toUpperCase();
    if (!['GET','POST','PUT'].includes(method)) return json({detail:'Method not allowed.'},405);
    const r = await lmFetch(url,username,token,method,path,input.body);
    const txt = await text(r);
    if (!r.ok) return json({detail:friendlyError(r.status,txt)},r.status);
    let data; try { data = txt ? JSON.parse(txt) : {data:true}; } catch { data = {data:txt}; }
    return json(data,r.status);
  } catch (e) {
    return json({detail:'Unexpected server error while contacting Listmonk.'},502);
  }
};
function normalizeUrl(raw){
  let u = String(raw || '').trim();
  u = u.replace(/\/+$/,'');
  u = u.replace(/\/api$/i,'');
  return u;
}
async function lmFetch(url,user,token,method,path,body){
  const m = String(method || 'GET').toUpperCase();
  const hasBody = !['GET','HEAD'].includes(m) && body !== undefined && body !== null;
  const h = {Authorization:`token ${user}:${token}`,Accept:'application/json'};
  if (hasBody) h['Content-Type'] = 'application/json';
  return fetch(`${url}/api${path}`,{method:m,headers:h,body:hasBody?JSON.stringify(body):undefined});
}
async function text(r){return (await r.text()).slice(0,4000)}
function friendlyError(status,raw){
  let extra = '';
  try { const j = JSON.parse(raw); if (j && j.message) extra = `: ${j.message}`; } catch {}
  if (status===401) return `Listmonk authentication failed (401)${extra || ': check the API user and API token.'}`;
  if (status===403) return `Listmonk access denied (403)${extra || ': this API user does not have the required permissions.'}`;
  if (status===404) return `Listmonk endpoint not found (404)${extra || ': check the Listmonk URL.'}`;
  if (status===405) return `Listmonk rejected this request method (405)${extra}`;
  if (status===500) return `Listmonk server error (500)${extra || ': the Listmonk instance failed to process the request.'}`;
  return `Listmonk request failed (HTTP ${status})${extra}`;
}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})}
