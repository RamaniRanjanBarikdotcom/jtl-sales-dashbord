/**
 * build.js — Full build script for JTL Sync Engine
 *
 * Produces standalone executables in ./release/:
 *   jtl-sync-engine-win.exe    (Windows x64)
 *   jtl-sync-engine-macos      (macOS x64)
 *   jtl-sync-engine-linux      (Linux x64)
 *
 * Run: node build.js
 *   Or: npm run build:exe
 *
 * Requires: npm install  (all devDependencies must be installed)
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT    = __dirname;
const SRC_PUB = path.join(ROOT, 'src', 'ui', 'public');
const DST_PUB = path.join(ROOT, 'dist', 'ui', 'public');
const RELEASE = path.join(ROOT, 'release');

function run(cmd, label) {
    console.log(`\n▶  ${label}`);
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

function banner(msg) {
    const line = '═'.repeat(54);
    console.log(`\n\x1b[36m${line}\x1b[0m`);
    console.log(`\x1b[36m  ${msg}\x1b[0m`);
    console.log(`\x1b[36m${line}\x1b[0m`);
}

// ── 1. TypeScript compile ────────────────────────────────────────────────────
banner('Step 1/4 — Compiling TypeScript');
run('npx tsc', 'tsc');

// ── 2. Copy HTML assets into dist ────────────────────────────────────────────
banner('Step 2/4 — Copying UI assets');
console.log(`  ${SRC_PUB}  →  ${DST_PUB}`);
if (fs.existsSync(DST_PUB)) fs.rmSync(DST_PUB, { recursive: true });
fs.cpSync(SRC_PUB, DST_PUB, { recursive: true });
console.log('  ✓ Assets copied');

// ── 3. Ensure release/ exists + write helper files ───────────────────────────
banner('Step 3/4 — Preparing release directory');
if (!fs.existsSync(RELEASE)) fs.mkdirSync(RELEASE);

fs.writeFileSync(path.join(RELEASE, 'START.bat'), `@echo off
title JTL Sync Engine
color 0A

echo.
echo  ================================================
echo   JTL Analytics -- Sync Engine v1.0
echo  ================================================
echo.
echo  Starting engine...
echo  Browser will open automatically.
echo.
echo  DO NOT close this window while syncing is active.
echo  To stop the engine, close this window.
echo.

cd /d "%~dp0"
jtl-sync-engine-win.exe

echo.
echo  Engine stopped. Press any key to exit.
pause > nul
`);

fs.writeFileSync(path.join(RELEASE, 'HOW-TO-USE.txt'), `JTL Analytics -- Sync Engine v1.0
==================================

QUICK START (takes 2 minutes)
------------------------------

1. Double-click  START.bat
   (or run jtl-sync-engine-win.exe directly)

2. Your browser opens automatically.

3. Follow the Setup Wizard:

   Step 1 - Connection Mode
     - JTL on THIS machine  -> leave SSH Tunnel OFF, click Next
     - JTL is a REMOTE server -> turn SSH Tunnel ON
       Fill in: Server IP, Windows Username, Windows Password
       Click "Test SSH Connection" -> must show a tick
       Click Next

   Step 2 - Database Access
     - Database name: eazybusiness (don't change)
     - Enter your SQL username & password
       (or turn on Windows Authentication if JTL uses that)
     - Click "Test DB Connection" -> must show a tick
     - Click Next

   Step 3 - Backend API
     - Enter your Backend URL  (e.g. https://analytics.yourcompany.com)
     - Enter your Sync API Key (from the Admin panel)
     - Enter your Tenant ID    (from the Admin panel)
     - Click "Test API Connection" -> must show a tick
     - Click Next

   Step 4 - Review & Connect
     - Check everything looks right
     - Click "Connect & Start Engine"
     - Browser shows the dashboard in 5 seconds

4. Done! The engine syncs automatically:
     Orders    every 15 min
     Inventory every 30 min
     Products  every hour
     Customers every hour


DASHBOARD
---------
Open http://localhost:3333 in any browser.
Default login:  admin / changeme


FILES CREATED BY THE ENGINE
-----------------------------
  .env           - your saved configuration (DO NOT share this file)
  logs/          - sync log files
  watermarks/    - timestamps of last successful sync per module


KEEPING IT RUNNING 24/7
------------------------
To keep the engine running without a console window, add it to
Windows Task Scheduler:

  1. Open Task Scheduler -> Create Basic Task
  2. Name: JTL Sync Engine
  3. Trigger: When the computer starts
  4. Action: Start a program
  5. Program: C:\\path\\to\\jtl-sync-engine-win.exe
  6. Finish
`);

console.log(`  ✓ ./release/ ready  (START.bat + HOW-TO-USE.txt written)`);

// ── 4. Package with @yao-pkg/pkg ─────────────────────────────────────────────
banner('Step 4/4 — Building executables (this takes 2-5 min on first run)');
console.log('  Targets: Windows x64, macOS x64, Linux x64\n');

run(
    [
        'npx pkg .',
        '--compress GZip',
        '--output release/jtl-sync-engine',
    ].join(' '),
    'pkg'
);

// ── Rename Windows output to .exe ────────────────────────────────────────────
// pkg names the windows binary with -win suffix, no .exe
const winRaw = path.join(RELEASE, 'jtl-sync-engine-win.exe');
const winOut = path.join(RELEASE, 'jtl-sync-engine-win.exe');
if (!fs.existsSync(winRaw)) {
    // pkg may output as jtl-sync-engine-win without extension on some versions
    const winNoExt = path.join(RELEASE, 'jtl-sync-engine-win');
    if (fs.existsSync(winNoExt)) {
        fs.renameSync(winNoExt, winOut);
        console.log('  Renamed → jtl-sync-engine-win.exe');
    }
}

// ── Done ─────────────────────────────────────────────────────────────────────
banner('Build Complete!');
const files = fs.readdirSync(RELEASE);
files.forEach(f => {
    const p    = path.join(RELEASE, f);
    const mb   = (fs.statSync(p).size / 1024 / 1024).toFixed(1);
    const icon = f.endsWith('.exe') ? '🪟' : f.includes('macos') ? '🍎' : '🐧';
    console.log(`  ${icon}  ${f.padEnd(36)} ${mb} MB`);
});
console.log(`
  ┌─ How to distribute ───────────────────────────────────────┐
  │  Windows : send  release/jtl-sync-engine-win.exe          │
  │  macOS   : send  release/jtl-sync-engine-macos            │
  │  Linux   : send  release/jtl-sync-engine-linux            │
  │                                                            │
  │  User just double-clicks → browser opens → setup wizard   │
  └────────────────────────────────────────────────────────────┘
`);
