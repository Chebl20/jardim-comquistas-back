
/**
 * Utilitários para manipulação de matrizes de transformação
 */

/**
 * Extrai os valores da matriz de uma string de transformação matrix(a,b,c,d,e,f)
 */
export function parseMatrix(transform: string): number[] {
  const match = transform.match(/matrix\(([^)]+)\)/);
  if (match) {
    return match[1].split(",").map(parseFloat);
  }
  return [1, 0, 0, 1, 0, 0];
}

/**
 * Aplica uma transformação de matriz a um ponto (x, y)
 */
export function transformPoint(
  x: number,
  y: number,
  matrix: number[],
): { x: number; y: number } {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

import { createHash } from 'crypto';

export type SlotAnchor = {
  layer: string; // L1, L2, L3...
  slot: string; // 1, 2, 3...
  x: number; // posição X no mundo
  y: number; // posição Y no mundo
  width: number; // largura do elemento
  height: number; // altura do elemento
  /** Pivot do sprite (0..1) para ancorar o “tronco” ao ponto x/y. */
  spriteAnchorX?: number;
  /** Pivot do sprite (0..1) para ancorar o “tronco” ao ponto x/y. */
  spriteAnchorY?: number;
  /** Linha/serialização do elemento no SVG (ex: <rect .../>). */
  svgLine?: string;
  /** Tipo de árvore (ex: "a", "b"). */
  treeType?: string;
  /** Identificador determinístico da âncora (opcional). */
  anchorId?: string;
};

/**
 * Resultado da análise do SVG
 */
export interface SVGParseResult {
  anchors: SlotAnchor[];
  viewBox: { minX: number; minY: number; width: number; height: number };
}

/**
 * Analisa o layout SVG e extrai os anchors dos slots
 */
// Adapta para Node.js: cria DOMParser global usando svgdom se necessário




// Função para obter um Document a partir de uma string SVG.
let getDocumentFromString: (svgText: string) => any;
// Forçar uso de svgdom.createSVGDocument no Node.js para garantir um DOM SVG real
if (typeof DOMParser === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const svgdom = require('svgdom');
  if (typeof svgdom.createSVGDocument !== 'function') {
    throw new Error('svgdom.createSVGDocument não encontrado — instale/atualize a dependência svgdom');
  }
  getDocumentFromString = (svgText: string) => svgdom.createSVGDocument(svgText);
} else {
  getDocumentFromString = (svgText: string) => new DOMParser().parseFromString(svgText, 'image/svg+xml');
}

export async function parseSVGLayout(svgText: string): Promise<SVGParseResult> {
  // Tenta usar renderer headless real (Chromium) se disponível
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const renderer = require('./svg-renderer');
    if (renderer && typeof renderer.renderSVGLayout === 'function') {
      try {
        const out = await renderer.renderSVGLayout(svgText);
        const anchorsFromRenderer = out.anchors || [];
        // garante anchorId determinísticos mesmo quando o renderer retorna as anchors
        const anchorsWithIds = anchorsFromRenderer.map((a: any) => {
          if (a && a.anchorId) return a;
          try {
            const norm = {
              layer: a?.layer,
              slot: a?.slot,
              treeType: a?.treeType,
              x: Number(a?.x || 0).toFixed(3),
              y: Number(a?.y || 0).toFixed(3),
              width: Number(a?.width || 0).toFixed(3),
              height: Number(a?.height || 0).toFixed(3),
              spriteAnchorX: a?.spriteAnchorX != null ? Number(a.spriteAnchorX).toFixed(6) : null,
              spriteAnchorY: a?.spriteAnchorY != null ? Number(a.spriteAnchorY).toFixed(6) : null,
              svgLine: a?.svgLine || '',
            };
            const s = JSON.stringify(norm);
            const h = createHash('sha1').update(s).digest('hex');
            return { ...a, anchorId: h };
          } catch {
            return a;
          }
        });
        return { anchors: anchorsWithIds, viewBox: out.viewBox || { minX: 0, minY: 0, width: 0, height: 0 } };
      } catch (e) {
        // renderer falhou — fallback para parser interno
      }
    }
  } catch {
    // module not found ou erro de require -> segue com parser interno
  }
  const parseTransformOrigin = (
    styleText: string | null,
  ):
    | { kind: "pct"; xPct: number; yPct: number }
    | { kind: "abs"; x: number; y: number }
    | null => {
    if (!styleText) return null;
    const m = styleText.match(/transform-origin\s*:\s*([^;]+);?/i);
    if (!m) return null;
    const raw = m[1]?.trim();
    if (!raw) return null;

    // Aceita: "50% 100%" | "1159.94px 863.5px" | "1159.94 863.5"
    const parts = raw
      .replace(/,/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length < 2) return null;

    const parsePct = (v: string): number | null => {
      const mm = v.match(/^(-?\d+(?:\.\d+)?)%$/);
      if (!mm) return null;
      const n = Number.parseFloat(mm[1]);
      if (!Number.isFinite(n)) return null;
      // alguns exports podem gerar 100.003%
      return Math.min(100, Math.max(0, n));
    };

    const parseAbs = (v: string): number | null => {
      // remove unidade px (se existir)
      const cleaned = v.trim().toLowerCase().endsWith("px")
        ? v.trim().slice(0, -2)
        : v.trim();
      const n = Number.parseFloat(cleaned);
      return Number.isFinite(n) ? n : null;
    };

    const xPct = parsePct(parts[0]);
    const yPct = parsePct(parts[1]);
    if (xPct != null && yPct != null) return { kind: "pct", xPct, yPct };

    const x = parseAbs(parts[0]);
    const y = parseAbs(parts[1]);
    if (x == null || y == null) return null;
    return { kind: "abs", x, y };
  };

  // No Node.js usamos svgdom + @svgdotjs/svg.js para garantir parsing
  // consistente (querySelector + getBBox funcionando). No browser caímos
  // no caminho padrão com DOMParser.
  let elements: any[] = [];
  let vbMinX = 0, vbMinY = 0, vbWidth = 100, vbHeight = 100;

  if (typeof DOMParser === 'undefined') {
    // Node: criar window/svg document via svgdom e @svgdotjs/svg.js
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const svgdom = require('svgdom');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SVG, registerWindow } = require('@svgdotjs/svg.js');
    const window = svgdom.createSVGWindow();
    const document = window.document;
    registerWindow(window, document);
    const root = SVG(svgText);

    // viewBox pode vir do root
    const viewBoxAttr = root.attr('viewBox') || document.documentElement.getAttribute('viewBox');
    if (viewBoxAttr) {
      const parts = String(viewBoxAttr).split(/\s+/).map(parseFloat);
      vbMinX = parts[0] || 0;
      vbMinY = parts[1] || 0;
      vbWidth = parts[2] || 100;
      vbHeight = parts[3] || 100;
    }

    const nodes = root.find('[data-layer][data-slot]');
    if (!nodes || nodes.length === 0) {
      throw new Error('Nenhum elemento com data-layer/data-slot encontrado via svg.js/svgdom.');
    }
    elements = nodes.map((n: any) => n.node);
  } else {
    const doc = getDocumentFromString(svgText);

    const svg = doc.documentElement;
    const viewBoxAttr = svg.getAttribute('viewBox');
    if (viewBoxAttr) {
      const parts = viewBoxAttr.split(' ').map(parseFloat);
      vbMinX = parts[0] || 0;
      vbMinY = parts[1] || 0;
      vbWidth = parts[2] || 100;
      vbHeight = parts[3] || 100;
    }

    const nodes = (typeof doc.querySelectorAll === 'function') ? doc.querySelectorAll('[data-layer][data-slot]') : [];

    elements = Array.from(nodes as any);
    if (elements.length === 0) {
      const all: Element[] = (typeof doc.getElementsByTagName === 'function')
        ? Array.from(doc.getElementsByTagName('*') as any)
        : Array.from((doc as any).children || []);
      elements = all.filter((el) => {
        try {
          return !!(el.getAttribute && el.getAttribute('data-layer') && el.getAttribute('data-slot'));
        } catch {
          return false;
        }
      });
    }

    if (elements.length === 0) {
      throw new Error('Nenhum elemento com data-layer/data-slot encontrado via DOM. Verifique o SVG.');
    }
  }

  // Função utilitária para acumular todas as transformações dos ancestrais
  function getCumulativeTransform(el: Element): number[] {
    let matrix = [1, 0, 0, 1, 0, 0]; // identidade
    let current: Element | null = el;
    const stack: string[] = [];
    while (current && current.nodeName !== "svg") {
      const t = current.getAttribute("transform");
      if (t) {
        stack.push(t);
      }
      current = current.parentElement;
    }
    // Aplica da raiz para a folha (ordem inversa)
    for (let i = stack.length - 1; i >= 0; i--) {
      const m = parseMatrix(stack[i]);
      matrix = [
        matrix[0] * m[0] + matrix[2] * m[1],
        matrix[1] * m[0] + matrix[3] * m[1],
        matrix[0] * m[2] + matrix[2] * m[3],
        matrix[1] * m[2] + matrix[3] * m[3],
        matrix[0] * m[4] + matrix[2] * m[5] + matrix[4],
        matrix[1] * m[4] + matrix[3] * m[5] + matrix[5],
      ];
    }
    return matrix;
  }

  const anchors = Array.from(elements).map((el) => {
    let x = 0;
    let y = 0;
    let width = 0;
    let height = 0;

    let spriteAnchorX: number | undefined;
    let spriteAnchorY: number | undefined;

    // bbox do elemento (para suportar transform-origin em %)
    let boxX = 0;
    let boxY = 0;
    let boxW = 0;
    let boxH = 0;

    let svgLine = "";
    try {
      svgLine = (el as Element).outerHTML ?? "";
    } catch {
      // ignore
    }
    if (!svgLine) {
      try {
        svgLine = new XMLSerializer().serializeToString(el);
      } catch {
        // ignore
      }
    }

    // Alguns serializadores injetam xmlns no elemento (ex: <path xmlns="http://www.w3.org/2000/svg" ...>).
    // No arquivo original isso normalmente fica só no <svg>, então removemos pra facilitar busca/cópia.
    if (svgLine) {
      svgLine = svgLine.replace(
        /\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g,
        "",
      );
    }

    // Normaliza tags sem filhos para forma self-closing (combinar com frontend)
    try {
      const tag = ((el && (el.tagName || el.nodeName)) || '').toString().toLowerCase();
      if (svgLine && ['rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon'].includes(tag)) {
        svgLine = svgLine.replace(new RegExp(`</${tag}>\s*$`), '/>');
      }
    } catch {
      // ignore
    }

    // Calcula posição dependendo do tipo de elemento
    const tagName = ((el && (el.tagName || el.nodeName)) || '').toString().toLowerCase();
    if (typeof SVGCircleElement !== 'undefined' && el instanceof SVGCircleElement) {
      x = el.cx.baseVal.value;
      y = el.cy.baseVal.value;
      const r = el.r.baseVal.value;
      width = r * 2;
      height = r * 2;
      boxX = x - r;
      boxY = y - r;
      boxW = width;
      boxH = height;
    } else if (tagName === 'circle') {
      const cx = parseFloat(el.getAttribute('cx') || '0');
      const cy = parseFloat(el.getAttribute('cy') || '0');
      const r = parseFloat(el.getAttribute('r') || '0');
      x = cx; y = cy; width = r * 2; height = r * 2; boxX = cx - r; boxY = cy - r; boxW = width; boxH = height;
    } else if (typeof SVGRectElement !== 'undefined' && el instanceof SVGRectElement) {
      const rx = el.x.baseVal.value;
      const ry = el.y.baseVal.value;
      width = el.width.baseVal.value;
      height = el.height.baseVal.value;
      boxX = rx;
      boxY = ry;
      boxW = width;
      boxH = height;
      x = rx + width / 2;
      y = ry + height / 2;
    } else if (tagName === 'rect') {
      const rx = parseFloat(el.getAttribute('x') || '0');
      const ry = parseFloat(el.getAttribute('y') || '0');
      width = parseFloat(el.getAttribute('width') || '0');
      height = parseFloat(el.getAttribute('height') || '0');
      boxX = rx; boxY = ry; boxW = width; boxH = height; x = rx + width / 2; y = ry + height / 2;
    } else if (typeof SVGEllipseElement !== 'undefined' && el instanceof SVGEllipseElement) {
      x = el.cx.baseVal.value;
      y = el.cy.baseVal.value;
      width = el.rx.baseVal.value * 2;
      height = el.ry.baseVal.value * 2;
      boxX = x - width / 2;
      boxY = y - height / 2;
      boxW = width;
      boxH = height;
    } else if (tagName === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx') || '0');
      const cy = parseFloat(el.getAttribute('cy') || '0');
      const rx = parseFloat(el.getAttribute('rx') || '0');
      const ry = parseFloat(el.getAttribute('ry') || '0');
      x = cx; y = cy; width = rx * 2; height = ry * 2; boxX = cx - width / 2; boxY = cy - height / 2; boxW = width; boxH = height;
    } else {
      // fallback para paths, g, ou outros elementos
      if (tagName === 'path') {
        const d = el.getAttribute('d') || '';
        const match = d.match(/M\s+(\d+\.?\d*)\s+(\d+\.?\d*)/);
        if (match) {
          let px = parseFloat(match[1]);
          let py = parseFloat(match[2]);

          // Calcula o centro e o tamanho analisando o retângulo do d
          const hMatch = d.match(/H\s+(\d+\.?\d*)/);
          const vMatch = d.match(/V\s+(\d+\.?\d*)/);
          if (hMatch && vMatch) {
            width = parseFloat(hMatch[1]) - px;
            height = parseFloat(vMatch[1]) - py;
            px += width / 2;
            py += height / 2;
          }

          x = px;
          y = py;
          // melhor aproximação de bbox sem custo alto
          boxX = px;
          boxY = py;
          boxW = width;
          boxH = height;
        } else {
          const box = (el as any).getBBox();
          x = box.x + box.width / 2;
          y = box.y + box.height / 2;
          width = box.width;
          height = box.height;
          boxX = box.x;
          boxY = box.y;
          boxW = box.width;
        }
      } else {
        const box = (el as any).getBBox();
        x = box.x + box.width / 2;
        y = box.y + box.height / 2;
        width = box.width;
        height = box.height;
        boxX = box.x;
        boxY = box.y;
        boxW = box.width;
        boxH = box.height;
      }
    }

    // Aplica a matriz composta de transformações de todos os ancestrais
    const cumulativeMatrix = getCumulativeTransform(el);
    const transformed = transformPoint(x, y, cumulativeMatrix);
    x = transformed.x;
    y = transformed.y;

    // Se o elemento trouxer `transform-origin: ...% ...%` no style,
    // usa esse ponto como o anchor (ex.: 50% 100% = base do tronco).
    // Isso permite a árvore crescer "a partir do tronco".
    const origin = parseTransformOrigin(el.getAttribute("style"));
    if (origin && boxW > 0 && boxH > 0) {
      if (origin.kind === "pct") {
        spriteAnchorX = origin.xPct / 100;
        spriteAnchorY = origin.yPct / 100;
        // Aplica transformação acumulada ao ponto de origem
        const originPoint = transformPoint(
          boxX + boxW * (origin.xPct / 100),
          boxY + boxH * (origin.yPct / 100),
          cumulativeMatrix
        );
        x = originPoint.x;
        y = originPoint.y;
      } else {
        // Quando exportado como px (ex.: Inkscape), o editor costuma gravar
        // o transform-origin em coordenadas absolutas no espaço do SVG.
        // Convertemos isso para (0..1) relativo ao bbox para servir como anchor.
        const ax = (origin.x - boxX) / boxW;
        const ay = (origin.y - boxY) / boxH;
        spriteAnchorX = Math.min(1, Math.max(0, ax));
        spriteAnchorY = Math.min(1, Math.max(0, ay));
        // Aplica transformação acumulada ao ponto de origem absoluto
        const originPoint = transformPoint(origin.x, origin.y, cumulativeMatrix);
        x = originPoint.x;
        y = originPoint.y;
      }
    }

    function getInheritedAttribute(elm: Element | null, name: string): string | undefined {
      let cur: any = elm;
      while (cur) {
        try {
          if (cur.getAttribute) {
            const v = cur.getAttribute(name);
            if (v != null) return v;
          }
        } catch {}
        cur = cur.parentElement;
      }
      return undefined;
    }

    const anchor: SlotAnchor = {
      layer: el.getAttribute("data-layer")!,
      slot: el.getAttribute("data-slot")!,
      treeType: getInheritedAttribute(el, "data-type"),
      x,
      y,
      width,
      height,
      spriteAnchorX,
      spriteAnchorY,
      svgLine,
    };

    // gera um id determinístico baseado no conteúdo essencial da âncora
    try {
      const norm = {
        layer: anchor.layer,
        slot: anchor.slot,
        x: Number(anchor.x).toFixed(3),
        y: Number(anchor.y).toFixed(3),
        width: Number(anchor.width).toFixed(3),
        height: Number(anchor.height).toFixed(3),
        spriteAnchorX: anchor.spriteAnchorX != null ? Number(anchor.spriteAnchorX).toFixed(6) : null,
        spriteAnchorY: anchor.spriteAnchorY != null ? Number(anchor.spriteAnchorY).toFixed(6) : null,
        svgLine: anchor.svgLine || '',
      };
      const s = JSON.stringify(norm);
      const h = createHash('sha1').update(s).digest('hex');
      anchor.anchorId = h; // 40-char sha1 hex
    } catch {
      // ignore id generation failures
    }

    return anchor;
  });

  return {
    anchors,
    viewBox: { minX: vbMinX, minY: vbMinY, width: vbWidth, height: vbHeight },
  };
}
