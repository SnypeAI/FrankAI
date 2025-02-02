import { spawn } from 'child_process';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';

// Define service colors
const colors = {
    system: chalk.blue,
    python: chalk.cyan,
    express: chalk.magenta,
    frontend: chalk.hex('#A020F0'), // Purple
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow
};

// Custom log handler for Next.js
const handleNextOutput = (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
        if (!line.trim()) return;
        
        // Color different types of Next.js logs
        if (line.includes('ERROR')) {
            console.log(colors.error(line));
        } else if (line.includes('WARN')) {
            console.log(colors.warning(line));
        } else if (line.includes('ready') || line.includes('success') || line.includes('✓')) {
            console.log(colors.success(line));
        } else if (line.includes('GET') || line.includes('POST') || line.includes('event')) {
            // Add purple color to all Next.js route/event logs
            console.log(colors.frontend(line));
        } else {
            // Default purple for other Next.js logs
            console.log(colors.frontend(line));
        }
    });
};

// Custom log handler for Express/nodemon
const handleExpressOutput = (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
        if (!line.trim()) return;
        
        // Color different types of Express logs
        if (line.includes('ERROR') || line.includes('error')) {
            console.log(colors.error(line));
        } else if (line.includes('WARN') || line.includes('warning')) {
            console.log(colors.warning(line));
        } else if (line.includes('npm run') || line.includes('nodemon')) {
            console.log(colors.express(line));
        } else {
            // Default pink for other Express logs
            console.log(colors.express(line));
        }
    });
};

// Kill all child processes on exit
const processes = [];
process.on('SIGINT', () => {
    console.log('\n' + colors.system('Shutting down...'));
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
    console.log(colors.system('Checking environment...'));

    // Check for npm
    if (!await checkCommand(isWindows ? 'npm.cmd' : 'npm')) {
        console.error(colors.error('Error: npm is not installed or not in PATH'));
        console.log(colors.warning('Please install Node.js from https://nodejs.org/'));
        process.exit(1);
    }

    // Check for python
    if (!await checkCommand('python')) {
        console.error(colors.error('Error: python is not installed or not in PATH'));
        console.log(colors.warning('Please install Python from https://python.org/'));
        process.exit(1);
    }

    // Check if package.json exists
    if (!existsSync('package.json')) {
        console.error(colors.error('Error: package.json not found'));
        console.log(colors.warning('Please ensure you are in the correct directory'));
        process.exit(1);
    }

    // Check if backend exists
    if (!existsSync(join('backend', 'src', 'main.py'))) {
        console.error(colors.error('Error: backend/src/main.py not found'));
        console.log(colors.warning('Please ensure the backend code is present'));
        process.exit(1);
    }

    console.log(colors.success('Environment check passed\n'));
};

// Start all services
const startServices = async () => {
    await checkEnvironment();

    // Start Python server
    console.log(colors.python('Starting Python Transcription Server...'));
    const python = spawn('python', ['backend/src/main.py'], {
        shell: isWindows,
        stdio: 'inherit'
    });
    processes.push(python);

    // Wait for Python server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start Express server with custom output handling
    console.log(colors.express('\nStarting Express Server...'));
    const express = spawn(npmCmd, ['run', 'backend'], {
        shell: isWindows,
        stdio: ['inherit', 'pipe', 'pipe'] // Pipe stdout and stderr for custom handling
    });
    express.stdout.on('data', handleExpressOutput);
    express.stderr.on('data', handleExpressOutput);
    processes.push(express);

    // Start Next.js with custom output handling
    console.log(colors.frontend('\nStarting Frontend...'));
    const frontend = spawn(npmCmd, ['run', 'dev'], {
        shell: isWindows,
        stdio: ['inherit', 'pipe', 'pipe'] // Pipe stdout and stderr for custom handling
    });
    frontend.stdout.on('data', handleNextOutput);
    frontend.stderr.on('data', handleNextOutput);
    processes.push(frontend);
};

// Handle any process errors
processes.forEach(p => {
    p.on('error', (err) => {
        console.error(colors.error(`Process error: ${err.message}`));
        processes.forEach(p => p.kill());
        process.exit(1);
    });
});

// Start everything
startServices().catch(error => {
    console.error(colors.error('Error starting services: ' + error));
    process.exit(1); 
}); 