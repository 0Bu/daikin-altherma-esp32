// Zero-dependency ECMAScript lexer and recursive-descent AST parser for embedded UI scripts.
// Supports classic scripts with comments, strings, regex vs division via parser prefix/infix
// context, nested template literals, destructuring, arrow functions, classes, and optional chains.

const KEYWORDS = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "false", "finally",
  "for", "function", "if", "import", "in", "instanceof", "new", "null",
  "return", "super", "switch", "this", "throw", "true", "try", "typeof",
  "var", "void", "while", "with", "yield",
]);

const PUNCT_MULTI = [
  ">>>=", "===", "!==", ">>>", "<<=", ">>=", "**=", "&&=", "||=", "??=", "...",
  "=>", "++", "--", "**", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "??", "?.",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
];

const ASSIGN_OPS = new Set([
  "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??=",
]);

const BINARY_LEVELS = [
  ["||", "??"],
  ["&&"],
  ["|"],
  ["^"],
  ["&"],
  ["==", "!=", "===", "!=="],
  ["<", "<=", ">", ">=", "in", "instanceof"],
  ["<<", ">>", ">>>"],
  ["+", "-"],
  ["*", "/", "%"],
];

export function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

export function lineColFromStarts(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo] + 1 };
}

export class SourceMapper {
  constructor(segments) {
    this.segments = segments;
  }

  static fromTextMap(entries) {
    const segments = [];
    let cursor = 0;
    let combined = "";
    for (const { file, content, baseLine = 1 } of entries) {
      segments.push({
        file,
        start: cursor,
        end: cursor + content.length,
        lineStarts: buildLineStarts(content),
        baseLine,
      });
      combined += content;
      cursor += content.length;
    }
    return { code: combined, mapper: new SourceMapper(segments) };
  }

  locate(offset) {
    const seg = this.segments.find((s) => offset >= s.start && offset < s.end)
      || this.segments[this.segments.length - 1];
    const localOffset = Math.max(0, Math.min(offset - seg.start, seg.end - seg.start));
    const lc = lineColFromStarts(seg.lineStarts, localOffset);
    return { file: seg.file, line: lc.line + seg.baseLine - 1, col: lc.col };
  }

  format(offset) {
    const { file, line, col } = this.locate(offset);
    return `${file}:${line}:${col}`;
  }
}

function isIdentStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$" ||
    (ch.charCodeAt(0) >= 0x80 && /\p{ID_Start}/u.test(ch));
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9") || ch === "\u200C" || ch === "\u200D" ||
    (ch.charCodeAt(0) >= 0x80 && /\p{ID_Continue}/u.test(ch));
}

function isDigit(ch) { return ch >= "0" && ch <= "9"; }
function isHex(ch) { return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F"); }

class Lexer {
  constructor(src, mapper) {
    this.src = src;
    this.mapper = mapper;
    this.pos = 0;
    this.tok = null;
    this.advance();
  }

  save() { return { pos: this.pos, tok: this.tok }; }
  restore(state) { this.pos = state.pos; this.tok = state.tok; }

  syntaxError(message, offset = this.pos) {
    return new SyntaxError(`${this.mapper.format(offset)}: ${message}`);
  }

  skipTrivia() {
    const s = this.src;
    let newline = false;
    while (this.pos < s.length) {
      const ch = s[this.pos];
      if (ch === " " || ch === "\t" || ch === "\v" || ch === "\f" || ch === "\u00A0" || ch === "\uFEFF") {
        this.pos++;
      } else if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") {
        newline = true;
        if (ch === "\r" && s[this.pos + 1] === "\n") this.pos += 2;
        else this.pos++;
      } else if (ch === "/" && s[this.pos + 1] === "/") {
        this.pos += 2;
        while (this.pos < s.length && !"\n\r\u2028\u2029".includes(s[this.pos])) this.pos++;
      } else if (ch === "/" && s[this.pos + 1] === "*") {
        const start = this.pos;
        this.pos += 2;
        let closed = false;
        while (this.pos < s.length) {
          const c = s[this.pos];
          if (c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029") newline = true;
          if (c === "*" && s[this.pos + 1] === "/") {
            this.pos += 2;
            closed = true;
            break;
          }
          this.pos++;
        }
        if (!closed) throw this.syntaxError("unterminated block comment", start);
      } else {
        break;
      }
    }
    return newline;
  }

  readString(quote) {
    const s = this.src;
    const start = this.pos++;
    let value = "";
    while (this.pos < s.length) {
      const ch = s[this.pos++];
      if (ch === quote) return { kind: "str", value, start, end: this.pos };
      if (ch === "\n" || ch === "\r") throw this.syntaxError("unterminated string literal", start);
      if (ch === "\\") {
        if (this.pos >= s.length) throw this.syntaxError("unterminated escape", start);
        const esc = s[this.pos++];
        if (esc === "\r" && s[this.pos] === "\n") { this.pos++; continue; }
        if (esc === "\n" || esc === "\r" || esc === "\u2028" || esc === "\u2029") continue;
        if (esc === "n") value += "\n";
        else if (esc === "r") value += "\r";
        else if (esc === "t") value += "\t";
        else if (esc === "b") value += "\b";
        else if (esc === "f") value += "\f";
        else if (esc === "v") value += "\v";
        else if (esc === "0" && !isDigit(s[this.pos] || "")) value += "\0";
        else if (esc === "x") {
          const hex = s.slice(this.pos, this.pos + 2);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) { value += String.fromCharCode(parseInt(hex, 16)); this.pos += 2; }
          else value += "x";
        } else if (esc === "u") {
          if (s[this.pos] === "{") {
            const close = s.indexOf("}", this.pos + 1);
            if (close < 0) throw this.syntaxError("invalid unicode escape", this.pos - 2);
            value += String.fromCodePoint(parseInt(s.slice(this.pos + 1, close), 16));
            this.pos = close + 1;
          } else {
            const hex = s.slice(this.pos, this.pos + 4);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) { value += String.fromCharCode(parseInt(hex, 16)); this.pos += 4; }
            else value += "u";
          }
        } else {
          value += esc;
        }
      } else {
        value += ch;
      }
    }
    throw this.syntaxError("unterminated string literal", start);
  }

  readTemplatePart(start, isTailScan) {
    const s = this.src;
    let cooked = "";
    let cookedValid = true;
    while (this.pos < s.length) {
      const ch = s[this.pos++];
      if (ch === "`") {
        return { kind: isTailScan ? "tplTail" : "tplFull", value: cookedValid ? cooked : null, start, end: this.pos };
      }
      if (ch === "$" && s[this.pos] === "{") {
        this.pos++;
        return { kind: isTailScan ? "tplMid" : "tplHead", value: cookedValid ? cooked : null, start, end: this.pos };
      }
      if (ch === "\\") {
        if (this.pos >= s.length) throw this.syntaxError("unterminated template literal", start);
        const esc = s[this.pos++];
        if (esc === "\r" && s[this.pos] === "\n") { this.pos++; continue; }
        if (esc === "\n" || esc === "\r" || esc === "\u2028" || esc === "\u2029") continue;
        if (esc === "n") cooked += "\n";
        else if (esc === "r") cooked += "\r";
        else if (esc === "t") cooked += "\t";
        else if (esc === "b") cooked += "\b";
        else if (esc === "f") cooked += "\f";
        else if (esc === "v") cooked += "\v";
        else if (esc === "0" && !isDigit(s[this.pos] || "")) cooked += "\0";
        else if (esc === "x") {
          const hex = s.slice(this.pos, this.pos + 2);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) { cooked += String.fromCharCode(parseInt(hex, 16)); this.pos += 2; }
          else cookedValid = false;
        } else if (esc === "u") {
          if (s[this.pos] === "{") {
            const close = s.indexOf("}", this.pos + 1);
            const hex = close > this.pos ? s.slice(this.pos + 1, close) : "";
            if (close > this.pos && /^[0-9a-fA-F]+$/.test(hex) && parseInt(hex, 16) <= 0x10ffff) {
              cooked += String.fromCodePoint(parseInt(hex, 16));
              this.pos = close + 1;
            } else {
              cookedValid = false;
              if (close > this.pos) this.pos = close + 1;
            }
          } else {
            const hex = s.slice(this.pos, this.pos + 4);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) { cooked += String.fromCharCode(parseInt(hex, 16)); this.pos += 4; }
            else cookedValid = false;
          }
        } else {
          cooked += esc;
        }
      } else {
        cooked += ch;
      }
    }
    throw this.syntaxError("unterminated template literal", start);
  }

  readTemplateTailOrMid() {
    if (this.tok.kind !== "punct" || this.tok.value !== "}") {
      throw this.syntaxError("expected '}' closing template expression", this.tok.start);
    }
    const start = this.tok.start;
    this.pos = this.tok.end;
    const part = this.readTemplatePart(start, true);
    part.lineBreakBefore = this.tok.lineBreakBefore;
    this.tok = part;
    return part;
  }

  asRegex() {
    const start = this.tok.start;
    const lineBreakBefore = this.tok.lineBreakBefore;
    const s = this.src;
    this.pos = start + 1;
    let inClass = false;
    while (this.pos < s.length) {
      const ch = s[this.pos++];
      if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") {
        throw this.syntaxError("unterminated regular expression", start);
      }
      if (ch === "\\") {
        if (this.pos >= s.length || "\n\r\u2028\u2029".includes(s[this.pos])) {
          throw this.syntaxError("unterminated regular expression escape", start);
        }
        this.pos++;
      } else if (ch === "[") {
        inClass = true;
      } else if (ch === "]" && inClass) {
        inClass = false;
      } else if (ch === "/" && !inClass) {
        while (this.pos < s.length && isIdentPart(s[this.pos])) this.pos++;
        const tok = { kind: "regex", value: s.slice(start, this.pos), start, end: this.pos, lineBreakBefore };
        this.advance();
        return tok;
      }
    }
    throw this.syntaxError("unterminated regular expression", start);
  }

  readNumber() {
    const s = this.src;
    const start = this.pos;
    if (s[this.pos] === "0" && (s[this.pos + 1] === "x" || s[this.pos + 1] === "X")) {
      this.pos += 2;
      while (this.pos < s.length && (isHex(s[this.pos]) || s[this.pos] === "_")) this.pos++;
      if (s[this.pos] === "n") this.pos++;
      return { kind: "num", value: Number(s.slice(start, this.pos).replace(/_/g, "")), start, end: this.pos };
    }
    if (s[this.pos] === "0" && (s[this.pos + 1] === "b" || s[this.pos + 1] === "B")) {
      this.pos += 2;
      while (this.pos < s.length && (s[this.pos] === "0" || s[this.pos] === "1" || s[this.pos] === "_")) this.pos++;
      if (s[this.pos] === "n") this.pos++;
      return { kind: "num", value: Number(s.slice(start, this.pos).replace(/_/g, "")), start, end: this.pos };
    }
    if (s[this.pos] === "0" && (s[this.pos + 1] === "o" || s[this.pos + 1] === "O")) {
      this.pos += 2;
      while (this.pos < s.length && ((s[this.pos] >= "0" && s[this.pos] <= "7") || s[this.pos] === "_")) this.pos++;
      if (s[this.pos] === "n") this.pos++;
      return { kind: "num", value: Number(s.slice(start, this.pos).replace(/_/g, "")), start, end: this.pos };
    }
    while (this.pos < s.length && (isDigit(s[this.pos]) || s[this.pos] === "_")) this.pos++;
    if (s[this.pos] === "." && (isDigit(s[this.pos + 1] || "") || this.pos > start)) {
      this.pos++;
      while (this.pos < s.length && (isDigit(s[this.pos]) || s[this.pos] === "_")) this.pos++;
    }
    if (s[this.pos] === "e" || s[this.pos] === "E") {
      this.pos++;
      if (s[this.pos] === "+" || s[this.pos] === "-") this.pos++;
      while (this.pos < s.length && (isDigit(s[this.pos]) || s[this.pos] === "_")) this.pos++;
    }
    if (s[this.pos] === "n") this.pos++;
    return { kind: "num", value: Number(s.slice(start, this.pos).replace(/_/g, "")), start, end: this.pos };
  }

  readIdentifier() {
    const s = this.src;
    const start = this.pos;
    let out = "";
    let escaped = false;
    while (this.pos < s.length) {
      const ch = s[this.pos];
      if (ch === "\\" && s[this.pos + 1] === "u") {
        escaped = true;
        this.pos += 2;
        if (s[this.pos] === "{") {
          const close = s.indexOf("}", this.pos + 1);
          out += String.fromCodePoint(parseInt(s.slice(this.pos + 1, close), 16));
          this.pos = close + 1;
        } else {
          out += String.fromCharCode(parseInt(s.slice(this.pos, this.pos + 4), 16));
          this.pos += 4;
        }
      } else if (this.pos === start ? isIdentStart(ch) : isIdentPart(ch)) {
        out += ch;
        this.pos++;
      } else {
        break;
      }
    }
    const kind = !escaped && KEYWORDS.has(out) ? "kw" : "id";
    return { kind, value: out, escaped, start, end: this.pos };
  }

  advance() {
    const lineBreakBefore = this.skipTrivia();
    const s = this.src;
    if (this.pos >= s.length) {
      this.tok = { kind: "eof", value: "", start: this.pos, end: this.pos, lineBreakBefore };
      return this.tok;
    }
    const start = this.pos;
    const ch = s[this.pos];
    let tok;
    if (ch === "'" || ch === '"') {
      tok = this.readString(ch);
    } else if (ch === "`") {
      this.pos++;
      tok = this.readTemplatePart(start, false);
    } else if (ch === "#") {
      this.pos++;
      if (!isIdentStart(s[this.pos] || "")) throw this.syntaxError("invalid private identifier", start);
      const id = this.readIdentifier();
      tok = { kind: "privateId", value: id.value, start, end: id.end };
    } else if (isDigit(ch) || (ch === "." && isDigit(s[this.pos + 1] || ""))) {
      tok = this.readNumber();
    } else if (isIdentStart(ch) || (ch === "\\" && s[this.pos + 1] === "u")) {
      tok = this.readIdentifier();
    } else {
      let matched = null;
      for (const p of PUNCT_MULTI) {
        if (s.startsWith(p, this.pos)) {
          if (p === "?." && isDigit(s[this.pos + 2] || "")) continue;
          matched = p;
          break;
        }
      }
      if (!matched) matched = ch;
      if (!"()[]{},.;:+-*/%&|^~!<>?=`.$".includes(matched[0])) {
        throw this.syntaxError(`unexpected character ${JSON.stringify(ch)}`, start);
      }
      this.pos += matched.length;
      tok = { kind: "punct", value: matched, start, end: this.pos };
    }
    tok.lineBreakBefore = lineBreakBefore;
    this.tok = tok;
    return tok;
  }
}

class Parser {
  constructor(src, mapper) {
    this.lex = new Lexer(src, mapper);
    this.mapper = mapper;
  }

  get tok() { return this.lex.tok; }
  err(msg, offset = this.tok.start) { return this.lex.syntaxError(msg, offset); }
  is(kind, value) { return this.tok.kind === kind && (value === undefined || this.tok.value === value); }
  isIdentLike(word) { return this.tok.kind === "id" && !this.tok.escaped && this.tok.value === word; }

  eat(kind, value) {
    if (!this.is(kind, value)) return null;
    const t = this.tok;
    this.lex.advance();
    return t;
  }

  expect(kind, value) {
    const t = this.eat(kind, value);
    if (!t) throw this.err(`expected ${value || kind}, got ${this.tok.value || this.tok.kind}`);
    return t;
  }

  eatSemicolon() {
    if (this.eat("punct", ";")) return;
    if (this.is("eof") || this.is("punct", "}") || this.tok.lineBreakBefore) return;
    throw this.err(`expected ';' before '${this.tok.value || this.tok.kind}'`);
  }

  canContinueStmt() {
    return !this.is("eof") && !this.is("punct", "}") && !this.is("punct", ";") && !this.tok.lineBreakBefore;
  }

  parseProgram() {
    const body = [];
    while (!this.is("eof")) body.push(this.parseStatementListItem());
    return { type: "Program", body, start: 0, end: this.lex.src.length };
  }

  parseStatementListItem() {
    if (this.is("kw", "function")) return this.parseFunction(true, false);
    if (this.isIdentLike("async")) {
      const saved = this.lex.save();
      this.lex.advance();
      if (this.is("kw", "function") && !this.tok.lineBreakBefore) {
        this.lex.restore(saved);
        this.lex.advance();
        return this.parseFunction(true, true);
      }
      this.lex.restore(saved);
    }
    if (this.is("kw", "class")) return this.parseClass(true);
    if (this.is("kw", "const") || this.is("kw", "var")) return this.parseVariableDeclaration(false);
    if (this.isIdentLike("let") && this.looksLikeLetDeclaration()) return this.parseVariableDeclaration(false);
    return this.parseStatement();
  }

  looksLikeLetDeclaration() {
    const saved = this.lex.save();
    this.lex.advance();
    const next = this.tok;
    this.lex.restore(saved);
    return (next.kind === "id" && next.value !== "in") ||
      (next.kind === "punct" && (next.value === "{" || next.value === "["));
  }

  parseStatement() {
    const t = this.tok;
    if (this.is("punct", "{")) return this.parseBlock();
    if (this.eat("punct", ";")) return { type: "EmptyStatement", start: t.start, end: t.end };
    if (this.is("kw", "var")) return this.parseVariableDeclaration(false);
    if (this.is("kw", "if")) return this.parseIf();
    if (this.is("kw", "while")) return this.parseWhile();
    if (this.is("kw", "do")) return this.parseDoWhile();
    if (this.is("kw", "for")) return this.parseFor();
    if (this.is("kw", "switch")) return this.parseSwitch();
    if (this.is("kw", "try")) return this.parseTry();
    if (this.is("kw", "with")) {
      this.lex.advance();
      this.expect("punct", "(");
      const object = this.parseExpression(false);
      this.expect("punct", ")");
      const body = this.parseStatement();
      return { type: "WithStatement", object, body, start: t.start };
    }
    if (this.eat("kw", "debugger")) { this.eatSemicolon(); return { type: "DebuggerStatement", start: t.start }; }
    if (this.eat("kw", "return")) {
      const argument = this.canContinueStmt() ? this.parseExpression(false) : null;
      this.eatSemicolon();
      return { type: "ReturnStatement", argument, start: t.start };
    }
    if (this.eat("kw", "throw")) {
      if (this.tok.lineBreakBefore) throw this.err("illegal newline after throw");
      const argument = this.parseExpression(false);
      this.eatSemicolon();
      return { type: "ThrowStatement", argument, start: t.start };
    }
    if (this.eat("kw", "break")) {
      const label = this.canContinueStmt() && this.tok.kind === "id" ? this.parseIdentifier() : null;
      this.eatSemicolon();
      return { type: "BreakStatement", label, start: t.start };
    }
    if (this.eat("kw", "continue")) {
      const label = this.canContinueStmt() && this.tok.kind === "id" ? this.parseIdentifier() : null;
      this.eatSemicolon();
      return { type: "ContinueStatement", label, start: t.start };
    }
    if (this.tok.kind === "id") {
      const saved = this.lex.save();
      const id = this.parseIdentifier();
      if (this.eat("punct", ":")) {
        const body = this.parseStatement();
        return { type: "LabeledStatement", label: id, body, start: t.start };
      }
      this.lex.restore(saved);
    }
    const expr = this.parseExpression(false);
    this.eatSemicolon();
    return { type: "ExpressionStatement", expression: expr, start: t.start };
  }

  parseBlock() {
    const start = this.expect("punct", "{").start;
    const body = [];
    while (!this.is("punct", "}")) {
      if (this.is("eof")) throw this.err("unterminated block", start);
      body.push(this.parseStatementListItem());
    }
    const end = this.expect("punct", "}").end;
    return { type: "BlockStatement", body, start, end };
  }

  parseIf() {
    const start = this.expect("kw", "if").start;
    this.expect("punct", "(");
    const test = this.parseExpression(false);
    this.expect("punct", ")");
    const consequent = this.parseStatement();
    const alternate = this.eat("kw", "else") ? this.parseStatement() : null;
    return { type: "IfStatement", test, consequent, alternate, start };
  }

  parseWhile() {
    const start = this.expect("kw", "while").start;
    this.expect("punct", "(");
    const test = this.parseExpression(false);
    this.expect("punct", ")");
    const body = this.parseStatement();
    return { type: "WhileStatement", test, body, start };
  }

  parseDoWhile() {
    const start = this.expect("kw", "do").start;
    const body = this.parseStatement();
    this.expect("kw", "while");
    this.expect("punct", "(");
    const test = this.parseExpression(false);
    this.expect("punct", ")");
    this.eat("punct", ";");
    return { type: "DoWhileStatement", body, test, start };
  }

  parseFor() {
    const start = this.expect("kw", "for").start;
    const isAwait = !!this.eat("kw", "await");
    this.expect("punct", "(");
    let init = null;
    if (!this.is("punct", ";")) {
      const isDecl = this.is("kw", "var") || this.is("kw", "const") ||
        (this.isIdentLike("let") && this.looksLikeLetDeclaration());
      init = isDecl ? this.parseVariableDeclaration(true) : this.parseExpression(true);
      if (this.eat("kw", "in")) {
        const right = this.parseExpression(false);
        this.expect("punct", ")");
        const body = this.parseStatement();
        return {
          type: "ForInStatement",
          left: init.type === "VariableDeclaration" ? init : this.toAssignable(init),
          right,
          body,
          start,
        };
      }
      if (this.isIdentLike("of")) {
        this.lex.advance();
        const right = this.parseAssignmentExpression(false);
        this.expect("punct", ")");
        const body = this.parseStatement();
        return {
          type: "ForOfStatement",
          await: isAwait,
          left: init.type === "VariableDeclaration" ? init : this.toAssignable(init),
          right,
          body,
          start,
        };
      }
    }
    this.expect("punct", ";");
    const test = this.is("punct", ";") ? null : this.parseExpression(false);
    this.expect("punct", ";");
    const update = this.is("punct", ")") ? null : this.parseExpression(false);
    this.expect("punct", ")");
    const body = this.parseStatement();
    return { type: "ForStatement", init, test, update, body, start };
  }

  parseSwitch() {
    const start = this.expect("kw", "switch").start;
    this.expect("punct", "(");
    const discriminant = this.parseExpression(false);
    this.expect("punct", ")");
    this.expect("punct", "{");
    const cases = [];
    while (!this.is("punct", "}")) {
      if (this.is("eof")) throw this.err("unterminated switch", start);
      const caseStart = this.tok.start;
      let test = null;
      if (this.eat("kw", "case")) {
        test = this.parseExpression(false);
      } else {
        this.expect("kw", "default");
      }
      this.expect("punct", ":");
      const consequent = [];
      while (!this.is("kw", "case") && !this.is("kw", "default") && !this.is("punct", "}")) {
        consequent.push(this.parseStatementListItem());
      }
      cases.push({ type: "SwitchCase", test, consequent, start: caseStart });
    }
    this.expect("punct", "}");
    return { type: "SwitchStatement", discriminant, cases, start };
  }

  parseTry() {
    const start = this.expect("kw", "try").start;
    const block = this.parseBlock();
    let handler = null;
    if (this.eat("kw", "catch")) {
      const catchStart = this.tok.start;
      let param = null;
      if (this.eat("punct", "(")) {
        param = this.parseBindingPattern();
        this.expect("punct", ")");
      }
      const body = this.parseBlock();
      handler = { type: "CatchClause", param, body, start: catchStart };
    }
    const finalizer = this.eat("kw", "finally") ? this.parseBlock() : null;
    if (!handler && !finalizer) throw this.err("missing catch or finally after try", start);
    return { type: "TryStatement", block, handler, finalizer, start };
  }

  parseVariableDeclaration(noIn) {
    const tok = this.tok;
    const kind = tok.value;
    this.lex.advance();
    const declarations = [];
    do {
      const id = this.parseBindingPattern();
      const init = this.eat("punct", "=") ? this.parseAssignmentExpression(noIn) : null;
      declarations.push({ type: "VariableDeclarator", id, init, start: id.start });
    } while (this.eat("punct", ","));
    if (!noIn) this.eatSemicolon();
    return { type: "VariableDeclaration", kind, declarations, start: tok.start };
  }

  parseIdentifier() {
    if (this.tok.kind !== "id") throw this.err(`expected identifier, got ${this.tok.value || this.tok.kind}`);
    const t = this.tok;
    this.lex.advance();
    return { type: "Identifier", name: t.value, start: t.start, end: t.end };
  }

  parsePropertyNameNode() {
    if (this.eat("punct", "[")) {
      const expr = this.parseAssignmentExpression(false);
      this.expect("punct", "]");
      return { key: expr, computed: true };
    }
    const t = this.tok;
    if (t.kind === "id" || t.kind === "kw") {
      this.lex.advance();
      return { key: { type: "Identifier", name: t.value, start: t.start, end: t.end }, computed: false };
    }
    if (t.kind === "str" || t.kind === "num") {
      this.lex.advance();
      return { key: { type: "Literal", value: t.value, start: t.start, end: t.end }, computed: false };
    }
    throw this.err(`expected property name, got ${t.value || t.kind}`);
  }

  parseBindingPattern() {
    const start = this.tok.start;
    if (this.eat("punct", "{")) {
      const properties = [];
      while (!this.is("punct", "}")) {
        if (this.eat("punct", "...")) {
          const arg = this.parseBindingPattern();
          properties.push({ type: "RestElement", argument: arg, start: arg.start });
          this.eat("punct", ",");
          break;
        }
        const propStart = this.tok.start;
        const { key, computed } = this.parsePropertyNameNode();
        if (!computed && key.type === "Identifier" && !this.is("punct", ":")) {
          let value = key;
          if (this.eat("punct", "=")) {
            value = { type: "AssignmentPattern", left: key, right: this.parseAssignmentExpression(false), start: propStart };
          }
          properties.push({ type: "Property", key, value, computed: false, shorthand: true, start: propStart });
        } else {
          this.expect("punct", ":");
          let value = this.parseBindingPattern();
          if (this.eat("punct", "=")) {
            value = { type: "AssignmentPattern", left: value, right: this.parseAssignmentExpression(false), start: value.start };
          }
          properties.push({ type: "Property", key, value, computed, shorthand: false, start: propStart });
        }
        if (!this.eat("punct", ",")) break;
      }
      this.expect("punct", "}");
      return { type: "ObjectPattern", properties, start };
    }
    if (this.eat("punct", "[")) {
      const elements = [];
      while (!this.is("punct", "]")) {
        if (this.eat("punct", ",")) {
          elements.push(null);
          continue;
        }
        if (this.eat("punct", "...")) {
          const arg = this.parseBindingPattern();
          elements.push({ type: "RestElement", argument: arg, start: arg.start });
          this.eat("punct", ",");
          break;
        }
        let elem = this.parseBindingPattern();
        if (this.eat("punct", "=")) {
          elem = { type: "AssignmentPattern", left: elem, right: this.parseAssignmentExpression(false), start: elem.start };
        }
        elements.push(elem);
        if (!this.eat("punct", ",")) break;
      }
      this.expect("punct", "]");
      return { type: "ArrayPattern", elements, start };
    }
    return this.parseIdentifier();
  }

  parseParamList() {
    this.expect("punct", "(");
    const params = [];
    while (!this.is("punct", ")")) {
      if (this.eat("punct", "...")) {
        const arg = this.parseBindingPattern();
        params.push({ type: "RestElement", argument: arg, start: arg.start });
        this.eat("punct", ",");
        break;
      }
      let param = this.parseBindingPattern();
      if (this.eat("punct", "=")) {
        param = { type: "AssignmentPattern", left: param, right: this.parseAssignmentExpression(false), start: param.start };
      }
      params.push(param);
      if (!this.eat("punct", ",")) break;
    }
    this.expect("punct", ")");
    return params;
  }

  parseFunction(isDeclaration, isAsync) {
    const start = this.expect("kw", "function").start;
    const generator = !!this.eat("punct", "*");
    const id = (isDeclaration || this.tok.kind === "id") ? (this.tok.kind === "id" ? this.parseIdentifier() : null) : null;
    if (isDeclaration && !id) throw this.err("function statement requires a name", start);
    const params = this.parseParamList();
    const body = this.parseBlock();
    return {
      type: isDeclaration ? "FunctionDeclaration" : "FunctionExpression",
      id,
      params,
      body,
      async: isAsync,
      generator,
      start,
    };
  }

  parseClass(isDeclaration) {
    const start = this.expect("kw", "class").start;
    const id = this.tok.kind === "id" ? this.parseIdentifier() : null;
    if (isDeclaration && !id) throw this.err("class statement requires a name", start);
    const superClass = this.eat("kw", "extends") ? this.parseLeftHandSideExpression() : null;
    this.expect("punct", "{");
    const body = [];
    while (!this.is("punct", "}")) {
      if (this.is("eof")) throw this.err("unterminated class body", start);
      if (this.eat("punct", ";")) continue;
      const elemStart = this.tok.start;
      let isStatic = false;
      if (this.isIdentLike("static")) {
        const saved = this.lex.save();
        this.lex.advance();
        if (this.is("punct", "{")) {
          body.push({ type: "StaticBlock", body: this.parseBlock().body, start: elemStart });
          continue;
        }
        if (!this.is("punct", "(") && !this.is("punct", "=") && !this.is("punct", ";")) {
          isStatic = true;
        } else {
          this.lex.restore(saved);
        }
      }
      let isAsync = false;
      if (this.isIdentLike("async")) {
        const saved = this.lex.save();
        this.lex.advance();
        if (!this.tok.lineBreakBefore && !this.is("punct", "(") && !this.is("punct", "=") && !this.is("punct", ";")) {
          isAsync = true;
        } else {
          this.lex.restore(saved);
        }
      }
      const generator = !!this.eat("punct", "*");
      let kind = "method";
      if (!isAsync && !generator && (this.isIdentLike("get") || this.isIdentLike("set"))) {
        const maybeKind = this.tok.value;
        const saved = this.lex.save();
        this.lex.advance();
        if (!this.is("punct", "(") && !this.is("punct", "=") && !this.is("punct", ";")) {
          kind = maybeKind;
        } else {
          this.lex.restore(saved);
        }
      }
      let key;
      let computed = false;
      if (this.tok.kind === "privateId") {
        const p = this.tok;
        this.lex.advance();
        key = { type: "PrivateIdentifier", name: p.value, start: p.start };
      } else {
        ({ key, computed } = this.parsePropertyNameNode());
      }
      if (this.is("punct", "(")) {
        const params = this.parseParamList();
        const fnBody = this.parseBlock();
        body.push({
          type: "MethodDefinition",
          key,
          computed,
          static: isStatic,
          kind,
          value: { type: "FunctionExpression", id: null, params, body: fnBody, async: isAsync, generator, start: elemStart },
          start: elemStart,
        });
      } else {
        const value = this.eat("punct", "=") ? this.parseAssignmentExpression(false) : null;
        this.eatSemicolon();
        body.push({ type: "PropertyDefinition", key, computed, static: isStatic, value, start: elemStart });
      }
    }
    this.expect("punct", "}");
    return { type: isDeclaration ? "ClassDeclaration" : "ClassExpression", id, superClass, body, start };
  }

  parseExpression(noIn) {
    const first = this.parseAssignmentExpression(noIn);
    if (!this.is("punct", ",")) return first;
    const expressions = [first];
    while (this.eat("punct", ",")) expressions.push(this.parseAssignmentExpression(noIn));
    return { type: "SequenceExpression", expressions, start: first.start };
  }

  tryArrow(isAsync) {
    const start = this.tok.start;
    const saved = this.lex.save();
    try {
      let params;
      if (isAsync) {
        if (!this.isIdentLike("async")) return null;
        this.lex.advance();
        if (this.tok.lineBreakBefore) { this.lex.restore(saved); return null; }
      }
      if (this.is("punct", "(")) {
        params = this.parseParamList();
      } else if (this.tok.kind === "id") {
        params = [this.parseIdentifier()];
      } else {
        this.lex.restore(saved);
        return null;
      }
      if (this.tok.lineBreakBefore || !this.eat("punct", "=>")) {
        this.lex.restore(saved);
        return null;
      }
      const body = this.is("punct", "{") ? this.parseBlock() : this.parseAssignmentExpression(false);
      return {
        type: "ArrowFunctionExpression",
        params,
        body,
        expression: body.type !== "BlockStatement",
        async: isAsync,
        start,
      };
    } catch {
      this.lex.restore(saved);
      return null;
    }
  }

  toAssignable(node) {
    if (!node) throw this.err("invalid assignment target");
    switch (node.type) {
      case "Identifier":
      case "MemberExpression":
      case "ObjectPattern":
      case "ArrayPattern":
      case "RestElement":
      case "AssignmentPattern":
        return node;
      case "ParenthesizedExpression":
        if (node.expression.type === "Identifier" || node.expression.type === "MemberExpression") {
          return node.expression;
        }
        throw this.err("invalid parenthesized assignment target", node.start);
      case "ObjectExpression":
        return {
          type: "ObjectPattern",
          start: node.start,
          properties: node.properties.map((p) => {
            if (p.type === "SpreadElement") {
              return { type: "RestElement", argument: this.toAssignable(p.argument), start: p.start };
            }
            if (p.kind !== "init") throw this.err("invalid object destructuring target", p.start);
            return {
              type: "Property",
              key: p.key,
              computed: p.computed,
              shorthand: p.shorthand,
              value: p.shorthand && p.value.type === "AssignmentPattern"
                ? p.value
                : this.toAssignable(p.value),
              start: p.start,
            };
          }),
        };
      case "ArrayExpression":
        return {
          type: "ArrayPattern",
          start: node.start,
          elements: node.elements.map((el) => {
            if (!el) return null;
            if (el.type === "SpreadElement") {
              return { type: "RestElement", argument: this.toAssignable(el.argument), start: el.start };
            }
            return this.toAssignable(el);
          }),
        };
      case "AssignmentExpression":
        if (node.operator !== "=") throw this.err("invalid assignment pattern operator", node.start);
        return {
          type: "AssignmentPattern",
          left: this.toAssignable(node.left),
          right: node.right,
          start: node.start,
        };
      default:
        throw this.err(`invalid assignment target (${node.type})`, node.start);
    }
  }

  checkNoCoverDefaults(node) {
    if (node.type === "ObjectExpression") {
      for (const p of node.properties) {
        if (p.type === "Property" && p.shorthand && p.value?.type === "AssignmentPattern") {
          throw this.err("shorthand property initializer only valid in destructuring", p.start);
        }
      }
    }
  }

  parseAssignmentExpression(noIn) {
    if (this.is("kw", "yield")) {
      const start = this.tok.start;
      this.lex.advance();
      const delegate = !this.tok.lineBreakBefore && !!this.eat("punct", "*");
      const argument = !this.tok.lineBreakBefore && !this.is("punct", ";") && !this.is("punct", "}") &&
        !this.is("punct", ")") && !this.is("punct", "]") && !this.is("punct", ",") && !this.is("punct", ":")
        ? this.parseAssignmentExpression(noIn) : null;
      return { type: "YieldExpression", delegate, argument, start };
    }
    if (this.isIdentLike("async")) {
      const arrow = this.tryArrow(true);
      if (arrow) return arrow;
    }
    if (this.is("punct", "(") || this.tok.kind === "id") {
      const arrow = this.tryArrow(false);
      if (arrow) return arrow;
    }
    const left = this.parseConditional(noIn);
    if (this.tok.kind === "punct" && ASSIGN_OPS.has(this.tok.value)) {
      const op = this.tok.value;
      this.lex.advance();
      const target = op === "=" ? this.toAssignable(left) : left;
      const right = this.parseAssignmentExpression(noIn);
      return { type: "AssignmentExpression", operator: op, left: target, right, start: left.start };
    }
    this.checkNoCoverDefaults(left);
    return left;
  }

  parseConditional(noIn) {
    const test = this.parseBinary(0, noIn);
    if (!this.eat("punct", "?")) return test;
    const consequent = this.parseAssignmentExpression(false);
    this.expect("punct", ":");
    const alternate = this.parseAssignmentExpression(noIn);
    return { type: "ConditionalExpression", test, consequent, alternate, start: test.start };
  }

  parseBinary(level, noIn) {
    if (level >= BINARY_LEVELS.length) return this.parseExponentiation();
    let left = this.parseBinary(level + 1, noIn);
    const ops = BINARY_LEVELS[level];
    while (true) {
      const op = this.tok.value;
      const match = (this.tok.kind === "punct" || this.tok.kind === "kw") && ops.includes(op) &&
        !(noIn && op === "in");
      if (!match) break;
      this.lex.advance();
      const right = this.parseBinary(level + 1, noIn);
      const isLogical = op === "||" || op === "&&" || op === "??";
      left = { type: isLogical ? "LogicalExpression" : "BinaryExpression", operator: op, left, right, start: left.start };
    }
    return left;
  }

  parseExponentiation() {
    const left = this.parseUnary();
    if (this.eat("punct", "**")) {
      const right = this.parseExponentiation();
      return { type: "BinaryExpression", operator: "**", left, right, start: left.start };
    }
    return left;
  }

  parseUnary() {
    const t = this.tok;
    if ((t.kind === "kw" && (t.value === "delete" || t.value === "void" || t.value === "typeof" || t.value === "await")) ||
        (t.kind === "punct" && (t.value === "+" || t.value === "-" || t.value === "~" || t.value === "!"))) {
      this.lex.advance();
      const argument = this.parseUnary();
      return {
        type: t.value === "await" ? "AwaitExpression" : "UnaryExpression",
        operator: t.value,
        prefix: true,
        argument,
        start: t.start,
      };
    }
    if (t.kind === "punct" && (t.value === "++" || t.value === "--")) {
      this.lex.advance();
      const argument = this.parseUnary();
      return { type: "UpdateExpression", operator: t.value, prefix: true, argument, start: t.start };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    const expr = this.parseLeftHandSideExpression();
    if (!this.tok.lineBreakBefore && this.tok.kind === "punct" && (this.tok.value === "++" || this.tok.value === "--")) {
      const op = this.tok.value;
      this.lex.advance();
      return { type: "UpdateExpression", operator: op, prefix: false, argument: expr, start: expr.start };
    }
    return expr;
  }

  parseArguments() {
    this.expect("punct", "(");
    const args = [];
    while (!this.is("punct", ")")) {
      if (this.eat("punct", "...")) {
        const arg = this.parseAssignmentExpression(false);
        args.push({ type: "SpreadElement", argument: arg, start: arg.start });
      } else {
        args.push(this.parseAssignmentExpression(false));
      }
      if (!this.eat("punct", ",")) break;
    }
    this.expect("punct", ")");
    return args;
  }

  parseLeftHandSideExpression() {
    let expr;
    if (this.eat("kw", "new")) {
      const start = this.tok.start;
      if (this.eat("punct", ".")) {
        const prop = this.parseIdentifier();
        expr = { type: "MetaProperty", meta: "new", property: prop, start };
      } else {
        const callee = this.parseNewTargetCallee();
        const args = this.is("punct", "(") ? this.parseArguments() : [];
        expr = { type: "NewExpression", callee, arguments: args, start };
      }
    } else if (this.is("kw", "import")) {
      const start = this.tok.start;
      this.lex.advance();
      if (this.eat("punct", ".")) {
        const prop = this.parseIdentifier();
        expr = { type: "MetaProperty", meta: "import", property: prop, start };
      } else {
        const args = this.parseArguments();
        expr = { type: "ImportExpression", source: args[0], start };
      }
    } else {
      expr = this.parsePrimary();
    }
    return this.parseMemberOrCallTail(expr, true);
  }

  parseNewTargetCallee() {
    let expr;
    if (this.eat("kw", "new")) {
      const start = this.tok.start;
      if (this.eat("punct", ".")) {
        const prop = this.parseIdentifier();
        expr = { type: "MetaProperty", meta: "new", property: prop, start };
      } else {
        const callee = this.parseNewTargetCallee();
        const args = this.is("punct", "(") ? this.parseArguments() : [];
        expr = { type: "NewExpression", callee, arguments: args, start };
      }
    } else {
      expr = this.parsePrimary();
    }
    return this.parseMemberOrCallTail(expr, false);
  }

  parseMemberOrCallTail(expr, allowCalls) {
    while (true) {
      if (this.eat("punct", ".")) {
        let property;
        if (this.tok.kind === "privateId") {
          property = { type: "PrivateIdentifier", name: this.tok.value, start: this.tok.start };
          this.lex.advance();
        } else if (this.tok.kind === "id" || this.tok.kind === "kw") {
          property = { type: "Identifier", name: this.tok.value, start: this.tok.start };
          this.lex.advance();
        } else {
          throw this.err(`expected property name after '.'`);
        }
        expr = { type: "MemberExpression", object: expr, property, computed: false, optional: false, start: expr.start };
      } else if (this.eat("punct", "?.")) {
        if (this.is("punct", "(")) {
          if (!allowCalls) throw this.err("optional call not allowed in new callee");
          const args = this.parseArguments();
          expr = { type: "CallExpression", callee: expr, arguments: args, optional: true, start: expr.start };
        } else if (this.eat("punct", "[")) {
          const property = this.parseExpression(false);
          this.expect("punct", "]");
          expr = { type: "MemberExpression", object: expr, property, computed: true, optional: true, start: expr.start };
        } else {
          let property;
          if (this.tok.kind === "privateId") {
            property = { type: "PrivateIdentifier", name: this.tok.value, start: this.tok.start };
            this.lex.advance();
          } else if (this.tok.kind === "id" || this.tok.kind === "kw") {
            property = { type: "Identifier", name: this.tok.value, start: this.tok.start };
            this.lex.advance();
          } else {
            throw this.err("expected property name after '?.'");
          }
          expr = { type: "MemberExpression", object: expr, property, computed: false, optional: true, start: expr.start };
        }
      } else if (this.eat("punct", "[")) {
        const property = this.parseExpression(false);
        this.expect("punct", "]");
        expr = { type: "MemberExpression", object: expr, property, computed: true, optional: false, start: expr.start };
      } else if (allowCalls && this.is("punct", "(")) {
        const args = this.parseArguments();
        expr = { type: "CallExpression", callee: expr, arguments: args, optional: false, start: expr.start };
      } else if (this.is("tplFull") || this.is("tplHead")) {
        const quasi = this.parseTemplateLiteral();
        expr = { type: "TaggedTemplateExpression", tag: expr, quasi, start: expr.start };
      } else {
        break;
      }
    }
    return expr;
  }

  parsePrimary() {
    const t = this.tok;
    if (this.eat("kw", "this")) return { type: "ThisExpression", start: t.start };
    if (this.eat("kw", "super")) return { type: "Super", start: t.start };
    if (this.eat("kw", "null")) return { type: "Literal", value: null, start: t.start };
    if (this.eat("kw", "true")) return { type: "Literal", value: true, start: t.start };
    if (this.eat("kw", "false")) return { type: "Literal", value: false, start: t.start };
    if (t.kind === "num" || t.kind === "str") {
      this.lex.advance();
      return { type: "Literal", value: t.value, start: t.start };
    }
    if (t.kind === "punct" && (t.value === "/" || t.value === "/=")) {
      const rx = this.lex.asRegex();
      return { type: "Literal", value: rx.value, regex: true, start: rx.start };
    }
    if (t.kind === "tplFull" || t.kind === "tplHead") return this.parseTemplateLiteral();
    if (t.kind === "id") return this.parseIdentifier();
    if (this.eat("punct", "(")) {
      const expr = this.parseExpression(false);
      this.expect("punct", ")");
      return { type: "ParenthesizedExpression", expression: expr, start: t.start };
    }
    if (this.is("punct", "[")) return this.parseArrayLiteral();
    if (this.is("punct", "{")) return this.parseObjectLiteral();
    if (this.is("kw", "function")) return this.parseFunction(false, false);
    if (this.is("kw", "class")) return this.parseClass(false);
    throw this.err(`unexpected token '${t.value || t.kind}'`);
  }

  parseTemplateLiteral() {
    const start = this.tok.start;
    const quasis = [];
    const expressions = [];
    if (this.tok.kind === "tplFull") {
      quasis.push({ type: "TemplateElement", value: this.tok.value, tail: true, start: this.tok.start });
      this.lex.advance();
      return { type: "TemplateLiteral", quasis, expressions, start };
    }
    quasis.push({ type: "TemplateElement", value: this.tok.value, tail: false, start: this.tok.start });
    this.lex.advance();
    while (true) {
      expressions.push(this.parseExpression(false));
      const next = this.lex.readTemplateTailOrMid();
      if (next.kind === "tplTail") {
        quasis.push({ type: "TemplateElement", value: next.value, tail: true, start: next.start });
        this.lex.advance();
        break;
      }
      quasis.push({ type: "TemplateElement", value: next.value, tail: false, start: next.start });
      this.lex.advance();
    }
    return { type: "TemplateLiteral", quasis, expressions, start };
  }

  parseArrayLiteral() {
    const start = this.expect("punct", "[").start;
    const elements = [];
    while (!this.is("punct", "]")) {
      if (this.eat("punct", ",")) {
        elements.push(null);
        continue;
      }
      if (this.eat("punct", "...")) {
        const arg = this.parseAssignmentExpression(false);
        elements.push({ type: "SpreadElement", argument: arg, start: arg.start });
      } else {
        elements.push(this.parseAssignmentExpression(false));
      }
      if (!this.eat("punct", ",")) break;
    }
    this.expect("punct", "]");
    return { type: "ArrayExpression", elements, start };
  }

  parseObjectLiteral() {
    const start = this.expect("punct", "{").start;
    const properties = [];
    while (!this.is("punct", "}")) {
      if (this.eat("punct", "...")) {
        const arg = this.parseAssignmentExpression(false);
        properties.push({ type: "SpreadElement", argument: arg, start: arg.start });
        if (!this.eat("punct", ",")) break;
        continue;
      }
      const propStart = this.tok.start;
      let isAsync = false;
      if (this.isIdentLike("async")) {
        const saved = this.lex.save();
        this.lex.advance();
        if (!this.tok.lineBreakBefore && !this.is("punct", ":") && !this.is("punct", ",") &&
            !this.is("punct", "}") && !this.is("punct", "(") && !this.is("punct", "=")) {
          isAsync = true;
        } else {
          this.lex.restore(saved);
        }
      }
      const generator = !!this.eat("punct", "*");
      let kind = "init";
      if (!isAsync && !generator && (this.isIdentLike("get") || this.isIdentLike("set"))) {
        const maybeKind = this.tok.value;
        const saved = this.lex.save();
        this.lex.advance();
        if (!this.is("punct", ":") && !this.is("punct", ",") && !this.is("punct", "}") &&
            !this.is("punct", "(") && !this.is("punct", "=")) {
          kind = maybeKind;
        } else {
          this.lex.restore(saved);
        }
      }
      const { key, computed } = this.parsePropertyNameNode();
      if (this.is("punct", "(") || isAsync || generator || kind !== "init") {
        const params = this.parseParamList();
        const body = this.parseBlock();
        properties.push({
          type: "Property",
          key,
          computed,
          shorthand: false,
          method: kind === "init",
          kind,
          value: { type: "FunctionExpression", id: null, params, body, async: isAsync, generator, start: propStart },
          start: propStart,
        });
      } else if (this.eat("punct", ":")) {
        const value = this.parseAssignmentExpression(false);
        properties.push({ type: "Property", key, computed, shorthand: false, method: false, kind: "init", value, start: propStart });
      } else if (!computed && key.type === "Identifier") {
        let value = key;
        if (this.eat("punct", "=")) {
          value = { type: "AssignmentPattern", left: key, right: this.parseAssignmentExpression(false), start: propStart };
        }
        properties.push({ type: "Property", key, computed: false, shorthand: true, method: false, kind: "init", value, start: propStart });
      } else {
        throw this.err("expected ':' after object property name", propStart);
      }
      if (!this.eat("punct", ",")) break;
    }
    this.expect("punct", "}");
    return { type: "ObjectExpression", properties, start };
  }
}

export function parseJavaScript(src, mapper) {
  return new Parser(src, mapper).parseProgram();
}
