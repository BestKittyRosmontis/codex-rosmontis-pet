import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('This release builder requires Windows x64.');
}
const runtimeIndex = process.argv.indexOf('--runtime-dir');
const runtimeDir = path.resolve(runtimeIndex >= 0 ? process.argv[runtimeIndex + 1] : path.join(root, 'node_modules'));
const runtimeExe = path.join(runtimeDir, 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(runtimeExe)) throw new Error('Electron runtime missing. Run npm ci first.');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid release version.');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (!tracked.length) throw new Error('No tracked source files. Stage or commit the source first.');
const bundleName = `Codex-Rosmontis-Pet-${manifest.version}-Windows`;
const outDir = path.join(root, 'dist', `build-${Date.now()}`);
const stage = path.join(outDir, bundleName);
fs.mkdirSync(stage, { recursive: true });
function inside(base, target) {
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
function walk(base) {
  const files = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in release files.');
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
    else throw new Error('Unsupported release file type.');
  }
  return files;
}
for (const relative of tracked) {
  if (/^(?:\.git|dist|node_modules)(?:\/|$)/.test(relative) || relative === 'package-files.json') {
    throw new Error(`Generated file must not be tracked: ${relative}`);
  }
  const source = path.resolve(root, relative);
  const destination = path.resolve(stage, relative);
  if (!inside(root, source) || !inside(stage, destination) || !fs.lstatSync(source).isFile()) {
    throw new Error(`Invalid source file: ${relative}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
// Bundle only Electron's installed distribution, matching the original portable runtime layout.
const electronDist = path.join(runtimeDir, 'electron', 'dist');
walk(electronDist);
fs.cpSync(electronDist, path.join(stage, 'node_modules/electron/dist'), { recursive: true });
execFileSync(process.execPath, [path.join(stage, 'scripts/validate-package.mjs')], { cwd: stage, stdio: 'inherit', windowsHide: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const files = walk(stage).map(full => ({
  path: path.relative(stage, full).split(path.sep).join('/'),
  sha256: sha256(fs.readFileSync(full)),
})).sort((a, b) => a.path.localeCompare(b.path, 'en'));
fs.writeFileSync(path.join(stage, 'package-files.json'), JSON.stringify({ files }, null, 2) + '\n');
const zip = path.join(outDir, `${bundleName}.zip`);
const quotePS = value => `'${value.replaceAll("'", "''")}'`;
const ps = `$ProgressPreference = 'SilentlyContinue'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quotePS(stage)}, ${quotePS(zip)}, [IO.Compression.CompressionLevel]::Optimal, $true)`;
execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { stdio: 'inherit', windowsHide: true });
const checksum = sha256(fs.readFileSync(zip));
fs.writeFileSync(zip + '.sha256', `${checksum}  ${path.basename(zip)}\n`);
console.log(JSON.stringify({ version: manifest.version, fileCount: files.length, archive: zip, bytes: fs.statSync(zip).size, sha256: checksum }, null, 2));
