import {
  createOperationalAlertClient,
  installUncaughtExceptionAlert
} from "@seo-platform/operational-alerts";
import { superviseProcesses } from "@seo-platform/process-supervisor";
import { coreProcessDefinitions } from "./runtime-processes.js";

const reporter = createOperationalAlertClient(process.env, "backend-core");
const removeMonitor = installUncaughtExceptionAlert(reporter);
try {
  await superviseProcesses(coreProcessDefinitions(process.env), {
    alertReporter: reporter
  });
} finally {
  removeMonitor();
}
