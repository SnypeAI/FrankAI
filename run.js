import { spawn } from 'child_process';
import chalk from 'chalk';

// Kill all child processes on exit
const processes = [];
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    processes.forEach(p => p.kill());
    process.exit(0);
});

// Start Python server
console.log('\nStarting Python Transcription Server...');
const python = spawn('python', ['backend/src/main.py']);
python.stdout.pipe(process.stdout);
python.stderr.pipe(process.stderr);
processes.push(python);

// Wait for Python server to start
setTimeout(() => {
    // Start Express server
    console.log('\nStarting Express Server...');
    const express = spawn('npm', ['run', 'dev'], {
        cwd: './backend',
        stdio: 'inherit'
    });
    processes.push(express);

    // Start Next.js
    console.log('\nStarting Frontend...');
    const frontend = spawn('npm', ['run', 'dev'], {
        stdio: 'inherit'
    });
    processes.push(frontend);
}, 2000);

// Handle any process errors
processes.forEach(p => {
    p.on('error', (err) => {
        console.error(`Process error: ${err.message}`);
        processes.forEach(p => p.kill());
        process.exit(1);
    });
}); 