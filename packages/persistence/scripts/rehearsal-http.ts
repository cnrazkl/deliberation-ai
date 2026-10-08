import { request } from "node:http";

/** Preserve the configured Host through internal Docker DNS; never follow redirects. */
export function requestRehearsalHttp(address: string,path: string,options: {
  origin: string; method?: string; body?: unknown; headers?: Record<string,string>; timeoutMs?: number; maxBytes?: number;
}): Promise<Response> {
  const base=new URL(address),target=new URL(path,base),authority=new URL(options.origin);
  if (base.protocol!=="http:" || !["web","127.0.0.1"].includes(base.hostname) || base.username || base.password ||
      target.origin!==base.origin || authority.protocol!=="http:" || authority.hostname!=="127.0.0.1" || authority.username || authority.password)
    throw new Error("Private rehearsal HTTP endpoint required.");
  const body=options.body===undefined ? undefined : Buffer.from(JSON.stringify(options.body));
  if (body && body.length>256*1024) throw new Error("Rehearsal request limit.");
  const maxBytes=options.maxBytes ?? 1024*1024,timeoutMs=options.timeoutMs ?? 10_000;
  if (!Number.isInteger(maxBytes) || maxBytes<1 || maxBytes>1024*1024 || timeoutMs<1 || timeoutMs>30_000)
    throw new Error("Bounded rehearsal HTTP required.");
  return new Promise((resolve,reject)=>{
    const req=request(target,{method:options.method ?? "GET",agent:false,signal:AbortSignal.timeout(timeoutMs),headers:{
      ...options.headers,host:authority.host,origin:authority.origin,
      ...(body ? {"content-type":"application/json","content-length":String(body.length)} : {}),
    }},response=>{
      const chunks: Buffer[]=[];let bytes=0;
      response.on("data",(chunk: Buffer)=>{
        bytes+=chunk.length;
        if (bytes>maxBytes) { response.destroy(new Error("Rehearsal response limit."));return; }
        chunks.push(chunk);
      });
      response.on("error",reject);
      response.on("end",()=>{
        const headers=new Headers();
        for (const [name,values] of Object.entries(response.headers)) {
          if (values!==undefined) for (const value of Array.isArray(values) ? values : [values]) headers.append(name,value);
        }
        const status=response.statusCode ?? 503;
        resolve(new Response([204,205,304].includes(status) ? null : Buffer.concat(chunks),{status,headers}));
      });
    });
    req.on("error",reject);req.end(body);
  });
}
