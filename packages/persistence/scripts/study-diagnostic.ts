import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { Client } from "pg";
import { prepareStudyExecution, type StudySelection } from "@deliberation-ai/evaluation";
import { loadProviderConnectionSecret, saveProviderConnection } from "../src/provider-connections";
import { closeDatabase, getPool } from "../src/database";
import { provisionLocalRoot, registerLocalUser } from "../src/local-auth";
import { withStudyOwner } from "../src/study-owner";
import { SynthesisFileJournal } from "./synthesis-journal";

const root=resolve(import.meta.dirname,"../../..");
const [consent,name,configPath]=process.argv.slice(2);
const suite=()=>JSON.parse(readFileSync(resolve(root,"docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"),"utf8")) as unknown;
let worker: ReturnType<typeof spawn> | undefined;
let admin: Client | undefined;
try {
  if (consent!=="--live" || !name || !/^[a-z0-9][a-z0-9-]{0,40}$/u.test(name) || !configPath || process.argv.length!==5) throw new Error("Reviewed live configuration required.");
  const config=JSON.parse(readFileSync(resolve(configPath),"utf8")) as { connectionIds: string[]; selections: StudySelection[] };
  if (Object.keys(config).some(key=>!["connectionIds","selections"].includes(key)) || !Array.isArray(config.connectionIds) || config.connectionIds.length!==2 ||
    new Set(config.connectionIds).size!==2 || config.connectionIds.some(id=>! /^[a-f0-9-]{36}$/u.test(id)) ||
    !Array.isArray(config.selections) || config.selections.length!==2 || new Set(config.selections.map(item=>item.kind)).size!==2) throw new Error("Fixed two-member paired diagnostics required.");
  for (const selection of config.selections) {
    if (selection.memberCount!==2) throw new Error("Fixed member count required.");
    prepareStudyExecution(suite(),selection);
  }
  const output=resolve(root,".local/nonhuman-diagnostics",name);
  mkdirSync(resolve(output,".."),{recursive:true});
  mkdirSync(output,{recursive:false}); // A used diagnostic identity is never resumed or resent.
  const source=new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
  if (source.hostname!=="127.0.0.1" || source.port!=="5432" || source.pathname!=="/deliberation_ai" || source.username!=="deliberation") throw new Error("Provisioned local source required.");
  const targets=await Promise.all(config.connectionIds.map(id=>loadProviderConnectionSecret(id)));
  if (targets.some(target=>!target)) throw new Error("Reviewed source connections required.");
  await closeDatabase();
  const adminFile=readFileSync(resolve(process.env.LOCALAPPDATA ?? "","DeliberationAI/postgres-admin.local"),"utf8");
  const password=adminFile.split(/\r?\n/u).find(line=>line.startsWith("POSTGRES_SUPERUSER_PASSWORD="))?.slice("POSTGRES_SUPERUSER_PASSWORD=".length);
  if (!password) throw new Error("Generated-only database provisioning unavailable.");
  const adminUrl=new URL(source);adminUrl.pathname="/postgres";adminUrl.username="postgres";adminUrl.password=password;
  admin=new Client({connectionString:adminUrl.toString()});await admin.connect();
  const database=`da_study_${randomBytes(8).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${database}" OWNER deliberation TEMPLATE template0`);
  const targetUrl=new URL(source);targetUrl.pathname=`/${database}`;
  const env={...process.env,DATABASE_URL:targetUrl.toString(),DATA_ENCRYPTION_KEY:randomBytes(32).toString("base64"),WORKER_CONCURRENCY:"4",ENABLE_DECISION_EVALUATOR:"false"};
  // Private key/config is retained beside the generated DB so failed/unknown receipts remain decryptable.
  writeFileSync(resolve(output,"private-environment.json"),JSON.stringify({DATABASE_URL:env.DATABASE_URL,DATA_ENCRYPTION_KEY:env.DATA_ENCRYPTION_KEY}),{flag:"wx",mode:0o600});
  const migrated=spawnSync(process.platform==="win32" ? process.env.ComSpec ?? "cmd.exe" : "pnpm",process.platform==="win32" ? ["/d","/s","/c","pnpm --filter @deliberation-ai/persistence db:migrate"] : ["--filter","@deliberation-ai/persistence","db:migrate"],{cwd:root,env,stdio:"inherit",windowsHide:true});
  if (migrated.status!==0) throw new Error("Generated migration failed.");
  Object.assign(process.env,env);
  await provisionLocalRoot(randomBytes(24).toString("base64url"));
  const user=await registerLocalUser({username:`study_${randomBytes(6).toString("hex")}`,password:randomBytes(24).toString("base64url")});
  const owned=await withStudyOwner(user.ownerId,async()=>Promise.all(targets.map(target=> {
    if (!target) throw new Error();
    return saveProviderConnection({provider:target.provider,label:`Frozen ${target.provider} ${target.defaultModel}`,apiKey:target.apiKey,defaultModel:target.defaultModel,
      endpointPreset:target.endpointPreset,reasoningProtocol:target.reasoningProtocol,structuredOutputMode:target.structuredOutputMode,...(target.baseUrl ? {baseUrl:target.baseUrl} : {})});
  })));
  await closeDatabase();
  const log=openSync(resolve(output,"worker.log"),"wx",0o600);
  try { worker=spawn(process.execPath,["--import","tsx","apps/worker/src/index.ts"],{cwd:root,env,stdio:["ignore",log,log],windowsHide:true}); }
  finally {closeSync(log);}
  const deadline=Date.now()+30_000;
  for (;;) {
    const ready=await getPool().query("SELECT 1 FROM worker_heartbeats WHERE stopped_at IS NULL AND heartbeat_at>now()-interval '45 seconds'");
    if (ready.rowCount) break;
    if (worker.exitCode!==null || Date.now()>deadline) throw new Error("Generated worker unavailable.");
    await pause(500);
  }
  const execute=(args: string[])=>new Promise<void>((resolveRun,reject)=> {
    const child=spawn(process.execPath,["--import","tsx","packages/persistence/scripts/study-execution.ts",...args],{cwd:root,env,stdio:"inherit",windowsHide:true});
    child.once("error",reject);child.once("exit",code=>code===0 ? resolveRun() : reject(new Error("Study blocked.")));
  });
  const results: unknown[]=[];
  for (const selection of config.selections) {
    const studyName=`${name}-${selection.kind}`;
    const path=resolve(output,`${selection.kind}.json`);
    writeFileSync(path,JSON.stringify({ownerId:user.ownerId,selection,connectionIds:owned.map(connection=>connection.id)}),{flag:"wx",mode:0o600});
    await execute(["prepare",studyName,path]);
    const journal=new SynthesisFileJournal(resolve(root,".local/study-execution"),studyName,async()=>{});
    const plan=journal.read<{fingerprint:string}>("plan.enc");
    await execute(["run",studyName,"--live",plan.fingerprint]);
    const result=journal.read<{observations:{unknown:boolean;providerRejected?:boolean;policyMatched?:boolean}[]}>("result.enc");
    results.push(result);
    if (result.observations.some(item=>item.unknown || item.providerRejected || item.policyMatched===false)) break;
  }
  writeFileSync(resolve(output,"summary.json"),JSON.stringify({measuredAt:new Date().toISOString(),sourceConnections:targets.map(target=>({provider:target?.provider,model:target?.defaultModel,revision:target?.revision})),results,humanAcceptance:"not_assessed",accuracy:null,invoiceCost:"unknown"},null,2),{flag:"wx",mode:0o600});
  console.log(JSON.stringify({status:"observed",study:name,retainedGeneratedDatabase:true,humanAcceptance:"not_assessed"}));
} catch {console.error("Isolated diagnostic blocked. Existing source data is unchanged; retain the generated database and private key for inspection.");process.exitCode=1;}
finally {
  if (worker && worker.exitCode===null) {
    worker.kill();
    await Promise.race([once(worker,"exit"),pause(5_000)]);
  }
  await closeDatabase();await admin?.end();
}
