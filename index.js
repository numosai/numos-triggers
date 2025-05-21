const core = require("@actions/core");
const minimist = require("minimist");

// Constants
const CONFIG = {
  MAX_ATTEMPTS: 20,
  WAIT_TIME: 5000,
  TEST_SUITE_EXECUTION_TERMINAL_STATUSES: [
    "completed",
    "failed",
    "canceled",
    "error",
  ],
  TEST_EXECUTION_TERMINAL_STATUSES: ["passed", "failed", "canceled", "error"],
};

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
    const baseUrl = getInput("api_base_url");

    if (!testSuiteId || !baseUrl) {
      throw new Error(
        "Missing required inputs: test_suite_id and api_base_url are required"
      );
    }

    // Trigger test suite
    const triggerData = await fetchWithError(
      `${baseUrl}/test-suite-executions/${testSuiteId}/execute-test-suite`,
      { method: "POST" }
    );

    const executionId = triggerData.id;
    core.info(`Triggered Test Suite: ${executionId}`);

    // Monitor test suite
    const completedTestIds = new Set();
    const results = { passed: [], failed: [] };
    let attempts = 0;

    while (attempts++ < CONFIG.MAX_ATTEMPTS) {
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
              `Test [${test.testName} (id: ${test.id})] - Status: ${test.status}`
            );
            results[test.status === "passed" ? "passed" : "failed"].push(test);
          }
        });

      if (
        CONFIG.TEST_SUITE_EXECUTION_TERMINAL_STATUSES.includes(
          testSuiteExecution.status
        )
      ) {
        core.info(
          `Test suite completed with status: ${testSuiteExecution.status}`
        );
        break;
      }

      await new Promise((res) => setTimeout(res, CONFIG.WAIT_TIME));
    }

    // Generate summary
    const summary = [
      `Total tests: ${results.passed.length + results.failed.length}`,
      results.failed.length > 0 &&
        `${results.failed.length} tests failed: ${results.failed
          .map((t) => `${t.testName} (${t.id})`)
          .join(", ")}`,
      results.passed.length > 0 &&
        `${results.passed.length} tests passed: ${results.passed
          .map((t) => `${t.testName} (${t.id})`)
          .join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (results.failed.length === 0) {
      core.info(summary);
    } else {
      core.setFailed(summary);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
