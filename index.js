const core = require('@actions/core');
const fetch = require('node-fetch');
const minimist = require('minimist');


function getInput(name) {
  // If running in GitHub Actions
  if (process.env.GITHUB_ACTIONS === 'true') {
    return core.getInput(name);
  }

  // Otherwise, parse command-line args
  const args = minimist(process.argv.slice(2));
  return args[name.replace(/-/g, '_')] || args[name];
}

async function run() {
  try {
    core.info('Starting test suite execution');
    const testSuiteId = getInput('test_suite_id');
    const baseUrl = getInput('api_base_url');

    if (!testSuiteId || !baseUrl) {
      throw new Error('Missing required inputs');
    }

    const url = `${baseUrl}/test-suite-executions/${testSuiteId}/execute-test-suite`;
    core.info(`Triggering test suite: ${url}`);

    // Trigger test suite
    const triggerResponse = await fetch(url, {
      method: 'POST'
    });

    if (!triggerResponse.ok) {
      const error = await triggerResponse.json();
      throw new Error(`Failed to trigger test suite: ${triggerResponse.status} - ${JSON.stringify(error)}`);
    }

    const triggerData = await triggerResponse.json();
    const executionId = triggerData.id;
    core.info(`Triggered Test Suite: ${executionId}`);

    // Monitor test suite
    const completedTestIds = new Set();
    let status = '';
    let allPassed = true;
    let done = false;
    let attempts = 0;

    while (!done) {
      const statusResponse = await fetch(`${baseUrl}/test-suite-executions/${executionId}/test-executions`);
      if (!statusResponse.ok) {
        throw new Error(`Failed to fetch status: ${statusResponse.status}`);
      }

      const { testSuiteExecution, testExecutions } = await statusResponse.json();
      status = testSuiteExecution.status;
      core.info(`Suite Status: ${status}`);

      let completeCount = 0;
      allPassed = true;

      for (const test of testExecutions) {
        if (!completedTestIds.has(test.id)) {
          core.info(`Test ${test.testName} (${test.id}) - Status: ${test.status}`);
          if (['passed', 'failed', 'canceled', 'error'].includes(test.status)) {
            completedTestIds.add(test.id);
            completeCount++;
          }
          if (test.status === 'failed') {
            allPassed = false;
          }
        }
      }

      if (status === 'completed' || status === 'failed' || status === 'canceled') {
        if (status === 'failed' || status === 'canceled') {
          core.setFailed('Test suite failed or canceled.');
        } else {
          core.info('Test suite completed successfully.');
        }
        done = true;
      } else {
        await new Promise(res => setTimeout(res, 5000));
        attempts++;
        if (attempts > 20) {
          throw new Error('Monitoring timed out after 20 attempts.');
        }
      }
    }

    if (!allPassed) {
      core.setFailed('Some tests failed.');
    } else {
      core.info('All tests passed!');
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
