// v7.07: pure page-local projection, no DOM, canvas, workspace or PDF.js access.
// Coordinates remain normalized [x,y,w,h]; PDF viewport sizes are CSS pixels.
const jfPdfProjection=(()=>{
  function markStyle(rect){
    return {left:rect[0]*100+'%',top:rect[1]*100+'%',width:rect[2]*100+'%',height:rect[3]*100+'%'};
  }
  function cropRects(area,segments,viewportWidth,viewportHeight){
    const [x,y]=area;
    return segments.map(strip=>({
      x:(strip[0]-x)*viewportWidth,y:(strip[1]-y)*viewportHeight,
      w:strip[2]*viewportWidth,h:strip[3]*viewportHeight
    }));
  }
  function zoomPosition(bounds,ratioY){return bounds.top+bounds.height*ratioY;}
  return Object.freeze({markStyle,cropRects,zoomPosition});
})();
