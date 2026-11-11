// The owner's report: whether the site is ready, what was left out and why, and what the checks
// found. Written for a school office, not a developer: the first lines say what to do.
import { MIN_ACCESSIBILITY } from '../qa/a11y.mjs';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function ownerReport({ name, pages, fidelity, qa, failures }) {
  const ready = failures.length === 0;
  const lowest = Math.min(...qa.lighthouse.map((l) => l.accessibility));
  const lines = [
    `# New website for ${name}`,
    '',
    ready
      ? '**Ready to publish.** Every required check passed. See "Put it online" in the site folder\'s README.'
      : `**Not ready to publish.** ${plural(failures.length, 'problem needs', 'problems need')} fixing first; they are listed under "Fix before publishing".`,
    '',
    `${fidelity.pages_carried} of ${fidelity.pages_total} old pages were carried over. ${plural(fidelity.dropped.length, 'item was', 'items were')} left out and ${plural(fidelity.flagged.length, 'item needs', 'items need')} your attention.`,
    '',
  ];
  if (!ready) lines.push('## Fix before publishing', '', ...failures.map((f) => `- ${f}`), '');
  lines.push('## Pages on the new site', '', ...pages.map((p) => `- ${p.title}`), '');
  lines.push('## Left out', '');
  lines.push(...(fidelity.dropped.length ? fidelity.dropped.map((d) => `- ${d.ref}: ${d.reason}`) : ['Nothing.']), '');
  lines.push('## Needs your attention', '');
  lines.push(...(fidelity.flagged.length ? fidelity.flagged.map((f) => `- ${f.ref}: ${f.reason}`) : ['Nothing.']), '');
  lines.push(
    '## Checks',
    '',
    `- Accessibility (axe-core, WCAG 2.1 AA): ${plural(qa.axe.serious, 'serious problem', 'serious problems')}, ${plural(qa.axe.critical, 'critical problem', 'critical problems')}. Details: c-build/axe.json.`,
    `- Accessibility score on phones (Lighthouse, needs ${MIN_ACCESSIBILITY}): lowest ${lowest} of 100 (${qa.lighthouse.map((l) => `${l.slug} ${l.accessibility}`).join(', ')}).`,
    `- Links: ${qa.links.checked} checked, ${plural(qa.links.broken.length, 'broken', 'broken')}${qa.links.broken.length ? `: ${qa.links.broken.map((b) => `${b.href} on ${b.from}`).join('; ')}` : ''}.`,
    `- Facts from the old site (phone, email, address, dates): ${qa.fact_diff.checked} checked, ${qa.fact_diff.changed.length} changed, ${qa.fact_diff.missing.length} missing.`,
    '',
  );
  return lines.join('\n');
}
