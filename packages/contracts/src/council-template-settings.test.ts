import { expect, test } from "vitest";
import { councilTemplateContentSchema, councilTemplateSettingsSchema, defaultFakeCouncilMembers, saveCouncilTemplateSchema } from "./index";

test("council pool validates complete round settings and keeps member-only requests compatible", () => {
  const request = { requestId: "11111111-1111-4111-8111-111111111111", name: "Saved council", members: defaultFakeCouncilMembers };
  expect(saveCouncilTemplateSchema.parse(request).settings).toBeUndefined();
  expect(saveCouncilTemplateSchema.parse({ ...request, settings: { reviewRounds: 0, selfRevisionEnabled: false } }).settings?.reviewRounds).toBe(0);
  for (const settings of [{ reviewRounds: 4, selfRevisionEnabled: false }, { reviewRounds: 0, selfRevisionEnabled: true }, { reviewRounds: 1 }, { reviewRounds: 1, selfRevisionEnabled: false, question: "Extra content" }]) {
    expect(councilTemplateSettingsSchema.safeParse(settings).success).toBe(false);
  }
  expect(councilTemplateContentSchema.parse(defaultFakeCouncilMembers)).toEqual(defaultFakeCouncilMembers);
  const content = { version: "council-template-content-v2", members: defaultFakeCouncilMembers, settings: { reviewRounds: 3, selfRevisionEnabled: true } };
  expect(councilTemplateContentSchema.parse(content)).toEqual(content);
  expect(councilTemplateContentSchema.safeParse({ ...content, version: "future-version" }).success).toBe(false);
});
