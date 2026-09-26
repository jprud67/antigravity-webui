const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

const UI_ATTRIBUTES = new Set([
  'title', 'placeholder', 'aria-label', 'label', 'alt', 'tooltip',
  'description', 'helpertext', 'badge', 'subtitle', 'heading',
  'confirmtext', 'canceltext'
]);

// Non-UI attributes to always ignore
const IGNORED_ATTRIBUTES = new Set([
  'classname', 'class', 'style', 'id', 'key', 'd', 'fill', 'stroke',
  'strokewidth', 'viewbox', 'xmlns', 'type', 'name', 'target', 'rel',
  'href', 'src', 'width', 'height', 'color', 'role', 'tabindex', 'lang',
  'ref', 'as', 'size', 'variant', 'align', 'side', 'dir'
]);

function hasLetters(str) {
  return /[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/.test(str);
}

function isTechnicalToken(str) {
  const s = str.trim();
  // ignore html/jsx entities alone
  if (/^&[a-z]+;$/i.test(s)) return true;
  // ignore purely numbers/symbols
  if (!hasLetters(s)) return true;
  // ignore colors
  if (/^#[0-9a-f]{3,8}$/i.test(s) || s.startsWith('rgba(') || s.startsWith('var(') || s.startsWith('rgb(')) return true;
  // ignore URLs or paths
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/api/') || s.startsWith('./') || s.startsWith('../')) return true;
  // ignore uppercase constants like HEAD, GET, POST, JSON, UTF-8
  if (/^[A-Z0-9_-]+$/.test(s) && (s === 'HEAD' || s === 'GET' || s === 'POST' || s === 'JSON' || s === 'SHA' || s === 'CLI' || s === 'ID' || s === 'FTS5' || s === 'URL' || s === 'API' || s === 'RAM' || s === 'MB' || s === 'GB' || s === 'KB' || s === 'UUID')) return true;
  // ignore keyboard shortcuts like Ctrl+S, Esc, Enter if alone
  if (/^(ctrl\+[a-z0-9]|esc|enter|shift\+enter|tab|alt\+[a-z0-9])$/i.test(s)) return true;
  // ignore svg path data
  if (/^[MmLlHhVvCcSsQqTtAaZz0-9\s,.-]+$/.test(s) && (s.startsWith('M') || s.startsWith('m'))) return true;

  return false;
}

const findings = [];

function scanFile(filePath) {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) return;
  if (filePath.endsWith('.d.ts')) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  function getLine(pos) {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function walk(node) {
    // 1. JSX Text
    if (ts.isJsxText(node)) {
      const text = node.getText().trim();
      if (text && !isTechnicalToken(text)) {
        if (!text.startsWith('/*') && !text.startsWith('//') && text !== '{' && text !== '}') {
          findings.push({
            file: path.relative(path.join(__dirname, '..'), filePath),
            line: getLine(node.getStart()),
            type: 'JSX_TEXT',
            text: text.slice(0, 120)
          });
        }
      }
    }

    // 2. JSX Attribute
    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText().toLowerCase();
      if (node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          const val = node.initializer.text.trim();
          if (UI_ATTRIBUTES.has(attrName)) {
            if (!isTechnicalToken(val)) {
              findings.push({
                file: path.relative(path.join(__dirname, '..'), filePath),
                line: getLine(node.getStart()),
                type: `ATTR_${attrName}`,
                text: val.slice(0, 120)
              });
            }
          } else if (!IGNORED_ATTRIBUTES.has(attrName)) {
            // Attribute not in ignored list and contains letters with spaces or accents
            if ((/[éèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]/.test(val) || val.includes(' ')) && !isTechnicalToken(val)) {
              findings.push({
                file: path.relative(path.join(__dirname, '..'), filePath),
                line: getLine(node.getStart()),
                type: `ATTR_${attrName}`,
                text: val.slice(0, 120)
              });
            }
          }
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const expr = node.initializer.expression;
          if (UI_ATTRIBUTES.has(attrName)) {
            function checkExpr(e) {
              if (ts.isStringLiteral(e)) {
                if (!isTechnicalToken(e.text)) {
                  findings.push({
                    file: path.relative(path.join(__dirname, '..'), filePath),
                    line: getLine(e.getStart()),
                    type: `ATTR_EXPR_${attrName}`,
                    text: e.text.slice(0, 120)
                  });
                }
              } else if (ts.isConditionalExpression(e)) {
                checkExpr(e.whenTrue);
                checkExpr(e.whenFalse);
              } else if (ts.isBinaryExpression(e)) {
                checkExpr(e.left);
                checkExpr(e.right);
              }
            }
            checkExpr(expr);
          }
        }
      }
    }

    // 3. String literal in JSX Expression child
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      function checkJsxChildExpr(e) {
        if (ts.isStringLiteral(e)) {
          if (!isTechnicalToken(e.text)) {
            findings.push({
              file: path.relative(path.join(__dirname, '..'), filePath),
              line: getLine(e.getStart()),
              type: 'JSX_EXPR_STRING',
              text: e.text.slice(0, 120)
            });
          }
        } else if (ts.isConditionalExpression(e)) {
          checkJsxChildExpr(e.whenTrue);
          checkJsxChildExpr(e.whenFalse);
        } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          checkJsxChildExpr(e.right);
        }
      }
      checkJsxChildExpr(node.expression);
    }

    // 4. Function calls: showToast, showConfirm, alert, confirm, prompt
    if (ts.isCallExpression(node)) {
      const fnName = node.expression.getText();
      if (/^(showToast|showConfirm|alert|confirm|prompt|window\.alert|window\.confirm|window\.prompt)$/.test(fnName)) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          if (!isTechnicalToken(firstArg.text)) {
            findings.push({
              file: path.relative(path.join(__dirname, '..'), filePath),
              line: getLine(firstArg.getStart()),
              type: `CALL_${fnName}`,
              text: firstArg.text.slice(0, 120)
            });
          }
        }
      }
    }

    ts.forEachChild(node, walk);
  }

  walk(sourceFile);
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walkDir(full);
    } else {
      scanFile(full);
    }
  }
}

walkDir(srcDir);

fs.writeFileSync(path.join(__dirname, 'ast_findings.json'), JSON.stringify(findings, null, 2), 'utf-8');
console.log('Total findings:', findings.length);

const byFile = {};
for (const f of findings) {
  byFile[f.file] = byFile[f.file] || [];
  byFile[f.file].push(f);
}

console.log('Files summary:');
for (const [file, items] of Object.entries(byFile).sort((a,b) => b[1].length - a[1].length)) {
  console.log(`${file}: ${items.length}`);
}
