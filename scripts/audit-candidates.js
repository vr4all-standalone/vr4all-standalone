const repos = process.argv.length > 2 ? process.argv.slice(2) : [
  'rhythmerc/xelee',
  'JoeyAW/TPVR',
  'LanceSweatpants/Strikers-Quest-MR',
  'iChris4/Wiicompiled_VR',
  'mikermak/hotd2-vr',
  'Baywilly/ReVoltVR-Standalone',
  'Baywilly/Metal-Gear-Solid-VR-Standalone',
  'SgtBilko76/Wipeout-Rewrite-VR',
  'DR-89/nfsu-vr',
  'dubrovskiy-yevhen-stakelogic/road-rash-jailbreak',
];

(async () => {
  for (const repo of repos) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, { headers: { 'User-Agent': 'vr4all/0.2', Accept: 'application/vnd.github+json' } });
      if (!response.ok) { console.log(`${repo}: HTTP ${response.status}`); continue; }
      const releases = await response.json();
      const assets = releases.flatMap((release) => (release.assets || []).map((asset) => `${release.tag_name}: ${asset.name}`));
      console.log(`${repo}\n  ${assets.filter((name) => /\.(apk|zip)$/i.test(name)).slice(0, 12).join('\n  ') || 'No APK/ZIP release assets'}`);
    } catch (error) { console.log(`${repo}: ${error.message}`); }
  }
})();
