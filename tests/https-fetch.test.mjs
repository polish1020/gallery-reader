import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {httpsFetch} from '../lib/https-fetch.mjs';

test('HTTPS fallback preserves response bytes, cookies and manual redirects with TLS verification enabled',async t=>{
  const signal=AbortSignal.timeout(1000);
  const bytes=Buffer.from([0,128,255,14]);
  t.mock.method(https,'request',(url,options,callback)=>{
    assert.equal(options.signal,signal);
    assert.equal(options.headers['Accept-Encoding'],'identity');
    assert.equal(options.rejectUnauthorized,undefined);
    assert.ok(options.agent.maxSockets<=4);
    const request=new EventEmitter();
    request.end=()=>{
      const response=Readable.from([bytes]);response.statusCode=302;
      response.rawHeaders=['Content-Type','image/webp','Location','/next','Set-Cookie','a=1','Set-Cookie','b=2'];
      callback(response);
    };
    return request;
  });
  const response=await httpsFetch(new URL('https://s.exhentai.org/w/fixture.webp'),{signal});
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'/next');
  assert.deepEqual(response.headers.getSetCookie(),['a=1','b=2']);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
});
