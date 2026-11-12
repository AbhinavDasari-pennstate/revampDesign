import { Fragment } from 'react';

// Report headings sit under the page's h1, so a report h1 is drawn as h2. Only these tags are ever drawn.
const BLOCK_TAG = { h1: 'h2', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6', h6: 'h6', p: 'p', ul: 'ul', ol: 'ol' };

function Inline({ nodes }) {
  return nodes.map((n, i) => (n.tag === 'strong' ? <strong key={i}>{n.text}</strong> : <Fragment key={i}>{n.text}</Fragment>));
}

// Draws the tree from parseReport with every string as a React text child.
export default function Report({ tree }) {
  return (
    <div className="report">
      {tree.map((block, i) => {
        const Tag = BLOCK_TAG[block.tag];
        if (!Tag) return null;
        if (Tag === 'ul' || Tag === 'ol') {
          return <Tag key={i}>{block.children.map((li, j) => <li key={j}><Inline nodes={li.children} /></li>)}</Tag>;
        }
        return <Tag key={i}><Inline nodes={block.children} /></Tag>;
      })}
    </div>
  );
}
