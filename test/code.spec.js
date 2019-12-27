const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const babel = require('@babel/core');
const { NodeVM } = require('vm2');
const remark = require('remark');
const visit = require('unist-util-visit');

const MANUSCRIPT = path.resolve(__dirname, '../manuscript/book.md');
const LANGS = ['js', 'jsx', 'ts', 'tsx'];
const IGNORE_HEADERS = ['prettier-ignore'];
const SKIP_TAG = 'test-skip';

const vm = new NodeVM({
  sandbox: global,
  require: {
    external: true,
    builtin: ['*'],
    mock: {
      fs: {
        readFileSync: x => x
      },
      reamde: x => x
    }
  }
});

function isInstruction(node) {
  return (
    node &&
    node.type === 'html' &&
    node.value.startsWith('<!--') &&
    node.value.endsWith('-->')
  );
}

function unwrapHtmlComment(html) {
  return html
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .trim();
}

function getHeader(nodes, index) {
  const header = nodes[index - 1];
  if (!isInstruction(header)) {
    return '';
  }

  const cleanHeader = unwrapHtmlComment(header.value);

  if (IGNORE_HEADERS.includes(cleanHeader)) {
    return getHeader(nodes, index - 1);
  }

  return cleanHeader;
}

function getFooter(nodes, index) {
  const footer = nodes[index + 1];
  if (isInstruction(footer)) {
    return unwrapHtmlComment(footer.value);
  }
  return '';
}

function getChapterTitle(nodes, index) {
  const headingIndex = _.findLastIndex(
    nodes,
    node => node.type === 'heading',
    index
  );
  if (headingIndex === -1) {
    return '';
  }

  const headingNode = nodes[headingIndex];
  return headingNode.children[0].value;
}

const testNameIndicies = {};

function getTestName(title) {
  if (!testNameIndicies[title]) {
    testNameIndicies[title] = 0;
  }

  testNameIndicies[title] += 1;

  return `${title} ${testNameIndicies[title]}`;
}

async function executeCode(source, filename) {
  const { code } = await babel.transformAsync(source, {
    filename
  });
  vm.run(code, filename);
}

function testMarkdown(markdown, filepath) {
  const filename = path.basename(filepath);

  function visitor() {
    return ast => {
      visit(ast, 'code', (node, index, { children: siblings }) => {
        if (!LANGS.includes(node.lang)) {
          return;
        }

        const header = getHeader(siblings, index);
        if (header === SKIP_TAG) {
          return;
        }

        const footer = getFooter(siblings, index);
        const linesToPad =
          node.position.start.line - header.split('\n').length - 3;

        const code = [
          // Show correct line number in code snippets
          '\n'.repeat(linesToPad),
          header,
          node.value,
          footer
        ].join('\n\n');

        test(
          getTestName(getChapterTitle(siblings, index)),
          async () => {
            await executeCode(code, `${filename}.${node.lang}`);
          }
        );
      });
    };
  }

  describe(filename, () => {
    remark()
      .use(visitor)
      .processSync(markdown);
  });
}

// RUN!
const content = fs.readFileSync(MANUSCRIPT, 'utf8');
testMarkdown(content, MANUSCRIPT);
