import https from 'node:https';
import {Readable} from 'node:stream';

// An independent connection pool for the single read-only thumbnail retry.
// TLS certificate and hostname verification use Node's secure defaults.
const agent=new https.Agent({keepAlive:true,maxSockets:4,maxFreeSockets:2});
export function httpsFetch(url,{method='GET',headers,body,signal}={}) {
  return new Promise((resolve,reject)=>{
    const request=https.request(url,{method,headers:{'Accept-Encoding':'identity',...headers},signal,agent},response=>{
      const headers=new Headers();
      for(let i=0;i<response.rawHeaders.length;i+=2)headers.append(response.rawHeaders[i],response.rawHeaders[i+1]);
      const empty=method==='HEAD'||[204,205,304].includes(response.statusCode);
      if(empty)response.resume();
      resolve(new Response(empty?null:Readable.toWeb(response),{status:response.statusCode,headers}));
    });
    request.on('error',reject);
    request.end(body);
  });
}
