import { expect, test } from "vitest";
import journal from "../drizzle/meta/_journal.json";
import { assertMigrationTimeline, DatabaseMigrationCompatibilityError } from "./migration-compatibility";

const expected = journal.entries.map((entry) => entry.when);
test("current journal matches while an older worker manifest refuses a newer ledger", () => {
  expect(() => assertMigrationTimeline(expected, expected)).not.toThrow();
  expect(() => assertMigrationTimeline(expected, expected.slice(0, -1))).toThrow(DatabaseMigrationCompatibilityError);
});
test("missing, future, duplicate and substituted history cannot pass the worker gate", () => {
  for (const history of [[], expected.slice(0, -1), [...expected, expected.at(-1)! + 1],
    [expected[0]!, ...expected.slice(0, -1)], [...expected.slice(0, -1), expected.at(-1)! - 1],
    [...expected.slice(0, -1), NaN]]) {
    expect(() => assertMigrationTimeline(history, expected)).toThrow(DatabaseMigrationCompatibilityError);
  }
});
