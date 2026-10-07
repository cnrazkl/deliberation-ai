import { expect, test } from "vitest";
import { sessionTaskName } from "./windows-session-runtime";

test("one Windows checkout retains its task identity across case, slash and dot-path variations", () => {
  const name = sessionTaskName("C:\\Users\\owner\\project");
  expect(sessionTaskName("c:/users/OWNER/project/./")).toBe(name);
  expect(name).toMatch(/^DeliberationAI-session-[a-f0-9]{20}$/u);
});

test("separate checkouts and non-ASCII paths cannot reuse another checkout's task", () => {
  const root = "C:/Users/owner/project";
  expect(sessionTaskName(`${root}-other`)).not.toBe(sessionTaskName(root));
  expect(sessionTaskName("C:/Users/owner/proje-ş")).not.toBe(sessionTaskName("C:/Users/owner/proje-s"));
});
