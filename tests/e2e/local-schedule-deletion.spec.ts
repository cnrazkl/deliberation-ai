import { workspaceView } from "./workspace-navigation";
import { randomUUID } from "node:crypto";
import { expect,test } from "@playwright/test";
import { eq,inArray,sql } from "drizzle-orm";
import { getDatabase,localSchedules,closeDatabase } from "@deliberation-ai/persistence";

test("deduplicates a lost schedule creation, reviews deletion and recovers a lost committed delete without changing the question",async({page,request})=>{
  const ids:string[]=[];const requests:Array<Record<string,unknown>>=[];let generations=0;let first=true;
  const name=`E2E schedule ${randomUUID()}`;
  page.on("request",value=>{if(value.method()==="POST"&&new URL(value.url()).pathname==="/api/runs")generations++;});
  try{
    await page.route("**/api/provider-connections",route=>route.fulfill({json:{connections:[{id:"11111111-1111-4111-8111-111111111111",provider:"openai",label:"Offline schedule fixture",defaultModel:"offline-fixture",endpointPreset:"custom",reasoningProtocol:"openai",structuredOutputMode:"json-schema"}]}}));
    await page.route("**/api/local-schedules",async route=>{
      if(route.request().method()!=="POST")return route.continue();
      requests.push(route.request().postDataJSON());const response=await route.fetch();expect(response.ok()).toBe(true);
      const body=await response.json();if(!ids.includes(body.id))ids.push(body.id);
      if(first){first=false;await route.abort();}else await route.fulfill({response});
    });
    await page.goto("/");const question=page.getByLabel("Sorunuz",{exact:true});await question.fill("Generated schedule browser comparison question");
    await workspaceView(page,"Zamanlayıcı");
    const panel=page.getByRole("region",{name:"Yerel zamanlamalar"});await panel.getByLabel("Zamanlama adı").fill(name);
    await panel.getByLabel("İlk çalışma").fill("2400-01-01T03:00");const create=panel.getByRole("button",{name:"Duraklatılmış zamanlama oluştur"});
    await create.click();await expect(panel.locator("p.error")).toBeVisible();await create.click();
    const card=panel.locator("article").filter({hasText:name});await expect(card).toHaveCount(1);
    expect(ids).toHaveLength(1);expect(requests[0]!.requestId).toBe(requests[1]!.requestId);
    const id=ids[0]!;expect((await request.post("/api/local-schedules",{data:{...requests[0],requestId:undefined}})).status()).toBe(422);
    await card.getByRole("button",{name:"Zamanlama silmeyi incele"}).click();
    const review=panel.getByRole("region",{name:"Zamanlama silme önizlemesi"});const confirm=review.getByRole("button",{name:"Zamanlama içeriğini kalıcı olarak sil"});
    await expect(confirm).toBeDisabled();await expect(review).toContainText("Önceden kuyruğa alınmış çalışmalar durmaz");
    await review.getByRole("button",{name:"Silme incelemesini kapat"}).click();await expect(question).toHaveValue("Generated schedule browser comparison question");
    // Keep the generated fixture safely in the future while checking active-state refusal.
    await getDatabase().update(localSchedules).set({status:"active"}).where(eq(localSchedules.id,id));
    const active=await(await request.get(`/api/local-schedules/${id}/deletion`)).json();expect(active.blockedReasons).toContain("active_schedule");
    await request.patch(`/api/local-schedules?id=${id}`,{data:{status:"paused"}});
    await card.getByRole("button",{name:"Zamanlama silmeyi incele"}).click();await expect(confirm).toBeVisible();
    const old=await(await request.get(`/api/local-schedules/${id}/deletion`)).json();const confirmation={scheduleId:id,fingerprint:old.fingerprint,confirmContentDeletion:true,acknowledgeRetainedRuns:true};
    expect((await request.post(`/api/local-schedules/${id}/deletion`,{data:confirmation,headers:{origin:"https://foreign.example"}})).status()).toBe(403);
    expect((await request.post(`/api/local-schedules/${id}/deletion`,{data:{...confirmation,scheduleId:randomUUID()}})).status()).toBe(422);
    expect((await request.post(`/api/local-schedules/${id}/deletion`,{data:{...confirmation,extra:"x".repeat(4096)}})).status()).toBe(413);
    expect((await request.delete(`/api/local-schedules?id=${id}`)).status()).toBe(409);
    await getDatabase().execute(sql`update local_schedules set updated_at=updated_at+interval '1 second' where id=${id}::uuid`);
    await review.getByRole("checkbox").check();await confirm.click();await expect(review.getByRole("alert")).toContainText("Zamanlama değişti");
    await review.getByRole("button",{name:"Silme önizlemesini yenile"}).click();await expect(confirm).toBeDisabled();
    const current=await(await request.get(`/api/local-schedules/${id}/deletion`)).json();
    await page.route(`**/api/local-schedules/${id}/deletion`,async route=>{
      if(route.request().method()!=="POST")return route.continue();const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort();
    });
    await review.getByRole("checkbox").check();await confirm.click();await expect(review.getByRole("alert")).toBeVisible();
    await review.getByRole("button",{name:"Silme önizlemesini yenile"}).click();await expect(card).toHaveCount(0);
    expect((await request.post(`/api/local-schedules/${id}/deletion`,{data:{...confirmation,fingerprint:current.fingerprint}})).ok()).toBe(true);
    expect((await request.post("/api/local-schedules",{data:requests[0]})).status()).toBe(409);
    expect((await request.patch(`/api/local-schedules?id=${id}`,{data:{status:"active"}})).status()).toBe(404);
    await expect(question).toHaveValue("Generated schedule browser comparison question");expect(generations).toBe(0);
  }finally{if(ids.length)await getDatabase().delete(localSchedules).where(inArray(localSchedules.id,ids));await closeDatabase();}
});
