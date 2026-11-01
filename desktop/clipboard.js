function createClipboardHandler({ origin, clipboard }) {
  return (_event, value) => {
    if (!_event.senderFrame?.url?.startsWith(`${origin}/`)) throw new Error('Clipboard request must come from the VR4ALL app page');
    if (typeof value !== 'string' || !value || value.length > 8192) throw new Error('Invalid clipboard text');
    clipboard.writeText(value);
    return true;
  };
}

module.exports = { createClipboardHandler };
