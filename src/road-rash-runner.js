const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const runFile = promisify(execFile);
const officialRepo = 'dubrovskiy-yevhen-stakelogic/road-rash-jailbreak';
const maxArchiveBytes = 3 * 1024 ** 3;

// Validation and extraction run in the Windows runtime that the official installer requires.
// ZipArchive reads the ZIP directory before any file is written, including ZIP64 entries.
const extractScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($env:VR4ALL_RR_ARCHIVE)
try {
  if ($archive.Entries.Count -lt 1 -or $archive.Entries.Count -gt 5000) { throw 'Release ZIP must contain 1 to 5,000 entries' }
  $seen = New-Object 'System.Collections.Generic.Dictionary[string,bool]' ([System.StringComparer]::OrdinalIgnoreCase)
  $entries = New-Object System.Collections.ArrayList
  $scriptRoots = New-Object System.Collections.ArrayList
  [long]$total = 0
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName
    $directory = $name.EndsWith('/')
    $relative = $name.TrimEnd('/')
    if (!$relative -or $relative.Length -gt 4096 -or $name.StartsWith('/') -or $name.Contains('\')) { throw "Release ZIP contains an unsafe path: $name" }
    $parts = $relative.Split('/')
    foreach ($part in $parts) {
      if (!$part -or $part -eq '.' -or $part -eq '..' -or $part -match '[:\x00-\x1f\x7f]' -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') {
        throw "Release ZIP contains an unsafe path: $name"
      }
    }
    if ($seen.ContainsKey($relative)) { throw 'Release ZIP contains duplicate paths' }
    $seen.Add($relative, $directory)
    $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
    if (($unixType -ne 0 -and $unixType -ne $(if ($directory) { 0x4000 } else { 0x8000 })) -or ($entry.ExternalAttributes -band 0x400) -ne 0) {
      throw 'Release ZIP contains a link or unsupported file type'
    }
    if ($directory -and ($entry.Length -ne 0 -or $entry.CompressedLength -ne 0)) { throw 'Release ZIP directory contains file data' }
    $total += $entry.Length
    if ($entry.Length -lt 0 -or $total -gt 8589934592) { throw 'Release ZIP exceeds the 8 GB extraction limit' }
    if (!$directory -and $relative -match '^(?:[^/]+/)?scripts/install-player\.ps1$') {
      [void]$scriptRoots.Add($relative.Substring(0, $relative.Length - 'scripts/install-player.ps1'.Length))
    }
    [void]$entries.Add(@{ ZipEntry = $entry; Name = $relative; Directory = $directory })
  }
  foreach ($item in $entries) {
    $parts = $item.Name.Split('/')
    for ($i = 1; $i -lt $parts.Length; $i++) {
      $ancestor = [string]::Join('/', $parts, 0, $i)
      if ($seen.ContainsKey($ancestor) -and !$seen[$ancestor]) { throw 'Release ZIP contains conflicting paths' }
    }
  }
  if ($scriptRoots.Count -ne 1) { throw 'Official player package is missing its installer script' }
  $prefix = [string]$scriptRoots[0]
  if (!$seen.ContainsKey($prefix + 'release-manifest.json') -or $seen[$prefix + 'release-manifest.json']) { throw 'Official player package is missing its release manifest' }
  foreach ($item in $entries) {
    if ($prefix -and !$item.Name.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -and !($item.Directory -and $item.Name -eq $prefix.TrimEnd('/'))) {
      throw 'Official player package has an unexpected layout'
    }
  }
  $destination = [System.IO.Path]::GetFullPath($env:VR4ALL_RR_DESTINATION)
  [void][System.IO.Directory]::CreateDirectory($destination)
  foreach ($item in $entries) {
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destination, $item.Name.Replace('/', '\')))
    if (!$target.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Release ZIP contains an unsafe path: $($item.Name)" }
    if ($item.Directory) { [void][System.IO.Directory]::CreateDirectory($target); continue }
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target))
    $source = $item.ZipEntry.Open()
    $output = New-Object System.IO.FileStream($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try {
      $buffer = New-Object byte[] 65536
      [long]$copied = 0
      while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $copied += $read
        if ($copied -gt $item.ZipEntry.Length) { throw 'Release ZIP file expands beyond its declared size' }
        $output.Write($buffer, 0, $read)
      }
      if ($copied -ne $item.ZipEntry.Length) { throw 'Release ZIP file has an incorrect size' }
    } finally { $output.Dispose(); $source.Dispose() }
  }
  [Console]::Out.WriteLine($prefix)
} finally { $archive.Dispose() }
`;

function powerShellError(error) {
  const raw = String(error.stderr || error.message || '');
  const xmlMessage = raw.match(/<S S="Error">([\s\S]*?)<\/S>/)?.[1];
  const message = xmlMessage || raw;
  return message.replace(/_x[0-9a-f]{4}_/gi, ' ')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_whole, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity])
    .trim().slice(0, 500);
}

async function extractReleaseZip(archivePath, destination) {
  const existing = await fsp.lstat(destination).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) throw new Error('Release staging folder already exists');
  const encoded = Buffer.from(extractScript, 'utf16le').toString('base64');
  const environment = { ...process.env, VR4ALL_RR_ARCHIVE: archivePath, VR4ALL_RR_DESTINATION: destination };
  try {
    const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: environment, windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024,
    });
    const prefix = stdout.trim().replace(/\/$/, '');
    if (prefix && (prefix.includes('\\') || prefix.includes('..') || prefix.includes(':') || prefix.includes('/'))) {
      throw new Error('Official player package has an unexpected layout');
    }
    return prefix ? path.join(destination, prefix) : destination;
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Could not safely extract official player ZIP: ${powerShellError(error)}`);
  }
}

function validateRelease(release) {
  if (!release || release.stale) throw new Error('Official release metadata is missing or stale');
  if (!/^sha256:[a-f0-9]{64}$/i.test(release.digest || '')) throw new Error('Official release needs a SHA-256 digest');
  if (!/^RoadRashJailbreak-[A-Za-z0-9._-]+\.zip$/i.test(release.assetName || '')) throw new Error('Official release has an unexpected ZIP name');
  let url;
  try { url = new URL(release.downloadUrl); }
  catch { throw new Error('Official release has an invalid download URL'); }
  const prefix = `/${officialRepo}/releases/download/`;
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password
    || url.search || url.hash || !url.pathname.startsWith(prefix)) throw new Error('Choose an official Road Rash release');
  const suffix = url.pathname.slice(prefix.length).split('/');
  if (suffix.length !== 2 || !suffix[0] || decodeURIComponent(suffix[1]) !== release.assetName
    || release.tag && decodeURIComponent(suffix[0]) !== release.tag) throw new Error('Choose an official Road Rash release');
  if (release.size != null && (!Number.isSafeInteger(release.size) || release.size <= 0 || release.size > maxArchiveBytes)) {
    throw new Error('Official release ZIP has an invalid size');
  }
  return url.href;
}

async function downloadRelease(url, release, target, fetchImpl, signal) {
  const timeout = AbortSignal.timeout(10 * 60 * 1000);
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'VR4All-road-rash-player' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok || !response.body) throw new Error(`Official player download failed (${response.status})`);
  let count = 0;
  const hash = crypto.createHash('sha256');
  const bounded = new Transform({ transform(chunk, _encoding, done) {
    count += chunk.length;
    if (count > maxArchiveBytes) return done(new Error('Official player ZIP exceeds the download size limit'));
    hash.update(chunk);
    done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), bounded, fs.createWriteStream(target, { flags: 'wx' }), { signal });
  if (!count || release.size != null && count !== release.size) throw new Error('Official player ZIP size differs from release metadata');
  if (`sha256:${hash.digest('hex')}` !== release.digest.toLowerCase()) throw new Error('Official player ZIP failed SHA-256 verification');
}

function runInstaller(packageRoot, input, spawnImpl) {
  const script = path.join(packageRoot, 'scripts', 'install-player.ps1');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Target', 'Quest', '-DiscImage', input.discImage, '-Serial', input.serial, '-HdMedia', 'Original'];
  if (input.adbPath) args.push('-Adb', input.adbPath);
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl('powershell.exe', args, { cwd: packageRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: input.signal }); }
    catch (error) { reject(error); return; }
    const recorder = () => {
      let pending = '';
      return {
        record(chunk) {
          pending += String(chunk);
          const lines = pending.split(/\r?\n/);
          pending = (lines.pop() || '').slice(-1000);
          for (const line of lines) if (line.trim()) input.onLog(line.trim().slice(0, 500));
        },
        flush() { if (pending.trim()) input.onLog(pending.trim().slice(0, 500)); },
      };
    };
    const stdout = recorder();
    const stderr = recorder();
    child.stdout.on('data', (chunk) => stdout.record(chunk));
    child.stderr.on('data', (chunk) => stderr.record(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      stdout.flush();
      stderr.flush();
      code === 0 ? resolve({ exitCode: 0, tag: input.release.tag })
        : reject(new Error(`Official Road Rash installer failed (exit ${code}); see activity for details`));
    });
  });
}

async function installRoadRashPlayer(input, options = {}) {
  const releaseUrl = validateRelease(input?.release);
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  if (typeof input.discImage !== 'string' || !path.isAbsolute(input.discImage)
    || !['.bin', '.cue', '.zip', '.7z'].includes(path.extname(input.discImage).toLowerCase())) {
    throw new Error('Choose an owned Road Rash disc image (.bin, .cue, .zip, or .7z)');
  }
  const disc = await fsp.stat(input.discImage).catch(() => null);
  if (!disc?.isFile() || !disc.size) throw new Error('Choose an existing nonempty Road Rash disc image');
  if (input.adbPath != null && (typeof input.adbPath !== 'string' || !input.adbPath.trim())) throw new Error('Choose an existing ADB path');
  const onLog = typeof input.onLog === 'function' ? input.onLog : () => {};
  const staging = await fsp.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'vr4all-road-rash-'));
  try {
    const archive = path.join(staging, 'player.zip');
    onLog(`Downloading official Road Rash ${input.release.tag || 'player'} package...`);
    await downloadRelease(releaseUrl, input.release, archive, options.fetchImpl || fetch, input.signal);
    onLog('Official Road Rash package SHA-256 verified.');
    const packageRoot = await extractReleaseZip(archive, path.join(staging, 'package'));
    onLog('Running the official Road Rash Quest installer...');
    return await runInstaller(packageRoot, { ...input, onLog }, options.spawnImpl || spawn);
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { extractReleaseZip, installRoadRashPlayer };
