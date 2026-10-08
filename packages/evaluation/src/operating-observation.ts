import { z } from "zod";

const planSchema=z.object({version:z.literal("operating-observation-v1"),startedAt:z.iso.datetime(),days:z.literal(30),intervalMinutes:z.literal(15),sourceTree:z.string().regex(/^[a-f0-9]{40}$/u)}).strict();
const sampleSchema=z.object({at:z.iso.datetime(),database:z.enum(["ready","unavailable"]),readyWorkers:z.number().int().min(0).max(100),httpReady:z.boolean(),diagnosticsReady:z.boolean()}).strict();
export type OperatingPlan=z.infer<typeof planSchema>;
export type OperatingSample=z.infer<typeof sampleSchema>;

/** Samples measure observed availability only, never continuous uptime or unseen duties. */
export function inspectOperatingObservation(rawPlan: unknown,rawSamples: unknown,now=Date.now()) {
  const plan=planSchema.parse(rawPlan),samples=z.array(sampleSchema).max(10_000).parse(rawSamples);
  const start=Date.parse(plan.startedAt),end=start+plan.days*86400_000;
  if (!Number.isFinite(now) || start>now+5000) throw new Error("Invalid observation clock.");
  const times=samples.map(sample=>Date.parse(sample.at));
  if (times.some((at,index)=>at<start || at>now+5000 || index>0 && at<=times[index-1]!)) throw new Error("Non-monotonic observations.");
  const last=times.at(-1) ?? start;
  // Checking a completed study later must not count time outside its frozen window.
  const bounded=times.map(at=>Math.min(at,end));
  const gaps=[...bounded.map((at,index)=>at-(bounded[index-1] ?? start)),Math.max(0,Math.min(now,end)-Math.min(last,end))];
  const longestGapMs=Math.max(...gaps,0);
  const unhealthySamples=samples.filter(sample=>!sample.httpReady || !sample.diagnosticsReady || sample.database!=="ready" || sample.readyWorkers!==1).length;
  return {startedAt:plan.startedAt,dueAt:new Date(end).toISOString(),sampleCount:samples.length,unhealthySamples,
    observedWindowDays:Math.max(0,(last-start)/86400_000),remainingDays:Math.max(0,(end-now)/86400_000),longestGapMs,
    observationStatus:last<end ? "window_pending" : longestGapMs>30*60_000 ? "coverage_incomplete" : "window_observed",
    recordedMaintenanceMinutes:null,maintenanceTarget:"not_assessed",continuousUptime:"unknown",humanQuality:"not_assessed"};
}
