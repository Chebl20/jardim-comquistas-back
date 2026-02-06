const { readFileSync } = require('fs');
const path = require('path');

const svgPath = path.join(process.cwd(), 'src', 'assets', 'worlds', 'mundo2.svg');
const svgText = readFileSync(svgPath, 'utf8');
console.log('SVG length:', svgText.length);

const svgdom = require('svgdom');
if (typeof svgdom.createSVGDocument !== 'function') {
  console.error('svgdom.createSVGDocument não disponível:', Object.keys(svgdom));
  process.exit(2);
}

const doc = svgdom.createSVGDocument(svgText);
console.log('documentElement.tagName =', doc.documentElement && doc.documentElement.tagName);
console.log('querySelectorAll exists =', typeof doc.querySelectorAll === 'function');

try {
  const nodes = doc.querySelectorAll('[data-layer][data-slot]');
  console.log('querySelectorAll([data-layer][data-slot]) count =', nodes.length);
  if (nodes.length > 0) {
    const el = nodes[0];
    try {
      console.log('first matching tagName =', el.tagName);
      console.log('attributes sample =', el.getAttributeNames ? el.getAttributeNames() : Object.keys(el.attributes || {}));
    } catch (e) {
      console.log('erro lendo atributos do elemento:', String(e));
    }
    try {
      const box = el.getBBox();
      console.log('getBBox OK:', box);
    } catch (e) {
      console.log('getBBox erro:', String(e));
    }
    try {
      console.log('outerHTML (slice 0..400) =', (el.outerHTML || new (require('xmldom').XMLSerializer)().serializeToString(el)).slice(0,400));
    } catch (e) {
      console.log('serialize erro:', String(e));
    }
  }
} catch (e) {
  console.log('querySelectorAll erro:', String(e));
}

try {
  const rects = doc.getElementsByTagName('rect');
  console.log('getElementsByTagName(rect) count =', rects.length);
} catch (e) {
  console.log('getElementsByTagName erro:', String(e));
}

console.log('Done.');
