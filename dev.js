import { spawn } from 'child_process';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to create a timestamp
const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

// Helper to create a prefixed logger
const createLogger = (prefix, color) => (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
        if (line.trim()) {
            console.log(color(`${timestamp()} [${prefix}] ${line}`));
        }
    });
};

// Kill all child processes on exit
const childProcesses = [];
process.on('SIGINT', () => {
    console.log(chalk.yellow('\nShutting down all services...'));
    childProcesses.forEach(proc => proc.kill());
    process.exit();
});

// Check if .env exists
const checkEnv = async () => {
    try {
        const fs = await import('fs');
        if (!fs.existsSync(join(__dirname, '.env'))) {
            console.error(chalk.red('Error: .env file is missing. Please create one based on .env.example'));
            process.exit(1);
        }
    } catch (error) {
        console.error(chalk.red('Error checking .env file:', error));
        process.exit(1);
    }
};

// Start all services
const startServices = async () => {
    await checkEnv();

    // Start Python transcription server
    console.log(chalk.yellow('\nStarting Transcription Server (Python)...'));
    const pythonServer = spawn('source ../venv/bin/activate && python main.py', {
        cwd: join(__dirname, 'backend', 'src'),
        env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
        },
        shell: true
    });
    childProcesses.push(pythonServer);

    pythonServer.stdout.on('data', createLogger('TRANSCRIPTION', chalk.blue));
    pythonServer.stderr.on('data', createLogger('TRANSCRIPTION ERROR', chalk.blue.bold));

    // Wait for Python server to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start Express server
    console.log(chalk.yellow('\nStarting Express Server (Node.js)...'));
    const expressServer = spawn('npm', ['run', 'dev'], {
        cwd: join(__dirname, 'backend'),
        env: { 
            ...process.env,
            DEBUG: 'express:*',
            NODE_ENV: 'development'
        }
    });
    childProcesses.push(expressServer);

    expressServer.stdout.on('data', createLogger('EXPRESS', chalk.green));
    expressServer.stderr.on('data', createLogger('EXPRESS ERROR', chalk.green.bold));

    // Wait for Express server to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start Next.js frontend
    console.log(chalk.yellow('\nStarting Frontend (Next.js)...'));
    const frontend = spawn('npm', ['run', 'dev'], {
        cwd: __dirname,
        env: { 
            ...process.env,
            DEBUG: '*',
            NODE_ENV: 'development'
        }
    });
    childProcesses.push(frontend);

    frontend.stdout.on('data', createLogger('FRONTEND', chalk.red));
    frontend.stderr.on('data', createLogger('FRONTEND ERROR', chalk.red.bold));
};

// Handle process errors
process.on('unhandledRejection', (error) => {
    console.error(chalk.red('Unhandled rejection:', error));
    childProcesses.forEach(proc => proc.kill());
    process.exit(1);
});

// Start everything
startServices().catch(error => {
    console.error(chalk.red('Error starting services:', error));
    process.exit(1);
}); 