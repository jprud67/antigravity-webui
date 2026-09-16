import { createContext } from 'react';

/**
 * Context to track if a code block is inside a `<pre>` element.
 */
export const PreContext = createContext(false);

/**
 * Robust copy helper: navigator.clipboard with execCommand fallback.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  let el: HTMLTextAreaElement | null = null;
  try {
    el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.contain = 'strict';
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    el.style.fontSize = '12pt';
    document.body.appendChild(el);
    el.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }
};

/**
 * Recursively extracts plain text from React children.
 */
export function extractRawText(children: any): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    return children.map(extractRawText).join('');
  }
  if (children && typeof children === 'object' && 'props' in children) {
    return extractRawText(children.props?.children);
  }
  return children ? String(children) : '';
}
