import { defineConfig } from "vitest/config";

// This command requires the separately provisioned Windows portable-PG
// administrator/binary layout. It remains required in the ordinary Windows suite.
const portableWindowsChecks=[
  "a populated native private receipt survives an actual disposable archive restore",
];
const escaped=portableWindowsChecks.map(name=>name.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&")).join("|");
export default defineConfig({test:{include:["packages/**/*.integration.test.ts"],testTimeout:15000,hookTimeout:15000,fileParallelism:false,testNamePattern:new RegExp(`^(?!.*(?:${escaped})).*$`,"u")}});
