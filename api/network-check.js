// Temporary, fixed-target production diagnostic. Remove after verification.
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {getDefaultAutoSelectFamily} from 'node:net';
import {sameOrigin,requireSession,credentialCookie} from '../lib/ex-session.mjs';
import {networkError} from '../lib/upstream-diagnostics.mjs';
import {apiError,upstream} from '../lib/ehentai.mjs';

export async function POST(request) {
  try {
    sameOrigin(request);
    const {credentials}=requireSession(request);
    const host='s.exhentai.org',headers={'User-Agent':'YijingReader/0.3',Cookie:credentialCookie(credentials)};
    const body=JSON.stringify({method:'gdata',gidlist:[[4110019,'4f9f07d9a1']],namespace:1});
    const jsonHeaders={...headers,'Content-Type':'application/json',Origin:'https://exhentai.org',Referer:'https://exhentai.org/'};
    const checks=await Promise.all(['fetch-api','https-api','fetch-thumbnail','https-thumbnail','upstream-api','upstream-thumbnail','url-object-api'].map(async transport=>{
      const started=performance.now(),api=transport.endsWith('api');
      const path=api?'/api.php':'/w/02/563/91977-iks2xf45.webp',method=api?'POST':'GET';
      const result={transport};
      if(transport.startsWith('https'))return new Promise(resolve=>{
        const req=https.request({hostname:host,path,method,headers:api?jsonHeaders:headers,signal:AbortSignal.timeout(12000)},response=>{
          response.resume();resolve({...result,status:response.statusCode,durationMs:Math.round(performance.now()-started)});
        });
        req.on('socket',socket=>{
          socket.on('connect',()=>{result.connectMs=Math.round(performance.now()-started);});
          socket.on('secureConnect',()=>{result.tlsMs=Math.round(performance.now()-started);});
        });
        req.on('error',error=>resolve({...result,error:networkError(error),durationMs:Math.round(performance.now()-started)}));
        req.end(api?body:undefined);
      });
      try {
        const target=transport.startsWith('url-object')?new URL(`https://${host}${path}`):`https://${host}${path}`;
        const options={method,headers:api?jsonHeaders:headers,...(api?{body}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(12000)};
        const response=transport.startsWith('upstream')?await upstream(target,options,{source:'exhentai',credentials,image:!api}):await fetch(target,options);
        await response.body?.cancel();
        return {...result,status:response.status,durationMs:Math.round(performance.now()-started)};
      }catch(error){return {...result,error:networkError(error),durationMs:Math.round(performance.now()-started)};}
    }));
    const result={event:'network-check',node:process.version,region:process.env.VERCEL_REGION,autoFamily:getDefaultAutoSelectFamily(),addresses:await lookup(host,{all:true}),checks};
    console.info(JSON.stringify(result));
    return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return apiError(error);}
}
