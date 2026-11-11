// Lane C runs Astro, which needs a newer Node than some machines have. Say so plainly instead of
// letting a missing language feature fail somewhere deep in a build.

// The message for a Node older than a ">=x.y.z" range, or null when it is new enough.
export function nodeTooOld(version, range) {
  const need = range.match(/>=\s*(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
  const have = version.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] < need[i] ? `Lane C needs Node ${need.join('.')} or newer (Astro); this is Node ${have.join('.')}.` : null;
  }
  return null;
}
