import 'temml/dist/Temml-Local.css';

import { useLingui } from '@lingui/react/macro';
import type { RefObject } from 'react';
import { useCallback, useState } from 'react';
import type Temml from 'temml';

import showToast from '../utils/show-toast';

import Icon from './icon';

declare global {
  interface Window {
    temml?: typeof Temml;
  }
}

// Follow https://mathstodon.xyz/about
// > You can use LaTeX in toots here! Use \( and \) for inline, and \[ and \] for display mode.
const DELIMITERS_PATTERNS = [
  // '\\$\\$[\\s\\S]*?\\$\\$', // $$...$$
  '\\\\\\[[\\s\\S]*?\\\\\\]', // \[...\]
  '\\\\\\([\\s\\S]*?\\\\\\)', // \(...\)
  // '\\\\begin\\{(?:equation\\*?|align\\*?|alignat\\*?|gather\\*?|CD)\\}[\\s\\S]*?\\\\end\\{(?:equation\\*?|align\\*?|alignat\\*?|gather\\*?|CD)\\}', // AMS environments
  // '\\\\(?:ref|eqref)\\{[^}]*\\}', // \ref{...}, \eqref{...}
];
const DELIMITERS_REGEX = new RegExp(DELIMITERS_PATTERNS.join('|'), 'g');
const START_DELIMITERS = ['\\\\\\[', '\\\\\\(']; // \[ and \(
const startRegex = new RegExp(`(${START_DELIMITERS.join('|')})`);
const END_DELIMITER_BY_START = new Map([
  ['\\[', '\\]'],
  ['\\(', '\\)'],
]);
const END_DELIMITER_REGEX_BY_START = new Map([
  ['\\[', new RegExp('\\\\\\]')],
  ['\\(', new RegExp('\\\\\\)')],
]);
const DEFAULT_END_DELIMITER_REGEX = new RegExp('\\\\\\)');

function cleanDOMForTemml(dom: HTMLElement) {
  // Walk through all text nodes
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node instanceof Text) {
      textNodes.push(node);
    }
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    const startMatch = text.match(startRegex);

    if (!startMatch) continue; // No start delimiter in this text node

    // Find the matching end delimiter
    const startDelimiter = startMatch[0];
    const endDelimiter = END_DELIMITER_BY_START.get(startDelimiter) ?? '\\)';
    const endDelimiterRegex =
      END_DELIMITER_REGEX_BY_START.get(startDelimiter) ??
      DEFAULT_END_DELIMITER_REGEX;

    // Collect nodes from start delimiter until end delimiter
    const nodesToCombine: ChildNode[] = [textNode];
    let currentNode: ChildNode = textNode;
    let foundEnd = false;
    let combinedText = text;

    // Check if end delimiter is in the same text node
    if (text.includes(endDelimiter)) {
      foundEnd = true;
    } else {
      // Look through sibling nodes
      while (currentNode.nextSibling && !foundEnd) {
        const nextSibling = currentNode.nextSibling;

        if (nextSibling.nodeType === Node.TEXT_NODE) {
          nodesToCombine.push(nextSibling);
          const siblingText = nextSibling.textContent ?? '';
          combinedText += siblingText;
          if (endDelimiterRegex.test(siblingText)) {
            foundEnd = true;
          }
        } else if (nextSibling instanceof HTMLBRElement) {
          nodesToCombine.push(nextSibling);
          combinedText += '\n';
        } else {
          // Found a non-BR element, stop and don't process
          break;
        }

        currentNode = nextSibling;
      }
    }

    // Only process if we found the end delimiter and have nodes to combine
    if (foundEnd && nodesToCombine.length > 1) {
      // Replace the first text node with combined text
      textNode.textContent = combinedText;

      // Remove the other nodes
      for (let i = 1; i < nodesToCombine.length; i++) {
        nodesToCombine[i].remove();
      }
    }
  }
}

interface MathBlockProps {
  content: string;
  contentRef: RefObject<HTMLElement | null>;
  onRevert: () => void;
}

const MathBlock = ({ content, contentRef, onRevert }: MathBlockProps) => {
  const { t } = useLingui();
  const [mathRendered, setMathRendered] = useState(false);
  const toggleMathRendering = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (mathRendered) {
        // Revert to original content by refreshing PostContent
        setMathRendered(false);
        onRevert();
      } else {
        // Render math
        try {
          // This needs global because the codebase inside temml is calling a function from global.temml 🤦‍♂️
          const temml =
            window.temml || (window.temml = (await import('temml'))?.default);

          const contentEl = contentRef.current;
          if (!contentEl) return;
          cleanDOMForTemml(contentEl);
          const originalContentRefHTML = contentEl.innerHTML;
          temml.renderMathInElement(contentEl, {
            fences: '(', // This should sync with DELIMITERS_REGEX
            annotate: true,
            throwOnError: true,
            errorCallback: (err: unknown) => {
              console.warn('Failed to render LaTeX:', err);
            },
          } as Parameters<typeof temml.renderMathInElement>[1]);

          const hasMath = contentEl.querySelector('math');
          const htmlChanged = contentEl.innerHTML !== originalContentRefHTML;
          if (hasMath && htmlChanged) {
            setMathRendered(true);
          } else {
            showToast(t`Unable to format math`);
            setMathRendered(false);
            onRevert(); // Revert because DOM modified by cleanDOMForTemml
          }
        } catch (err) {
          console.error('Failed to LaTeX:', err);
        }
      }
    },
    [mathRendered, contentRef, onRevert, t],
  );

  DELIMITERS_REGEX.lastIndex = 0; // Reset index to prevent g trap
  const hasLatexContent = DELIMITERS_REGEX.test(content);

  if (!hasLatexContent) return null;

  return (
    <div className="math-block">
      <Icon icon="formula" size="s" /> <span>{t`Math expressions found.`}</span>{' '}
      <button
        type="button"
        className="light small"
        onClick={(e) => {
          void toggleMathRendering(e);
        }}
      >
        {mathRendered
          ? t({
              comment:
                'Action to switch from rendered math back to raw (LaTeX) markup',
              message: 'Show markup',
            })
          : t({
              comment:
                'Action to render math expressions from raw (LaTeX) markup',
              message: 'Format math',
            })}
      </button>
    </div>
  );
};

export default MathBlock;
