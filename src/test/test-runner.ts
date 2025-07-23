/**
 * Test Runner Script
 * 
 * This script runs all tests and generates reports
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

interface TestSuite {
  name: string;
  command: string;
  description: string;
}

const testSuites: TestSuite[] = [
  {
    name: 'Frontend Unit Tests',
    command: 'npm run test:run',
    description: 'React component and service tests'
  },
  {
    name: 'Backend Unit Tests', 
    command: 'cargo test',
    description: 'Rust backend logic tests'
  },
  {
    name: 'Frontend Integration Tests',
    command: 'npm run test:run -- --reporter=verbose integration.test.tsx',
    description: 'End-to-end component integration tests'
  }
];

async function runTest(suite: TestSuite): Promise<boolean> {
  console.log(`\n🧪 Running ${suite.name}...`);
  console.log(`📝 ${suite.description}`);
  console.log(`⚡ Command: ${suite.command}\n`);

  return new Promise((resolve) => {
    const [cmd, ...args] = suite.command.split(' ');
    const child = spawn(cmd, args, { 
      stdio: 'inherit',
      cwd: suite.name.includes('Backend') ? './src-tauri' : '.'
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${suite.name} passed!`);
        resolve(true);
      } else {
        console.log(`❌ ${suite.name} failed with code ${code}`);
        resolve(false);
      }
    });
  });
}

async function generateTestReport(results: Array<{suite: TestSuite, passed: boolean}>) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => r.passed === false).length,
      success_rate: `${Math.round((results.filter(r => r.passed).length / results.length) * 100)}%`
    },
    suites: results.map(r => ({
      name: r.suite.name,
      description: r.suite.description,
      status: r.passed ? 'PASSED' : 'FAILED',
      command: r.suite.command
    }))
  };

  writeFileSync('./test-report.json', JSON.stringify(report, null, 2));
  
  console.log('\n📊 Test Report Generated');
  console.log('=========================');
  console.log(`Total Suites: ${report.summary.total}`);
  console.log(`Passed: ${report.summary.passed}`);
  console.log(`Failed: ${report.summary.failed}`);
  console.log(`Success Rate: ${report.summary.success_rate}`);
  console.log(`Report saved to: ./test-report.json\n`);
}

async function main() {
  console.log('🚀 Orchestra Manager Test Suite');
  console.log('================================');
  
  const results: Array<{suite: TestSuite, passed: boolean}> = [];
  
  for (const suite of testSuites) {
    const passed = await runTest(suite);
    results.push({ suite, passed });
  }
  
  await generateTestReport(results);
  
  const allPassed = results.every(r => r.passed);
  console.log(allPassed ? 
    '🎉 All tests passed! Orchestra Manager is ready for production.' : 
    '⚠️  Some tests failed. Please review the results above.'
  );
  
  process.exit(allPassed ? 0 : 1);
}

if (require.main === module) {
  main().catch(console.error);
}