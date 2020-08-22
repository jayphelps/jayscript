import fs from 'fs';
import binaryen from 'binaryen';
import { exit } from 'process';

const { Module, readBinary } = binaryen;

const keywords = new Set(['function', 'return']);
const specialCharacters = new Set(['(', ')', '{', '}', ';', '+']);

class Parser {
  lookaheads = [];

  eof() {
    return this.index >= this.input.length;
  }

  skipWhitespace() {
    while (!this.eof()) {
      const ch = this.input[this.index];
      if (ch.match(/\S/)) {
        return;
      }
      this.index++;
    }
  }

  readNumber() {
    let start = this.index;
    this.index++;

    while (!this.eof()) {
      const ch = this.input[this.index];
      if (!ch.match(/[0-9]/)) {
        break;
      }

      this.index++;
    }

    const text = this.input.slice(start, this.index);

    return {
      kind: 'NUMBER',
      text,
      value: Number(text),
    };
  }

  readIdentifier() {
    let start = this.index;
    this.index++;

    while (!this.eof()) {
      const ch = this.input[this.index];
      if (!ch.match(/[_a-zA-Z0-9]/)) {
        break;
      }

      this.index++;
    }

    const value = this.input.slice(start, this.index);

    return {
      kind: 'IDENTIFIER',
      value,
    };
  }

  read() {
    if (this.lookaheads.length > 0) {
      return this.lookaheads.shift();
    }

    this.skipWhitespace();
    if (this.eof()) {
      return { type: 'EOF' };
    }

    const ch = this.input[this.index];

    if (ch.match(/[_a-zA-Z]/)) {
      const token = this.readIdentifier();
      if (keywords.has(token.value)) {
        return { kind: token.value };
      }

      return token;
    }

    if (ch.match(/[0-9]/)) {
      return this.readNumber();
    }

    if (specialCharacters.has(ch)) {
      this.index++;
      return { kind: ch };
    }

    throw new Error(`Unexpected ${ch}`);
  }

  peek() {
    if (this.lookaheads.length > 0) {
      return this.lookaheads[0];
    }
    const token = this.read();
    this.lookaheads.push(token);
    return token;
  }

  match(expectedKind) {
    const token = this.read();
    if (token.kind !== expectedKind) {
      throw new Error(`Expected ${expectedKind}, but saw ${token.kind}`);
    }
    return token;
  }

  parseNumber() {
    const token = this.match('NUMBER');

    return {
      kind: 'NumberLiteral',
      type: 'i32',
      text: token.text,
      value: token.value,
    };
  }

  parseBinaryExpression(left) {
    const operator = this.match('+').kind;
    const right = this.parseExpressionPart();

    if (left.type !== right.type) {
      throw new Error(
        `Incompatible types in binary expression, ${left.type} and ${right.type}`
      );
    }

    return {
      kind: 'BinaryExpression',
      type: left.type,
      left,
      operator,
      right,
    };
  }

  parseExpressionPart() {
    const token = this.peek();

    switch (token.kind) {
      case 'NUMBER':
        return this.parseNumber();

      default:
        throw new Error(`Unexpected token ${token.kind}`);
    }
  }

  parseExpression() {
    const left = this.parseExpressionPart();
    const token = this.peek();

    switch (token.kind) {
      case '+':
        return this.parseBinaryExpression(left);

      default:
        return left;
    }
  }

  parseBlock() {
    this.match('{');

    const body = [];
    while (!this.eof()) {
      const node = this.parseStatement();
      body.push(node);

      if (this.peek().kind === '}') {
        break;
      }
    }

    this.match('}');

    return {
      kind: 'Block',
      body,
    };
  }

  parseReturnStatement() {
    this.match('return');

    const argument = this.parseExpression();
    if (this.returnType && this.returnType !== argument.type) {
      throw new Error(
        `Type error, functions cannot return both ${this.returnType} and ${argument.type}`
      );
    }
    this.returnType = argument.type;

    return {
      kind: 'ReturnStatement',
      argument,
    };
  }

  parseFunctionDeclaration() {
    this.match('function');
    const name = this.match('IDENTIFIER');
    this.match('(');
    this.match(')');
    const body = this.parseBlock();
    const { returnType } = this;
    this.returnType = null;

    return {
      kind: 'FunctionDeclaration',
      name,
      body,
      returnType,
    };
  }

  parseStatementWithoutSemicolon() {
    const token = this.peek();

    switch (token.kind) {
      case 'function':
        return this.parseFunctionDeclaration();

      case 'return':
        return this.parseReturnStatement();

      default:
        throw new Error(`Unexpected token ${token.kind}`);
    }
  }

  parseStatement() {
    const node = this.parseStatementWithoutSemicolon();
    if (this.peek().kind === ';') {
      this.match(';');
    }
    return node;
  }

  parse(input) {
    this.input = input;
    this.index = 0;

    const body = [];

    while (!this.eof()) {
      const node = this.parseStatement();
      body.push(node);
    }

    return {
      kind: 'Script',
      body,
    };
  }
}

const typeStringToBinaryenType = new Map([['i32', binaryen.i32]]);

class CodegenVisitor {
  module = new Module();
  returnType = null;

  visitEach(nodes) {
    return nodes.map((node) => this.visit(node));
  }

  visitNumberLiteral(node) {
    return this.module.i32.const(node.value);
  }

  visitBinaryExpression(node) {
    const left = this.visit(node.left);
    const right = this.visit(node.right);

    switch (node.operator) {
      case '+':
        return this.module.i32.add(left, right);

      default:
        throw new Error(`Unexpected operator ${node.operator}`);
    }
  }

  visitBlock(node) {
    const body = this.visitEach(node.body);
    return this.module.block('', body);
  }

  visitReturnStatement(node) {
    const argument = this.visit(node.argument);
    return this.module.return(argument);
  }

  visitFunctionDeclaration(node) {
    const name = node.name.value;
    const body = this.visitBlock(node.body);
    const results = typeStringToBinaryenType.get(node.returnType) ?? null;
    this.module.addFunction(name, binaryen.createType([]), results, [], body);
    this.module.addFunctionExport(name, name);
  }

  visitScript(node) {
    this.visitEach(node.body);
    this.module.validate();
    return this.module;
  }

  visit(node) {
    const methodName = `visit${node.kind}`;
    if (typeof this[methodName] !== 'function') {
      throw new Error(`Unexpected AST node ${node.kind}`);
    }

    return this[methodName](node);
  }
}

function compile(input) {
  const parser = new Parser();
  const ast = parser.parse(input);

  const visitor = new CodegenVisitor();
  const module = visitor.visit(ast);

  return module.emitBinary();
}


function panic(msg) {
  console.error(msg);
  exit(1);
}

export function main(args) {
  if (args.length === 0) {
    panic('Please provide an input file path');
  }

  if (args.length > 1) {
    panic('You can only provide a single input file path');
  }

  const [filePath] = args;
  const contents = fs.readFileSync(filePath, 'utf-8');
  const binary = compile(contents);

  const text = readBinary(binary);
  console.log(text.emitText());
  const filePathWithoutExtension = filePath.slice(0, filePath.lastIndexOf('.'));
  fs.writeFileSync(`${filePathWithoutExtension}.wasm`, binary);
}