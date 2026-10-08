import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { inspectOperatingObservation,type OperatingPlan,type OperatingSample } from "@deliberation-ai/evaluation";
import { createRuntimeReadToken } from "../src/runtime-read-auth";
import { requestRehearsalHttp } from "./rehearsal-http";

const [mode,name]=process.argv.slice(2);
const root=resolve(import.meta.dirname,"../../..");
if (process.argv.length!==4 || !name || !/^[a-z0-9][a-z0-9-]{0,40}$/u.test(name) || !["start","sample","status","watch"].includes(mode ?? "")) throw new Error("Observation command invalid.");
const directory=resolve(root,".local/operating-study",name),planPath=resolve(directory,"plan.json");
const read=()=>JSON.parse(readFileSync(planPath,"utf8")) as OperatingPlan;
function status() {
  const files=readdirSync(directory).filter(file=>/^sample-[a-f0-9-]{36}\.json$/u.test(file));
  const samples=files.map(file=>JSON.parse(readFileSync(resolve(directory,file),"utf8")) as OperatingSample).sort((a,b)=>a.at.localeCompare(b.at));
  return inspectOperatingObservation(read(),samples);
}
function start() {
  mkdirSync(directory,{recursive:true});
  const plan: OperatingPlan={version:"operating-observation-v1",startedAt:new Date().toISOString(),days:30,intervalMinutes:15,sourceTree:process.env.REHEARSAL_SOURCE_TREE ?? ""};
  inspectOperatingObservation(plan,[]);
  writeFileSync(planPath,JSON.stringify(plan),{flag:"wx",mode:0o600});
}
async function sample() {
  const origin=process.env.APP_ORIGIN ?? "http://127.0.0.1:3000",address=process.env.REHEARSAL_WEB_URL ?? "http://127.0.0.1:3000";
  const url=new URL(address);
  if (url.protocol!=="http:" || !["127.0.0.1","web"].includes(url.hostname) || url.username || url.password) throw new Error("Local observation endpoint required.");
  const observation: OperatingSample={at:new Date().toISOString(),database:"unavailable",readyWorkers:0,httpReady:false,diagnosticsReady:false};
  try {
    const home=await requestRehearsalHttp(address,"/",{origin,timeoutMs:5000});
    observation.httpReady=home.status===200;await home.body?.cancel();
    const health=await requestRehearsalHttp(address,"/api/local-diagnostics",{origin,timeoutMs:5000,maxBytes:16000,headers:{"x-deliberation-runtime-read":createRuntimeReadToken(process.env.DATA_ENCRYPTION_KEY ?? "")}});
    const body=await health.text();if (body.length>16000) throw new Error("Bounded diagnostics required.");
    const value=JSON.parse(body) as {database?:string;readyWorkers?:number};
    if (health.ok && value.database==="ready" && Number.isInteger(value.readyWorkers) && value.readyWorkers!>=0 && value.readyWorkers!<=100) {
      observation.database="ready";observation.readyWorkers=value.readyWorkers!;observation.diagnosticsReady=true;
    }
  } catch { /* Record the unavailable sample; never replace it with a success. */ }
  // Validate real clock/shape before persisting; no content, URL, username or credential enters samples.
  inspectOperatingObservation(read(),[observation]);
  writeFileSync(resolve(directory,`sample-${randomUUID()}.json`),JSON.stringify(observation),{flag:"wx",mode:0o600});
}
try {
  if (mode==="start") start();
  else if (mode==="sample") await sample();
  else if (mode==="watch") {
    if (!existsSync(planPath)) start();
    const deadline=Date.parse(read().startedAt)+30*86400_000;
    do {await sample();if (Date.now()>=deadline) break;await pause(Math.min(15*60_000,Math.max(1,deadline-Date.now())));} while (Date.now()<=deadline+30*60_000);
  }
  console.log(JSON.stringify(status()));
} catch {console.error("Operating observation unavailable; preserve existing samples and verify the private local configuration.");process.exitCode=1;}
