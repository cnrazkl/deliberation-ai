import { createServer } from "node:http";
import { once } from "node:events";
import { expect,test } from "vitest";
import { requestRehearsalHttp } from "./rehearsal-http";

test("rehearsal HTTP preserves the configured authority through internal routing and bounds responses",async()=>{
  let requests=0;
  const server=createServer((request,response)=>{
    requests++;
    if (request.url==="/large") { response.end("x".repeat(100));return; }
    if (request.url==="/redirect") { response.writeHead(302,{location:"http://example.invalid/"});response.end();return; }
    response.setHeader("content-type","application/json");
    response.end(JSON.stringify({host:request.headers.host,origin:request.headers.origin}));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();if (!address || typeof address==="string") throw new Error("Fixture unavailable.");
  const target=`http://127.0.0.1:${address.port}`,origin="http://127.0.0.1:33184";
  try {
    expect(await (await requestRehearsalHttp(target,"/",{origin})).json()).toEqual({host:"127.0.0.1:33184",origin});
    const lanOrigin="http://192.168.1.112:33184";
    expect(await (await requestRehearsalHttp(target,"/",{origin:lanOrigin})).json()).toEqual({host:"192.168.1.112:33184",origin:lanOrigin});
    await expect(requestRehearsalHttp(target,"/large",{origin,maxBytes:16})).rejects.toThrow();
    expect((await requestRehearsalHttp(target,"/redirect",{origin})).status).toBe(302);
    expect(requests).toBe(4);
    for (const host of ["8.8.8.8","172.32.0.1","192.169.1.112","example.invalid"]) {
      expect(()=>requestRehearsalHttp(target,"/",{origin:`http://${host}:33184`})).toThrow();
    }
    expect(()=>requestRehearsalHttp(target,"//example.invalid/",{origin})).toThrow();
    expect(()=>requestRehearsalHttp("http://example.invalid/","/",{origin})).toThrow();
  } finally { server.close();await once(server,"close"); }
});
