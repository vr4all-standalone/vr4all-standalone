function parseQuestInternet(dump) {
  if (typeof dump !== 'string' || dump.length > 2 * 1024 ** 2) return { status: 'unknown' };
  const active = dump.match(/^\s*Active default network:\s*(none|\d+)\s*$/im)?.[1];
  if (active?.toLowerCase() === 'none') return { status: 'offline' };
  if (!active) return { status: 'unknown' };
  const lines = dump.split(/\r?\n/), start = lines.findIndex((line) => /^\s*Current Networks:\s*$/i.test(line));
  if (start < 0) return { status: 'unknown' };
  const section = [];
  const indent = lines[start].search(/\S/);
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && line.search(/\S/) <= indent && !/^\s*NetworkAgentInfo\b/.test(line)) break;
    section.push(line);
  }
  const blocks = section.join('\n').split(/(?=^\s*NetworkAgentInfo\b)/m);
  const current = blocks.find((block) => new RegExp(`network\\{${active}\\}|NetworkAgentInfo\\s*\\[[^\\]\\r\\n]* - ${active}\\]`).test(block));
  if (!current) return { status: 'unknown' };
  const capabilities = current.match(/Capabilities:\s*([A-Z_&| ]+)/)?.[1];
  if (!capabilities) return { status: 'unknown' };
  return { status: /\bINTERNET\b/.test(capabilities) && /\bVALIDATED\b/.test(capabilities) ? 'online' : 'offline' };
}

async function checkRdrInternet(adb, serial, log = () => {}) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(serial || '')) throw new Error('Choose a connected Quest');
  log('Checking internet access on the selected Quest for RDR first launch...');
  let result;
  try { result = parseQuestInternet(await adb.run(['-s', serial, 'shell', 'dumpsys', 'connectivity'], undefined, { timeoutMs: 10000 })); }
  catch { result = { status: 'unknown' }; }
  if (result.status === 'offline') throw new Error('Connect the selected Quest to Wi-Fi with working internet, then retry Build and install. Netflix RDR needs online DRM setup at first launch; NGP-92/DRM provisioning can fail without internet.');
  log(result.status === 'online' ? 'Selected Quest has validated internet access. Keep Wi-Fi connected through RDR startup and Netflix sign-in.'
    : 'Could not verify Quest internet access. Connect the headset to Wi-Fi with working internet before starting RDR; NGP-92 can indicate failed DRM setup.');
  return result;
}

module.exports = { parseQuestInternet, checkRdrInternet };
