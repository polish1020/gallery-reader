import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {GET,POST,DELETE} from '../api/ex-session.js';
import {GET as galleries} from '../api/galleries.js';
import {POST as metadata} from '../api/metadata.js';
import {GET as thumbnail} from '../api/thumbnail.js';
import {sessionCookie} from '../lib/ex-session.mjs';

const credentials={ipb_member_id:'1',ipb_pass_hash:'fixture-pass',ipb_session_id:'fixture-session',igneous:'old-fixture'};
const listing='<a href="https://exhentai.org/g/1/abcdef/">Gallery</a>';
const makeRequest=(path,{method='GET',cookie,body,origin}={}) => new Request(`https://reader.example${path}`,{method,headers:{...(cookie ? {Cookie:cookie} : {}),...(origin ? {Origin:origin} : {}),...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
const fixtureCookie=()=>sessionCookie(credentials).cookie.split(';')[0];

test('ExHentai is unavailable before credentials are verified',async t => {
  t.mock.method(console,'error',() => {});
  const status=await GET(makeRequest('/api/ex-session'));
  assert.equal(status.headers.get('set-cookie'),null);
  assert.deepEqual(await status.json(),{configured:false,scope:null});
  const response=await galleries(makeRequest('/api/galleries?source=exhentai'));
  assert.equal(response.status,401);
});

test('verification refreshes stale igneous and returns a private session without echoing credentials',async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    calls.push({url:new URL(url),options});
    return calls.length===1 ? new Response('denied',{headers:{'Content-Type':'image/gif'}}) : new Response(listing,{headers:{'Set-Cookie':'igneous=fresh-fixture; HttpOnly'}});
  });
  const response=await POST(makeRequest('/api/ex-session',{method:'POST',body:credentials,origin:'https://reader.example'}));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.configured,true);assert.equal(data.refreshedIgneous,true);assert.ok(data.scope);
  const serialized=JSON.stringify(data);
  for (const [key,value] of Object.entries(credentials)) { assert.ok(!serialized.includes(key)); if (key !== 'ipb_member_id') assert.ok(!serialized.includes(value)); }
  const cookie=response.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Max-Age=31536000/);assert.match(cookie,/Expires=/);
  assert.match(calls[0].options.headers.Cookie,/igneous=old-fixture/);
  assert.ok(!calls[1].options.headers.Cookie.includes('igneous='));
  const status=await GET(makeRequest('/api/ex-session',{cookie:cookie.split(';')[0]}));
  assert.deepEqual(await status.json(),{configured:true,scope:data.scope});
});

test('existing session cookies become persistent without another upstream request or losing the private cache scope',async t => {
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Session renewal must not contact the source');});
  const legacy=fixtureCookie();
  const before=await (await GET(makeRequest('/api/ex-session',{cookie:legacy}))).json();
  const response=await GET(makeRequest('/api/ex-session',{cookie:legacy}));
  const cookie=response.headers.get('set-cookie');
  assert.match(cookie,/Max-Age=31536000/);
  assert.equal(cookie.split(';')[0],legacy);
  const expires=Date.parse(cookie.match(/Expires=([^;]+)/)[1]);
  assert.ok(Math.abs(expires-Date.now()-365*24*60*60*1000)<2000);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),before);
  const restored=await GET(makeRequest('/api/ex-session',{cookie:cookie.split(';')[0]}));
  assert.deepEqual(await restored.json(),{configured:true,scope:before.scope});
  assert.match(restored.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
});

test('only an explicit same-origin settings request can refill saved credentials',async t => {
  t.mock.method(console,'error',() => {});
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Refilling the form must not contact the source');});
  const cookie=fixtureCookie();
  const status=await GET(makeRequest('/api/ex-session',{cookie}));
  assert.equal((await status.json()).credentials,undefined);
  const saved=await GET(makeRequest('/api/ex-session?credentials=1',{cookie,origin:'https://reader.example'}));
  assert.deepEqual((await saved.json()).credentials,credentials);
  assert.equal(saved.headers.get('cache-control'),'no-store');
  assert.equal(saved.headers.get('vary'),'Cookie');
  const denied=await GET(makeRequest('/api/ex-session?credentials=1',{cookie,origin:'https://unrelated.example'}));
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).credentials,undefined);
  const missing=await GET(makeRequest('/api/ex-session?credentials=1'));
  assert.deepEqual(await missing.json(),{configured:false,scope:null});
});

test('private credentials reach only ExHentai requests and never the public source',async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    calls.push({url:new URL(url),options});return new Response(listing);
  });
  const cookie=fixtureCookie();
  assert.equal((await galleries(makeRequest('/api/galleries?source=exhentai',{cookie}))).status,200);
  assert.equal(calls[0].url.hostname,'exhentai.org');assert.match(calls[0].options.headers.Cookie,/ipb_member_id=1/);
  assert.equal((await galleries(makeRequest('/api/galleries',{cookie}))).status,200);
  assert.equal(calls[1].url.hostname,'e-hentai.org');assert.equal(calls[1].options.headers.Cookie,undefined);
});

test('authenticated metadata uses the ExHentai API and protected thumbnails stay private',async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    calls.push({url:new URL(url),options});
    return String(url).includes('api.php') ? Response.json({gmetadata:[{gid:1,title:'Fixture'}]}) : new Response('image-fixture',{headers:{'Content-Type':'image/webp'}});
  });
  const cookie=fixtureCookie();
  const response=await metadata(makeRequest('/api/metadata',{method:'POST',cookie,body:{ids:[[1,'abcdef']]}}));
  assert.equal(response.status,200);assert.equal((await response.json()).gmetadata[0].gid,1);
  assert.equal(calls[0].url.hostname,'exhentai.org');assert.match(calls[0].options.headers.Cookie,/fixture-pass/);
  const image=await thumbnail(makeRequest('/api/thumbnail?src=https%3A%2F%2Fs.exhentai.org%2Fw%2Ffixture.webp',{cookie}));
  assert.equal(image.status,200);assert.equal(await image.text(),'image-fixture');
  assert.match(image.headers.get('cache-control'),/private/);assert.equal(image.headers.get('vary'),'Cookie');
});

test('read-only metadata switches API origin once after a transport failure',async t=>{
  t.mock.method(console,'error',()=>{});
  t.mock.method(console,'info',()=>{});
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url:new URL(url),options});
    if(calls.length===1)throw new TypeError('fetch failed',{cause:Object.assign(new Error('timeout'),{code:'UND_ERR_CONNECT_TIMEOUT'})});
    return Response.json({gmetadata:[{gid:1,title:'Fixture'}]});
  });
  const response=await metadata(makeRequest('/api/metadata',{method:'POST',cookie:fixtureCookie(),body:{ids:[[1,'abcdef']]}}));
  assert.equal(response.status,200);
  assert.deepEqual(calls.map(call=>call.url.hostname),['exhentai.org','s.exhentai.org']);
  assert.equal(calls[0].options.body,calls[1].options.body);
  for(const call of calls){
    assert.match(call.options.headers.Cookie,/fixture-pass/);
    assert.equal(call.options.headers.Origin,'https://exhentai.org');
  }
});

test('metadata does not retry HTTP or API rejections and bounds transport attempts',async t=>{
  t.mock.method(console,'error',()=>{});
  t.mock.method(console,'info',()=>{});
  let calls=0;
  const request=()=>makeRequest('/api/metadata',{method:'POST',cookie:fixtureCookie(),body:{ids:[[1,'abcdef']]}});
  const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('denied',{status:403});});
  assert.equal((await metadata(request())).status,401);
  assert.equal(calls,1);
  calls=0;
  mock.mock.mockImplementation(async()=>{calls++;return Response.json({error:'Permission denied'});});
  assert.equal((await metadata(request())).status,502);
  assert.equal(calls,1);
  calls=0;
  mock.mock.mockImplementation(async()=>{calls++;throw new DOMException('Timed out','TimeoutError');});
  assert.equal((await metadata(request())).status,502);
  assert.equal(calls,2);
});

test('cross-site session writes and arbitrary thumbnail destinations are rejected',async t => {
  t.mock.method(console,'error',() => {});
  assert.equal((await POST(makeRequest('/api/ex-session',{method:'POST',body:credentials,origin:'https://unrelated.example'}))).status,403);
  assert.equal((await thumbnail(makeRequest('/api/thumbnail?src=https://unrelated.example/w/image.webp',{cookie:fixtureCookie()}))).status,400);
  const cleared=DELETE(makeRequest('/api/ex-session',{method:'DELETE'}));
  assert.match(cleared.headers.get('set-cookie'),/Max-Age=0/);
});

test('a transient thumbnail connection failure retries with an independent HTTPS connection',async t => {
  let attempts=0,connections=0;
  t.mock.method(globalThis,'fetch',async () => {
    attempts++;throw new TypeError('fetch failed');
  });
  t.mock.method(https,'request',(url,options,callback)=>{
    connections++;
    assert.equal(url.hostname,'s.exhentai.org');
    assert.match(options.headers.Cookie,/fixture-pass/);
    assert.ok(options.signal);
    assert.equal(options.rejectUnauthorized,undefined);
    const request=new EventEmitter();
    request.end=()=>{
      const response=Readable.from([Buffer.from('image')]);
      response.statusCode=200;response.rawHeaders=['Content-Type','image/webp'];
      callback(response);
    };
    return request;
  });
  const response=await thumbnail(makeRequest('/api/thumbnail?src=https%3A%2F%2Fs.exhentai.org%2Fw%2Ffixture.webp',{cookie:fixtureCookie()}));
  assert.equal(response.status,200);assert.equal(await response.text(),'image');
  assert.equal(attempts,1);assert.equal(connections,1);
});

test('thumbnail timeouts get one independent retry, while authentication rejections do not',async t=>{
  t.mock.method(console,'error',()=>{});
  let connections=0;
  const input=()=>makeRequest('/api/thumbnail?src=https%3A%2F%2Fs.exhentai.org%2Fw%2Ffixture.webp',{cookie:fixtureCookie()});
  const transport=t.mock.method(globalThis,'fetch',async()=>{throw new DOMException('Timed out','TimeoutError');});
  t.mock.method(https,'request',()=>{
    connections++;
    const request=new EventEmitter();
    request.end=()=>queueMicrotask(()=>request.emit('error',Object.assign(new Error('Connection timed out'),{code:'ETIMEDOUT'})));
    return request;
  });
  assert.equal((await thumbnail(input())).status,502);
  assert.equal(connections,1);
  transport.mock.mockImplementation(async()=>new Response('denied',{status:403}));
  assert.equal((await thumbnail(input())).status,401);
  assert.equal(connections,1);
});
