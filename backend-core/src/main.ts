import { superviseProcesses } from "@seo-platform/process-supervisor";
import { coreProcessDefinitions } from "./runtime-processes.js";

await superviseProcesses(coreProcessDefinitions(process.env));
