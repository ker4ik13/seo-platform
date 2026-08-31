import {
  createOperationalAlertClient,
  installUncaughtExceptionAlert
} from "@seo-platform/operational-alerts";
import { superviseProcesses } from "@seo-platform/process-supervisor";
import { executionProcessDefinitions } from "./runtime-processes.js";

const reporter = createOperationalAlertClient(
  process.env,
  "backend-execution"
);
const removeMonitor = installUncaughtExceptionAlert(reporter);
try {
  await superviseProcesses(executionProcessDefinitions(process.env), {
    alertReporter: reporter
  });
} finally {
  removeMonitor();
}
