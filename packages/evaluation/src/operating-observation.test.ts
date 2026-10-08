import { expect,test } from "vitest";
import { inspectOperatingObservation } from "./operating-observation";
const start=Date.parse("2026-10-08T18:00:00.000Z");
const plan={version:"operating-observation-v1",startedAt:new Date(start).toISOString(),days:30,intervalMinutes:15,sourceTree:"a".repeat(40)};
const sample=(at:number,ready=true)=>({at:new Date(at).toISOString(),database:ready ? "ready" : "unavailable",readyWorkers:ready ? 1 : 0,httpReady:ready,diagnosticsReady:ready});
test("one healthy session never completes month-long observation or invents maintenance time",()=>{
  expect(inspectOperatingObservation(plan,[sample(start)],start)).toMatchObject({observationStatus:"window_pending",sampleCount:1,recordedMaintenanceMinutes:null,continuousUptime:"unknown"});
});
test("missing days and failed samples remain visible after the calendar window",()=>{
  expect(inspectOperatingObservation(plan,[sample(start),sample(start+30*86400_000,false)],start+30*86400_000)).toMatchObject({observationStatus:"coverage_incomplete",unhealthySamples:1});
});
test("complete sampled coverage still cannot certify unrecorded maintenance or continuous uptime",()=>{
  const samples=Array.from({length:30*24*4+1},(_,i)=>sample(start+i*15*60_000));
  expect(inspectOperatingObservation(plan,samples,start+30*86400_000)).toMatchObject({observationStatus:"window_observed",maintenanceTarget:"not_assessed",continuousUptime:"unknown"});
  expect(inspectOperatingObservation(plan,samples,start+40*86400_000).observationStatus).toBe("window_observed");
  for (const samples of [[sample(start+1000),sample(start)],[sample(start),sample(start)],[sample(start+30*86400_000)]]) expect(()=>inspectOperatingObservation(plan,samples,start)).toThrow();
});
