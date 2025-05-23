const core = require("@actions/core");
const minimist = require("minimist");

// Constants
const CONFIG = {
  DEFAULT_API_BASE_URL: "https://api.numos.ai",
  MAX_ATTEMPTS: 30,
  WAIT_TIME: 10000,
  TEST_SUITE_EXECUTION_TERMINAL_STATUSES: [
    "completed",
    "failed",
    "canceled",
    "error",
  ],
  TEST_EXECUTION_TERMINAL_STATUSES: ["passed", "failed", "canceled", "error"],
};

// Helper function to pad and truncate
function formatCell(content, width) {
  if (content.length > width) {
    const truncated = content.slice(0, width - 3);
    return truncated + "..." + " ".repeat(width - truncated.length - 3);
  }
  return content.padEnd(width, " ");
}

function getInput(name) {
  return process.env.GITHUB_ACTIONS === "true"
    ? core.getInput(name)
    : minimist(process.argv.slice(2))[name.replace(/-/g, "_")] ||
        minimist(process.argv.slice(2))[name];
}

async function fetchWithError(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `API request failed: ${response.status} - ${JSON.stringify(error)}`
    );
  }
  return response.json();
}

async function run() {
  try {
    core.info("Starting test suite execution");
    const testSuiteId = getInput("test_suite_id");
    const baseUrl = getInput("api_base_url") || CONFIG.DEFAULT_API_BASE_URL;

    if (!testSuiteId) {
      throw new Error("Missing required input: test_suite_id is required");
    }

    // Trigger test suite
    const triggerData = await fetchWithError(
      `${baseUrl}/test-suite-executions/${testSuiteId}/execute`,
      { method: "POST" }
    );

    const executionId = triggerData.id;
    core.info(`Triggered Test Suite ${testSuiteId} with execution id ${executionId}`);

    // Monitor test suite
    let testSuiteExecutionStatus = triggerData.status;
    const completedTestIds = new Set();
    const results = { passed: [], failed: [] };
    let attempts = 0;
    const columnWidth = 50;

    while (attempts++ < CONFIG.MAX_ATTEMPTS) {
      core.info(
        `Checking test suite execution status: Attempt ${attempts} of ${
          CONFIG.MAX_ATTEMPTS
        }`
      );

      const { testSuiteExecution, testExecutions } = await fetchWithError(
        `${baseUrl}/test-suite-executions/${executionId}/test-executions`
      );

      // Process new test executions
      testExecutions
        .filter((test) =>
          CONFIG.TEST_EXECUTION_TERMINAL_STATUSES.includes(test.status)
        )
        .forEach((test) => {
          if (!completedTestIds.has(test.id)) {
            completedTestIds.add(test.id);
            core.info(
              `Test: ${test.testName} - Status: ${test.status.toUpperCase()}`
            );
            results[test.status === "passed" ? "passed" : "failed"].push(test);
          }
        });

      if (
        CONFIG.TEST_SUITE_EXECUTION_TERMINAL_STATUSES.includes(
          testSuiteExecution.status
        )
      ) {
        testSuiteExecutionStatus = testSuiteExecution.status;
        core.info(`\nTest suite ${testSuiteExecution.status.toUpperCase()}\n`);
        break;
      }

      await new Promise((res) => setTimeout(res, CONFIG.WAIT_TIME));
    }

    // Build final summary table
    const total = results.passed.length + results.failed.length;
    let table = `| ${formatCell("Test", columnWidth)} | Status  |\n`;
    table += `|${"-".repeat(columnWidth + 2)}|---------|\n`;

    [...results.passed, ...results.failed].forEach((test) => {
      table += `| ${formatCell(test.testName, columnWidth)} | ${test.status
        .toUpperCase()
        .padEnd(7)} |\n`;
    });

    const summaryLines = [
      `Total Tests: ${total} | Passed: ${results.passed.length} | Failed: ${results.failed.length}`,
      ``,
      table,
    ];

    // Log and set status
    if (
      results.failed.length === 0 &&
      testSuiteExecutionStatus === "completed"
    ) {
      core.info(summaryLines.join("\n"));
    } else {
      core.setFailed(summaryLines.join("\n"));
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
