import {test} from 'node:test';
import assert from 'node:assert/strict';
import {upstream} from '../lib/ehentai.mjs';

test('upstream failures log nested network codes without sensitive request or error content',async t=>{
  const events=[];
  t.mock.method(console,'error',value=>events.push(JSON.parse(value)));
  const failure=new TypeError('fetch failed at https://secret.example/path?token=private',{cause:new AggregateError([
    Object.assign(new Error('Cookie: secret-cookie'),{code:'ETIMEDOUT',syscall:'connect'}),
    Object.assign(new Error('private credentials'),{code:'ENETUNREACH'})
  ])});
  t.mock.method(globalThis,'fetch',async()=>{throw failure;});
  await assert.rejects(upstream('https://s.exhentai.org/api.php?secret=private',{
    method:'POST',body:'private-body'
  },{source:'exhentai',credentials:{ipb_pass_hash:'secret-cookie'}}),error=>error===failure);
  assert.equal(events.length,1);
  assert.equal(events[0].host,'s.exhentai.org');
  assert.equal(events[0].operation,'api');
  assert.deepEqual(events[0].error.cause.errors.map(error=>error.code),['ETIMEDOUT','ENETUNREACH']);
  assert.ok(events[0].durationMs>=0);
  assert.doesNotMatch(JSON.stringify(events),/secret|private|Cookie|https:/);
});

test('API request diagnostics distinguish upstream HTTP rejection from a network failure',async t=>{
  const events=[];
  t.mock.method(console,'error',value=>events.push(JSON.parse(value)));
  t.mock.method(globalThis,'fetch',async()=>new Response('private rejection details',{status:403}));
  await assert.rejects(upstream('https://exhentai.org/api.php',{}, {source:'exhentai'}));
  assert.equal(events[0].status,403);
  assert.equal(events[0].error,undefined);
  assert.doesNotMatch(JSON.stringify(events),/private rejection/);
});
