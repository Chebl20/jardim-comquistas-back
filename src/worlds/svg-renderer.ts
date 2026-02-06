// Renderer que usa Chromium headless (Puppeteer) para medir SVGs com layout real
// Retorna um objeto compatível com a saída esperada pelo backend.
export async function renderSVGLayout(svgText: string) {
  // carregamos puppeteer dinamicamente para não quebrar ambientes sem o binário
  let puppeteer: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    puppeteer = require('puppeteer');
  } catch (err) {
    throw new Error('puppeteer não encontrado. Instale com `npm install puppeteer` para usar o renderer headless.');
  }

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    // forçamos o conteúdo HTML com o SVG (sem scripts externos)
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${svgText}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Ler viewBox e forçar viewport / tamanho do SVG para evitar
    // que o navegador escale o SVG para um viewport menor.
    const svgViewBox = await page.$eval('svg', (el) => el.getAttribute('viewBox') || '');
    const vbParts = String(svgViewBox).split(/\s+/).map((v) => parseFloat(v));
    const vbWidth = Math.max(1, Math.round(vbParts[2] || 800));
    const vbHeight = Math.max(1, Math.round(vbParts[3] || 600));
    try {
      await page.setViewport({ width: vbWidth, height: vbHeight, deviceScaleFactor: 1 });
    } catch (e) {
      // se setViewport falhar, apenas seguimos — a medição ainda pode funcionar
    }
    await page.addStyleTag({ content: `html,body{margin:0;padding:0} svg{width:${vbWidth}px;height:${vbHeight}px;}` });

    const result = await page.evaluate(() => {
      function parseTransformOrigin(styleText: string | null) {
        if (!styleText) return null;
        const m = styleText.match(/transform-origin\s*:\s*([^;]+);?/i);
        if (!m) return null;
        const raw = m[1].trim();
        const parts = raw.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
        if (parts.length < 2) return null;
        if (parts[0].endsWith('%') && parts[1].endsWith('%')) {
          return { kind: 'pct', xPct: parseFloat(parts[0]) / 100, yPct: parseFloat(parts[1]) / 100 };
        }
        return { kind: 'abs', x: parseFloat(parts[0]), y: parseFloat(parts[1]) };
      }

      const svg = document.querySelector('svg');
      if (!svg) throw new Error('SVG não encontrado no documento');

      const viewBoxAttr = svg.getAttribute('viewBox') || '';
      const vbParts = String(viewBoxAttr).split(/\s+/).map((v) => parseFloat(v));
      const viewBox = { minX: vbParts[0] || 0, minY: vbParts[1] || 0, width: vbParts[2] || 0, height: vbParts[3] || 0 };

      const nodes = Array.from(svg.querySelectorAll('[data-layer][data-slot]')) as Element[];

      const anchors = nodes.map((node) => {
        const el = node as any;
        // Para evitar ambiguidades do outerHTML, serializamos manualmente tags
        // que devem ser self-closing para garantir consistência com o frontend.
        const tag = (el.tagName || el.nodeName || '').toString().toLowerCase();
        const selfClosing = ['rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon'];
        let svgLine = '';
        if (selfClosing.includes(tag)) {
          try {
            const attrs = Array.from((el.attributes || []) as any).map((a: any) => `${a.name}="${a.value}"`).join(' ');
            svgLine = `<${tag}${attrs ? ' ' + attrs : ''}/>`;
          } catch {
            svgLine = (el.outerHTML || new XMLSerializer().serializeToString(el));
          }
        } else {
          svgLine = (el.outerHTML || new XMLSerializer().serializeToString(el));
          svgLine = svgLine.replace(/\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
        }

        // bbox no espaço do usuário do elemento
        const bbox = (() => {
          try { return el.getBBox(); } catch { return { x: 0, y: 0, width: 0, height: 0 }; }
        })();

        // ponto central por padrão
        const pt = svg.createSVGPoint();
        pt.x = bbox.x + (bbox.width || 0) / 2;
        pt.y = bbox.y + (bbox.height || 0) / 2;

        const ctm = el.getCTM() || svg.createSVGMatrix();
        const worldPt = pt.matrixTransform(ctm);

        let spriteAnchorX: number | undefined = undefined;
        let spriteAnchorY: number | undefined = undefined;
        const origin = parseTransformOrigin(el.getAttribute('style'));
        if (origin && bbox.width && bbox.height) {
          if (origin.kind === 'pct') {
            spriteAnchorX = Number(origin.xPct || 0);
            spriteAnchorY = Number(origin.yPct || 0);
            const op = svg.createSVGPoint();
            op.x = bbox.x + bbox.width * Number(origin.xPct || 0);
            op.y = bbox.y + bbox.height * Number(origin.yPct || 0);
            const opWorld = op.matrixTransform(ctm);
            worldPt.x = opWorld.x; worldPt.y = opWorld.y;
          } else if (origin.kind === 'abs') {
            spriteAnchorX = (Number(origin.x || 0) - bbox.x) / bbox.width;
            spriteAnchorY = (Number(origin.y || 0) - bbox.y) / bbox.height;
            const op = svg.createSVGPoint(); op.x = Number(origin.x || 0); op.y = Number(origin.y || 0);
            const opWorld = op.matrixTransform(ctm);
            worldPt.x = opWorld.x; worldPt.y = opWorld.y;
          }
        }

        return {
          layer: el.getAttribute('data-layer'),
          slot: el.getAttribute('data-slot'),
          x: Number(worldPt.x),
          y: Number(worldPt.y),
          width: Number(bbox.width || 0),
          height: Number(bbox.height || 0),
          svgLine: svgLine.replace(/\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, ''),
          spriteAnchorX,
          spriteAnchorY,
          treeType: el.getAttribute('data-treeType') || undefined,
        };
      });

      return { anchors, viewBox };
    });

    return result;
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }
}

export default renderSVGLayout;
