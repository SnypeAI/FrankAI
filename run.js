import { spawn } from 'child_process';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';

// Kill all child processes on exit
const processes = [];
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    processes.forEach(p => p.kill());
    process.exit(0);
});

// Determine if running on Windows
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

// Check if a command exists
const checkCommand = async (command) => {
    try {
        const checkCmd = isWindows ? 'where' : 'which';
        await new Promise((resolve, reject) => {
            const proc = spawn(checkCmd, [command], { shell: true });
            proc.on('exit', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`${command} not found`));
            });
        });
        return true;
    } catch (error) {
        return false;
    }
};

// Check environment before starting
const checkEnvironment = async () => {
    console.log(chalk.blue('Checking environment...'));

    // Check for npm
    if (!await checkCommand(isWindows ? 'npm.cmd' : 'npm')) {
        console.error(chalk.red('Error: npm is not installed or not in PATH'));
        console.log(chalk.yellow('Please install Node.js from https://nodejs.org/'));
        process.exit(1);
    }

    // Check for python
    if (!await checkCommand('python')) {
        console.error(chalk.red('Error: python is not installed or not in PATH'));
        console.log(chalk.yellow('Please install Python from https://python.org/'));
        process.exit(1);
    }

    // Check if package.json exists
    if (!existsSync('package.json')) {
        console.error(chalk.red('Error: package.json not found'));
        console.log(chalk.yellow('Please ensure you are in the correct directory'));
        process.exit(1);
    }

    // Check if backend exists
    if (!existsSync(join('backend', 'src', 'main.py'))) {
        console.error(chalk.red('Error: backend/src/main.py not found'));
        console.log(chalk.yellow('Please ensure the backend code is present'));
        process.exit(1);
    }

    console.log(chalk.green('Environment check passed'));
};

// Start all services
const startServices = async () => {
    await checkEnvironment();

    // Start Python server
    console.log(chalk.blue('\nStarting Python Transcription Server...'));
    const python = spawn('python', ['backend/src/main.py'], {
        shell: isWindows,
        stdio: 'inherit'
    });
    processes.push(python);

    // Wait for Python server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start Express server using the root package.json script
    console.log(chalk.blue('\nStarting Express Server...'));
    const express = spawn(npmCmd, ['run', 'backend'], {
        shell: isWindows,
        stdio: 'inherit'
    });
    processes.push(express);

    // Start Next.js
    console.log(chalk.blue('\nStarting Frontend...'));
    const frontend = spawn(npmCmd, ['run', 'dev'], {
        shell: isWindows,
        stdio: 'inherit'
    });
    processes.push(frontend);
};

// Handle any process errors
processes.forEach(p => {
    p.on('error', (err) => {
        console.error(chalk.red(`Process error: ${err.message}`));
        processes.forEach(p => p.kill());
        process.exit(1);
    });
});

// Start everything
startServices().catch(error => {
    console.error(chalk.red('Error starting services:', error));
    process.exit(1); 
}); 