// ─── Strip TypeScript from Inline Scripts ─────────────────────────────────────
// AI-generated HTML sometimes contains TypeScript syntax in <script> blocks.
// Pure regex approach — no compiler dependency, works in all environments.

/**
 * Strip TypeScript type syntax from a JS/TS code string using regex.
 * Handles the patterns Sonnet most commonly produces.
 */
export function stripTypescript(code: string): string {
  if (!code.trim()) return code;
  let out = code;

  // 1. Remove ES module import declarations (CDN globals are on window already)
  //    import { gsap as GSAP, ScrollTrigger } from 'gsap'
  //    import type { Foo } from './foo'
  //    import * as utils from './utils'
  out = out.replace(
    /^[ \t]*import\s+(?:type\s+)?(?:\*\s+as\s+\w+|\{[^}]*\}|\w+(?:\s*,\s*(?:\{[^}]*\}|\w+))*)\s+from\s+['"][^'"]*['"]\s*;?[ \t]*$/gm,
    (m) => `/* [import removed] ${m.trim()} */`
  );

  // 2. Remove export type declarations
  //    export type { Foo }  |  export type Foo = ...
  out = out.replace(/^[ \t]*export\s+type\s+[^;{]+(?:;|\{[^}]*\})/gm, '');

  // 3. Remove re-exports with 'as': export { X as Y }
  out = out.replace(/^[ \t]*export\s+\{[^}]*\}\s*(?:from\s*['"][^'"]*['"])?\s*;?[ \t]*$/gm, '');

  // 4. Type assertions: (value as Type) → (value)
  //    Match lowercase primitives + PascalCase names (optionally with one level of generics and/or [])
  //    IMPORTANT: character class must NOT include ',' or ')' to avoid eating function arguments
  out = out.replace(
    /\s+as\s+(?:unknown|any|never|void|null|undefined|string|number|boolean|bigint|symbol)(?:\[\])*/g,
    ''
  );
  // PascalCase type with optional one-level generic <...> and optional []
  // [^>]* stops at the first '>' — safe for single-level generics like HTMLElement, Record<string, any>
  out = out.replace(
    /\s+as\s+[A-Z][A-Za-z0-9_]*(?:<[^>]*>)?(?:\[\])*/g,
    ''
  );

  // 5. Non-null assertions: element!.style → element.style
  out = out.replace(/(\w)!(\s*[.[(\[])/g, '$1$2');

  // 6. Type annotations in declarations: const x: string = → const x =
  out = out.replace(/((?:const|let|var)\s+(?:\w+|\{[^}]*\}|\[[^\]]*\]))\s*:\s*[A-Za-z][A-Za-z0-9_<>\[\]|&., ]+(?=\s*=)/g, '$1');

  // 7. Function return type annotations: function foo(): void { → function foo() {
  out = out.replace(/(\))\s*:\s*(?:void|never|any|unknown|string|number|boolean|[A-Z][A-Za-z0-9_<>\[\]|& ,]+)(\s*\{)/g, '$1$2');

  // 8. Function parameter type annotations: (param: Type) → (param)
  //    Only safe for simple cases to avoid breaking JS object patterns
  out = out.replace(/(\(\s*\w+)\s*:\s*[A-Z][A-Za-z0-9_]+(?=[,)])/g, '$1');

  // 9. Generic type parameters on function calls that slip through:
  //    gsap.to<HTMLElement>(...) → gsap.to(...)
  out = out.replace(/(\w+)<[A-Z][A-Za-z0-9_<>, ]*>(\s*\()/g, '$1$2');

  return out;
}

/**
 * Strip TypeScript from all inline <script> blocks in an HTML string.
 * Uses a split-based scan instead of a single regex to correctly handle
 * `</script>` appearing inside strings or comments within the code.
 */
export function stripTypescriptFromHtml(html: string): string {
  const parts: string[] = [];
  let remaining = html;
  const closeTag = '</script>';

  while (remaining.length > 0) {
    const openMatch = remaining.match(/<script\b([^>]*)>/i);
    if (!openMatch || openMatch.index === undefined) {
      parts.push(remaining);
      break;
    }

    const openIdx  = openMatch.index;
    const attrs    = openMatch[1];
    const afterOpen = openIdx + openMatch[0].length;

    // Push everything before this <script> tag unchanged
    parts.push(remaining.slice(0, openIdx));

    // Find the matching </script>
    const closeIdx = remaining.toLowerCase().indexOf(closeTag, afterOpen);
    if (closeIdx === -1) {
      // Malformed — no closing tag; push the rest as-is
      parts.push(remaining.slice(openIdx));
      break;
    }

    const code = remaining.slice(afterOpen, closeIdx);

    // Skip: external scripts or non-JS types (JSON, template, etc.)
    const isExternal = /\bsrc\s*=/i.test(attrs);
    const typeMatch  = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const scriptType = typeMatch ? typeMatch[1].toLowerCase() : '';
    const isNonJs    = scriptType && !['text/javascript', 'application/javascript', 'module', ''].some(t => scriptType === t);

    if (isExternal || isNonJs || !code.trim()) {
      parts.push(`<script${attrs}>${code}${closeTag}`);
    } else {
      parts.push(`<script${attrs}>${stripTypescript(code)}${closeTag}`);
    }

    remaining = remaining.slice(closeIdx + closeTag.length);
  }

  return parts.join('');
}
