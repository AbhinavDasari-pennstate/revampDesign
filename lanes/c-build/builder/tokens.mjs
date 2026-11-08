// The direction the selection picked; its tokens become the site's tokens.json.
import { fail } from '../lib/contracts.mjs';

export function selectedDirection(directions, selection) {
  const direction = directions.directions.find((d) => d.direction_id === selection.direction_id);
  if (!direction) throw fail(`45-selection.json picks ${selection.direction_id}, which 30-directions.json does not have`, 2);
  return direction;
}
