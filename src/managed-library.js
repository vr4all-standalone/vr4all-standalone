const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const defaultMaxBytes = 64 * 1024 ** 3;
const defaultMaxEntries = 30000;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safeField(value, field) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 256 || /[\x00-\x1f]/.test(value)) throw new Error(`Invalid ${field}`);
  return value;
}

async function inspect(source, limits) {
  const first = await fs.lstat(source).catch(() => null);
  if (!first || first.isSymbolicLink() || !first.isFile() && !first.isDirectory()) {
    throw new Error('Choose an existing regular file or folder without links');
  }
  const kind = first.isDirectory() ? 'directory' : 'file';
  const files = [];
  const folders = [];
  let bytes = 0;
  let entries = 0;
  const digest = crypto.createHash('sha256');
  async function visit(current, relative) {
    const children = await fs.readdir(current, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const childRelative = relative ? path.join(relative, child.name) : child.name;
      if (childRelative.length > 4096 || child.name === '.' || child.name === '..' || /[\x00-\x1f]/.test(child.name)) {
        throw new Error('Folder contains an unsafe path');
      }
      if (++entries > limits.maxEntries) throw new Error(`Game folder exceeds the ${limits.maxEntries.toLocaleString()} entry limit`);
      const childPath = path.join(current, child.name);
      const stat = await fs.lstat(childPath);
      if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error('Game folder contains a link or unsupported file');
      if (stat.isDirectory()) {
        folders.push(childRelative);
        digest.update(`D\0${childRelative}\0${stat.mtimeMs}\n`);
        await visit(childPath, childRelative);
      } else {
        bytes += stat.size;
        if (bytes > limits.maxBytes) throw new Error('Game files exceed the local library size limit');
        files.push(childRelative);
        digest.update(`F\0${childRelative}\0${stat.size}\0${stat.mtimeMs}\n`);
      }
    }
  }
  if (kind === 'file') {
    bytes = first.size;
    if (bytes > limits.maxBytes) throw new Error('Game file exceeds the local library size limit');
    digest.update(`F\0${first.size}\0${first.mtimeMs}\n`);
  } else {
    await visit(source, '');
    if (!files.length) throw new Error('Game folder has no files');
  }
  return { kind, bytes, files, folders, fingerprint: digest.digest('hex') };
}

class ManagedLibrary {
  constructor(root, options = {}) {
    if (typeof root !== 'string' || !root.trim()) throw new Error('A local library folder is required');
    this.root = path.resolve(root);
    this.limits = {
      maxBytes: options.maxBytes || defaultMaxBytes,
      maxEntries: options.maxEntries || defaultMaxEntries
    };
    this.entries = null;
    this.queue = Promise.resolve();
  }

  async #load() {
    if (this.entries) return;
    await fs.mkdir(path.join(this.root, 'items'), { recursive: true });
    let data;
    try { data = JSON.parse(await fs.readFile(path.join(this.root, 'index.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Could not read saved game library: ${error.message}`);
      data = { version: 1, entries: [] };
    }
    if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.some((entry) => !idPattern.test(entry.id))) {
      throw new Error('Saved game library index is invalid');
    }
    this.entries = data.entries;
  }

  #public(entry) {
    return {
      id: entry.id,
      path: path.join(this.root, 'items', entry.id, entry.originalName),
      originalPath: entry.originalPath,
      originalName: entry.originalName,
      kind: entry.kind,
      size: entry.size,
      gameId: entry.gameId,
      itemId: entry.itemId,
      label: entry.label,
      addedAt: entry.addedAt
    };
  }

  async #save() {
    const temp = path.join(this.root, `index-${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, JSON.stringify({ version: 1, entries: this.entries }, null, 2));
      await fs.rename(temp, path.join(this.root, 'index.json'));
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }

  #run(action) {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => {});
    return next;
  }

  importPath(source, metadata = {}) {
    return this.#run(async () => {
      await this.#load();
      if (typeof source !== 'string' || !source.trim()) throw new Error('Choose a game file or folder');
      const originalPath = path.resolve(source);
      if (isWithin(originalPath, this.root) || isWithin(this.root, originalPath)) {
        throw new Error('Choose files outside VR4All’s managed library');
      }
      const gameId = safeField(metadata.gameId, 'game ID');
      const itemId = safeField(metadata.itemId, 'item ID');
      const label = safeField(metadata.label, 'label');
      const checked = await inspect(originalPath, this.limits);
      const existing = this.entries.find((entry) => entry.originalPath === originalPath && entry.gameId === gameId
        && entry.itemId === itemId && entry.fingerprint === checked.fingerprint);
      if (existing && await fs.lstat(this.#public(existing).path).catch(() => null)) return this.#public(existing);
      const id = crypto.randomUUID();
      const originalName = path.basename(originalPath);
      const itemRoot = path.join(this.root, 'items', id);
      const target = path.join(itemRoot, originalName);
      await fs.mkdir(itemRoot, { recursive: false });
      try {
        if (checked.kind === 'file') await fs.copyFile(originalPath, target);
        else {
          await fs.mkdir(target);
          for (const folder of checked.folders) await fs.mkdir(path.join(target, folder), { recursive: true });
          for (const file of checked.files) await fs.copyFile(path.join(originalPath, file), path.join(target, file));
        }
        const after = await inspect(originalPath, this.limits);
        if (after.fingerprint !== checked.fingerprint) throw new Error('Game files changed while VR4All was copying them; import again');
        const entry = { id, originalPath, originalName, kind: checked.kind, size: checked.bytes,
          fingerprint: checked.fingerprint, gameId, itemId, label, addedAt: new Date().toISOString() };
        this.entries.push(entry);
        try { await this.#save(); }
        catch (error) { this.entries.pop(); throw error; }
        return this.#public(entry);
      } catch (error) {
        await fs.rm(itemRoot, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  }

  list() {
    return this.#run(async () => {
      await this.#load();
      const visible = [];
      for (const entry of this.entries) {
        const item = this.#public(entry);
        if (await fs.lstat(item.path).catch(() => null)) visible.push(item);
      }
      return visible;
    });
  }

  cloneTo(targetRoot) {
    return this.#run(async () => {
      await this.#load();
      const destination = path.resolve(targetRoot);
      if (isWithin(destination, this.root) || isWithin(this.root, destination)) throw new Error('Choose a different game-files folder');
      if (await fs.lstat(destination).catch(() => null)) throw new Error('The chosen VR4All Library folder already exists; choose another location');
      const stage = path.join(path.dirname(destination), `.vr4all-library-${crypto.randomUUID()}.tmp`);
      try {
        await fs.mkdir(path.join(stage, 'items'), { recursive: true });
        for (const entry of this.entries) {
          const original = this.#public(entry).path;
          await inspect(original, this.limits);
          const copied = path.join(stage, 'items', entry.id, entry.originalName);
          await fs.mkdir(path.dirname(copied), { recursive: true });
          await fs.cp(original, copied, { recursive: true, errorOnExist: true, force: false });
        }
        await fs.writeFile(path.join(stage, 'index.json'), JSON.stringify({ version: 1, entries: this.entries }, null, 2));
        await fs.rename(stage, destination);
        const migrated = new ManagedLibrary(destination, this.limits);
        if ((await migrated.list()).length !== this.entries.length) throw new Error('Could not verify the copied game library');
        return migrated;
      } catch (error) {
        if (isWithin(stage, path.dirname(destination))) await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  }

  remove(id) {
    return this.#run(async () => {
      await this.#load();
      if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Invalid saved item ID');
      const index = this.entries.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      const itemRoot = path.join(this.root, 'items', id);
      const stat = await fs.lstat(itemRoot).catch(() => null);
      if (stat?.isSymbolicLink()) throw new Error('Saved item directory is a link');
      await fs.rm(itemRoot, { recursive: true, force: true });
      const [removed] = this.entries.splice(index, 1);
      try { await this.#save(); }
      catch (error) { this.entries.splice(index, 0, removed); throw error; }
      return true;
    });
  }
}

module.exports = { ManagedLibrary };
