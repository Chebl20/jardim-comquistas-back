const fs=require('fs');
const svg=fs.readFileSync('src/assets/worlds/mundo2.svg','utf8');
const svgdom=require('svgdom');
console.log('svgdom exports:', Object.keys(svgdom).slice(0,30));
try{
  const doc1 = svgdom.createSVGDocument(svg);
  console.log('createSVGDocument OK. querySelectorAll?', typeof doc1.querySelectorAll);
  const nodes1 = (typeof doc1.querySelectorAll==='function')?doc1.querySelectorAll('[data-layer][data-slot]'):[];
  console.log('nodes1 len=', nodes1.length);
  if(nodes1.length>0) console.log('first1', nodes1[0].tagName, nodes1[0].getAttribute('data-layer'));
}catch(e){console.error('createSVGDocument error', e)}

const { DOMParser } = require('xmldom');
try{
  const doc2 = new DOMParser().parseFromString(svg, 'image/svg+xml');
  console.log('xmldom parse OK. getElementsByTagName?', typeof doc2.getElementsByTagName);
  const all = doc2.getElementsByTagName('*');
  let found=0;
  for(let i=0;i<all.length;i++){
    const el = all[i];
    if(el.getAttribute && el.getAttribute('data-layer') && el.getAttribute('data-slot')){
      found++;
      if(found<=5) console.log('xmldom found', el.tagName, el.getAttribute('data-layer'), el.getAttribute('data-slot'));
    }
  }
  console.log('xmldom found total=', found);
}catch(e){console.error('xmldom error', e)}
