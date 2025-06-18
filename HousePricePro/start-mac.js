#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🏠 Starting HomePricer for macOS...\n');

// Check Python installation
function checkPython() {
  return new Promise((resolve) => {
    const pythonCommands = ['python3', 'python', '/usr/bin/python3'];
    let found = false;
    
    for (const cmd of pythonCommands) {
      try {
        const process = spawn(cmd, ['--version'], { stdio: 'pipe' });
        process.on('close', (code) => {
          if (code === 0 && !found) {
            console.log(`✅ Found Python: ${cmd}`);
            process.env.PYTHON_PATH = cmd;
            found = true;
            resolve(cmd);
          }
        });
        process.on('error', () => {
          // Continue to next command
        });
      } catch (e) {
        // Continue to next command
      }
    }
    
    setTimeout(() => {
      if (!found) {
        console.log('⚠️  Python not found, using python3 as default');
        resolve('python3');
      }
    }, 1000);
  });
}

// Check required Python packages
function checkPythonPackages() {
  return new Promise((resolve) => {
    const pythonPath = process.env.PYTHON_PATH || 'python3';
    const checkCmd = spawn(pythonPath, ['-c', 'import sklearn, numpy, pandas; print("OK")']);
    
    let output = '';
    checkCmd.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    checkCmd.on('close', (code) => {
      if (code === 0 && output.includes('OK')) {
        console.log('✅ Python packages installed');
        resolve(true);
      } else {
        console.log('❌ Missing Python packages. Run: pip3 install scikit-learn numpy pandas');
        resolve(false);
      }
    });
    
    checkCmd.on('error', () => {
      console.log('❌ Could not check Python packages');
      resolve(false);
    });
  });
}

// Start the server
async function startServer() {
  console.log('\n🚀 Starting development server...\n');
  
  const serverProcess = spawn('npx', ['tsx', 'server/index.ts'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  });
  
  serverProcess.on('error', (error) => {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  });
  
  serverProcess.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
    process.exit(code);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    serverProcess.kill('SIGINT');
  });
}

// Main execution
async function main() {
  try {
    await checkPython();
    const packagesOk = await checkPythonPackages();
    
    if (!packagesOk) {
      console.log('\n💡 To install missing packages, run:');
      console.log('   pip3 install scikit-learn numpy pandas\n');
      console.log('Continuing anyway (server will work but ML predictions may fail)...\n');
    }
    
    await startServer();
  } catch (error) {
    console.error('Startup error:', error);
    process.exit(1);
  }
}

main();