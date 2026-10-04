const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getWindowsDocumentsPath() {
    // 1. Check custom environment variable
    if (process.env.WINDOWS_DOCUMENTS_DIR) {
        return process.env.WINDOWS_DOCUMENTS_DIR;
    }

    // 2. If running natively on Windows
    if (process.platform === 'win32') {
        const userProfile = process.env.USERPROFILE || process.env.HOME;
        if (userProfile) {
            const candidates = [
                path.join(userProfile, 'OneDrive', 'Documents'),
                path.join(userProfile, 'Documents')
            ];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) return candidate;
            }
            return path.join(userProfile, 'Documents');
        }
    }

    // 3. If running on WSL / Linux
    let user = '';
    const cmdPaths = ['cmd.exe', '/mnt/c/WINDOWS/system32/cmd.exe', '/mnt/c/Windows/system32/cmd.exe'];
    for (const cmd of cmdPaths) {
        try {
            const out = execSync(`${cmd} /c "echo %USERNAME%"`, { stdio: ['ignore', 'pipe', 'ignore'] })
                .toString()
                .trim();
            if (out && !out.includes('%USERNAME%')) {
                user = out;
                break;
            }
        } catch {
            // ignore
        }
    }

    // Try extracting username from PATH (present in WSL)
    if (!user && process.env.PATH) {
        const match = process.env.PATH.match(/\/mnt\/c\/Users\/([^/:\\]+)/i);
        if (match && match[1]) {
            user = match[1];
        }
    }

    // Try checking /mnt/c/Users directory
    if (!user) {
        const usersDir = '/mnt/c/Users';
        if (fs.existsSync(usersDir)) {
            try {
                const ignored = new Set(['Public', 'Default', 'Default User', 'All Users']);
                const dirs = fs.readdirSync(usersDir).filter(name => !ignored.has(name) && !name.startsWith('.'));
                if (dirs.length > 0) {
                    user = dirs[0];
                }
            } catch {
                // ignore
            }
        }
    }

    if (user) {
        const basePath = `/mnt/c/Users/${user}`;
        const candidates = [
            path.join(basePath, 'OneDrive', 'Documents'),
            path.join(basePath, 'Documents')
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }
        return path.join(basePath, 'Documents');
    }

    return null;
}

if (process.env.CI) {
    process.exit(0);
}

const distDir = path.resolve(__dirname, '../dist');
if (!fs.existsSync(distDir)) {
    console.warn('[Copy Dist] Notice: "dist" directory not found, skipping copy.');
    process.exit(0);
}

const docsDir = getWindowsDocumentsPath();
if (!docsDir) {
    console.warn('[Copy Dist] Notice: Windows Documents folder not found. Skipping copy.');
    process.exit(0);
}

const targetDir = path.join(docsDir, 'dist');

try {
    fs.mkdirSync(docsDir, { recursive: true });
    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.cpSync(distDir, targetDir, { recursive: true });
    console.log(`[Copy Dist] Successfully copied dist to: ${targetDir}`);
} catch (err) {
    console.warn(`[Copy Dist] Notice: Could not copy dist to Windows (${err.message}). Skipping.`);
    process.exit(0);
}
