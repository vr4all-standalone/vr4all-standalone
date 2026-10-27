const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const games = ['vice-city-vr', 'rdr1-vr', 'gta-sa-vr'];
const directories = ['.tools', '.downloads', '.android-sdk', '.gradle', '.android-user'];
const queues = new Map();
const inspect = (file) => fs.lstat(file).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });

async function directory(folder) {
  await fs.mkdir(folder, { recursive: true });
  const stat = await fs.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unexpected build tools directory or link: ${folder}`);
}

async function sameLink(file, target) {
  const stat = await inspect(file);
  if (!stat?.isSymbolicLink()) return false;
  if (await fs.realpath(file) !== await fs.realpath(target)) throw new Error(`Build tools link points outside the shared cache: ${file}`);
  return true;
}

// Move only missing entries. Conflicting older files are preserved for review,
// never overwritten or recursively deleted while adopting an existing cache.
async function mergeMissing(source, target) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in existing build tools: ${from}`);
    const existing = await inspect(to);
    if (!existing) await fs.rename(from, to);
    else if (entry.isFile() && existing.isFile() && existing.size === 0 && (await fs.stat(from)).size > 0) {
      await fs.rename(to, `${from}.previous-empty-${crypto.randomUUID()}`);
      await fs.rename(from, to);
    }
    else if (entry.isDirectory() && existing.isDirectory() && !existing.isSymbolicLink()) {
      await mergeMissing(from, to);
      if (!(await fs.readdir(from)).length) await fs.rmdir(from);
    }
  }
}

async function bindDirectory(local, target, log) {
  if (await sameLink(local, target)) return;
  const existing = await inspect(local);
  if (existing) {
    if (!existing.isDirectory()) throw new Error(`Unexpected existing build tools path: ${local}`);
    await mergeMissing(local, target);
    if ((await fs.readdir(local)).length) {
      const preserved = `${local}.previous-${crypto.randomUUID()}`;
      await fs.rename(local, preserved);
      log(`Preserved older overlapping tool files at ${preserved}.`);
    } else await fs.rmdir(local);
  }
  await fs.symlink(target, local, process.platform === 'win32' ? 'junction' : 'dir');
}

async function aliasCommandLineTools(shared) {
  // These authors use different directory names for the same pinned Google
  // release. Sharing this directory also avoids downloading its ZIP twice.
  const cli = path.join(shared, '.android-sdk', 'cmdline-tools');
  const latest = path.join(cli, 'latest'), versioned = path.join(cli, '15859902');
  for (const [source, alias] of [[versioned, latest], [latest, versioned]]) {
    if (await inspect(alias)) continue;
    const properties = await fs.readFile(path.join(source, 'source.properties'), 'utf8').catch(() => '');
    if (!/^Pkg\.Revision\s*=\s*22\.0\s*$/m.test(properties)) continue;
    const files = ['lib/sdkmanager-classpath.jar', 'bin/sdkmanager.bat'];
    const ready = await Promise.all(files.map((file) => fs.stat(path.join(source, file)).catch(() => null)));
    if (ready.every((stat) => stat?.isFile() && stat.size)) await fs.symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

async function findSharedJavaHome(workDir) {
  for (const name of ['temurin-jdk-21.0.11+10', 'jdk-21.0.11+10']) {
    const home = path.join(workDir, '.tools', name);
    const files = await Promise.all(['java.exe', 'javac.exe'].map((file) => fs.stat(path.join(home, 'bin', file)).catch(() => null)));
    if (files.every((stat) => stat?.isFile() && stat.size)) return home;
  }
  return null;
}

async function withSharedBuildTools(workDir, operation, log = () => {}) {
  if (!path.isAbsolute(workDir) || !games.includes(path.basename(workDir))) throw new Error('Choose a supported absolute game build directory');
  await directory(workDir);
  const parent = await fs.realpath(path.dirname(workDir));
  const key = process.platform === 'win32' ? parent.toLowerCase() : parent;
  const waiting = queues.has(key);
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  queues.set(key, queued);
  if (waiting) log('Waiting for the other build using these shared tools to finish.');
  await previous;
  try {
    const shared = path.join(parent, 'shared');
    await directory(shared);
    for (const name of directories) {
      const target = path.join(shared, name);
      // Prefer an existing installation, including one from another game.
      if (!await inspect(target)) {
        for (const game of [path.basename(workDir), ...games.filter((id) => id !== path.basename(workDir))]) {
          const sibling = path.join(parent, game);
          const siblingStat = await inspect(sibling);
          if (!siblingStat) continue;
          if (!siblingStat.isDirectory() || siblingStat.isSymbolicLink()) throw new Error(`Unexpected game build directory or link: ${sibling}`);
          const source = path.join(sibling, name);
          const sourceStat = await inspect(source);
          if (!sourceStat) continue;
          if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`Unexpected existing build tools link: ${source}`);
          await fs.rename(source, target);
          await fs.symlink(target, source, process.platform === 'win32' ? 'junction' : 'dir');
          log(`Reusing existing ${name} from ${game}.`);
          break;
        }
      }
      await directory(target);
      // Include every previous per-game installation before checking missing
      // packages. An empty current-game cache must not hide a complete sibling.
      for (const game of games) {
        const sibling = path.join(parent, game);
        const stat = await inspect(sibling);
        if (!stat) continue;
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unexpected game build directory or link: ${sibling}`);
        await bindDirectory(path.join(sibling, name), target, log);
      }
    }
    await aliasCommandLineTools(shared);
    log(`Shared build tools: ${shared}. Installed versions are reused across Vice City, RDR and San Andreas.`);
    const result = await operation(workDir);
    await aliasCommandLineTools(shared);
    return result;
  } finally {
    release();
    if (queues.get(key) === queued) queues.delete(key);
  }
}

module.exports = { withSharedBuildTools, findSharedJavaHome };
