function confirmExitWithInstalls(jobs, showMessageBoxSync) {
  const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued');
  if (!active.length) return true;
  const running = active.filter((job) => job.status === 'running').length;
  const waiting = active.length - running;
  const detail = `${running} install${running === 1 ? '' : 's'} running, ${waiting} waiting. Quitting now will interrupt the active install and discard the queue. You may need to install the game again.`;
  return showMessageBoxSync({
    type: 'warning',
    title: 'Install in progress',
    message: 'Quit VR4ALL while games are installing?',
    detail,
    buttons: ['Keep VR4ALL open', 'Quit anyway'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }) === 1;
}

module.exports = { confirmExitWithInstalls };
