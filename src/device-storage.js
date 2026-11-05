function parseDeviceStorage(output) {
  for (const line of String(output || '').split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 6 || columns.at(-1) !== '/data') continue;
    const [total, used, free] = columns.slice(-5, -2).map(Number);
    if (![total, used, free].every(Number.isSafeInteger) || total <= 0 || used < 0 || free < 0 || used + free > total) continue;
    return { totalBytes: total * 1024, usedBytes: used * 1024, freeBytes: free * 1024 };
  }
  return null;
}

module.exports = { parseDeviceStorage };
