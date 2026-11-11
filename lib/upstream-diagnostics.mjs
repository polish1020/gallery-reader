// Deliberately omit URLs, headers, bodies and exception messages: they can
// contain credentials, search terms, gallery tokens or signed image links.
const label=value=>typeof value==='string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value)?value:undefined;
export function networkError(error,depth=0) {
  if (!error || depth>3) return undefined;
  return {
    name:label(error.name),code:label(error.code),syscall:label(error.syscall),
    cause:networkError(error.cause,depth+1),
    ...(Array.isArray(error.errors)?{errors:error.errors.slice(0,8).map(item=>networkError(item,depth+1))}:{})
  };
}
export function logUpstream(url,method,started,{error,status,transport}={}) {
  const durationMs=Math.round(performance.now()-started);
  if (!error && status<400 && durationMs<5000 && url.pathname!=='/api.php' && transport!=='https') return;
  const event={
    event:'upstream-request',host:url.hostname,
    operation:url.pathname==='/api.php'?'api':/^\/(?:w|t|lt)\//.test(url.pathname)?'thumbnail':'page',
    method:label(method),durationMs,status,transport:label(transport),
    region:label(process.env.VERCEL_REGION),error:networkError(error)
  };
  console[error || status>=400?'error':durationMs>=5000?'warn':'info'](JSON.stringify(event));
}
