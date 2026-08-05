import { superviseProcesses } from "@seo-platform/process-supervisor";
import { executionProcessDefinitions } from "./runtime-processes.js";

await superviseProcesses(executionProcessDefinitions(process.env));
