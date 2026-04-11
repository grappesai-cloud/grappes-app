// ─── Reactbits-inspired Effects — Vanilla JS Runtime ─────────────────────────
// All effects are self-contained IIFEs injected into generated pages.
// GSAP is already loaded globally — effects use it freely.
// Auto-injected only when Sonnet uses the corresponding window.__X() call.

// ─── 1. TextType ──────────────────────────────────────────────────────────────
// Typing/deleting animation that cycles through an array of texts.
// Usage: window.__textType(el, { texts, speed, deleteSpeed, pauseMs, cursor })

export const TEXT_TYPE_JS = `(function(){
window.__textType=function(el,opts){
  var texts=opts.texts||(el.textContent?[el.textContent]:['Hello']);
  var speed=opts.speed||70;
  var del=opts.deleteSpeed||40;
  var pause=opts.pauseMs||1800;
  var showCursor=opts.cursor!==false;
  var colors=opts.colors||[];
  var idx=0,ch=0,deleting=false,running=false;

  if(!document.getElementById('__tt_style')){
    var s=document.createElement('style');
    s.id='__tt_style';
    s.textContent='.__tt_cursor{display:inline-block;margin-left:1px;animation:__tt_blink 0.65s step-end infinite}@keyframes __tt_blink{0%,100%{opacity:1}50%{opacity:0}}';
    document.head.appendChild(s);
  }

  var cursor=null;
  if(showCursor){
    cursor=document.createElement('span');
    cursor.className='__tt_cursor';
    cursor.textContent=opts.cursorChar||'|';
    el.after(cursor);
    if(colors[0]) cursor.style.color=colors[0];
  }

  function tick(){
    var t=texts[idx%texts.length];
    if(colors.length) el.style.color=colors[idx%colors.length];
    if(deleting){
      ch--;
      el.textContent=t.slice(0,ch);
      if(ch===0){deleting=false;idx++;setTimeout(tick,350);return;}
      setTimeout(tick,del);
    } else {
      ch++;
      el.textContent=t.slice(0,ch);
      if(ch===t.length){
        setTimeout(function(){deleting=true;setTimeout(tick,del);},pause);
        return;
      }
      var jitter=opts.variableSpeed?Math.random()*40-20:0;
      setTimeout(tick,speed+jitter);
    }
  }

  el.textContent='';
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(e){
      if(e[0].isIntersecting&&!running){running=true;io.disconnect();tick();}
    },{threshold:0.3});
    io.observe(el);
  } else { tick(); }
};
})();`;

// ─── 2. TextPressure ──────────────────────────────────────────────────────────
// Each character responds to mouse proximity with font-variation-settings.
// Works best with variable fonts (wght axis). Falls back gracefully with normal fonts.
// Usage: window.__textPressure(el, { minWeight, maxWeight, radius, italic, width })

export const TEXT_PRESSURE_JS = `(function(){
window.__textPressure=function(el,opts){
  var minW=opts.minWeight||100;
  var maxW=opts.maxWeight||900;
  var minWd=opts.minWidth||50;
  var maxWd=opts.maxWidth||200;
  var useItalic=opts.italic||false;
  var radius=opts.radius||400;
  var text=opts.text||el.textContent||'';
  el.textContent='';
  el.style.display='flex';
  el.style.justifyContent='space-between';
  el.style.userSelect='none';
  el.style.whiteSpace='nowrap';

  var spans=text.split('').map(function(c){
    var s=document.createElement('span');
    s.textContent=c==' '?'\u00A0':c;
    s.style.display='inline-block';
    s.style.transition='font-variation-settings 0.1s ease';
    el.appendChild(s);
    return s;
  });

  var mouse={x:-9999,y:-9999};
  window.addEventListener('mousemove',function(e){mouse.x=e.clientX;mouse.y=e.clientY;});
  window.addEventListener('touchmove',function(e){
    mouse.x=e.touches[0].clientX;mouse.y=e.touches[0].clientY;
  },{passive:true});

  function dist(a,b){return Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2);}
  function lerp(a,b,t){return a+(b-a)*Math.min(1,Math.max(0,t));}
  function getVal(d,minV,maxV){var t=1-Math.min(1,d/radius);return Math.round(lerp(minV,maxV,t));}

  function frame(){
    spans.forEach(function(s){
      var r=s.getBoundingClientRect();
      var center={x:r.left+r.width/2,y:r.top+r.height/2};
      var d=dist(mouse,center);
      var wght=getVal(d,minW,maxW);
      var wdth=getVal(d,minWd,maxWd);
      var fvs="'wght' "+wght+(useItalic?", 'ital' "+getVal(d,0,1):'');
      if(maxWd!==100) fvs+=",'wdth' "+wdth;
      s.style.fontVariationSettings=fvs;
    });
    requestAnimationFrame(frame);
  }
  frame();
};
})();`;

// ─── 3. VariableProximity ─────────────────────────────────────────────────────
// Characters interpolate between two font-variation-settings states based on mouse distance.
// Usage: window.__variableProximity(el, { fromSettings, toSettings, radius, falloff })

export const VARIABLE_PROXIMITY_JS = `(function(){
window.__variableProximity=function(el,opts){
  var from=opts.fromSettings||"'wght' 100";
  var to=opts.toSettings||"'wght' 900";
  var radius=opts.radius||200;
  var falloff=opts.falloff||'linear'; // linear | exponential | gaussian
  var text=opts.text||el.textContent||'';

  function parseSettings(s){
    var map={};
    s.split(',').forEach(function(p){
      var m=p.trim().match(/'([^']+)'\s+([0-9.]+)/);
      if(m) map[m[1]]=parseFloat(m[2]);
    });
    return map;
  }
  function buildSettings(map){
    return Object.entries(map).map(function(e){return "'"+e[0]+"' "+e[1].toFixed(2);}).join(', ');
  }
  function lerp(a,b,t){return a+(b-a)*t;}

  var fromMap=parseSettings(from);
  var toMap=parseSettings(to);

  el.setAttribute('aria-label',text);
  el.textContent='';
  var spans=text.split('').map(function(c){
    var s=document.createElement('span');
    s.textContent=c===' '?'\u00A0':c;
    s.setAttribute('aria-hidden','true');
    s.style.display='inline-block';
    el.appendChild(s);
    return s;
  });

  var mouse={x:-9999,y:-9999};
  var container=el.getBoundingClientRect();
  el.addEventListener('mousemove',function(e){
    var r=el.getBoundingClientRect();
    mouse.x=e.clientX-r.left;
    mouse.y=e.clientY-r.top;
  });
  el.addEventListener('mouseleave',function(){mouse.x=-9999;mouse.y=-9999;});

  function getFalloff(d){
    var norm=Math.max(0,1-d/radius);
    if(falloff==='exponential') return norm*norm;
    if(falloff==='gaussian') return Math.exp(-(d*d)/(2*(radius/2)*(radius/2)));
    return norm; // linear
  }

  function frame(){
    spans.forEach(function(s){
      var r=s.getBoundingClientRect();
      var elR=el.getBoundingClientRect();
      var cx=r.left-elR.left+r.width/2;
      var cy=r.top-elR.top+r.height/2;
      var d=Math.sqrt((mouse.x-cx)**2+(mouse.y-cy)**2);
      var t=getFalloff(d);
      var result={};
      Object.keys(fromMap).forEach(function(k){
        result[k]=lerp(fromMap[k],toMap[k]||fromMap[k],t);
      });
      s.style.fontVariationSettings=buildSettings(result);
    });
    requestAnimationFrame(frame);
  }
  frame();
};
})();`;

// ─── 4. CurvedLoop ────────────────────────────────────────────────────────────
// Text follows a quadratic Bézier SVG curve, loops infinitely. Interactive drag.
// Usage: window.__curvedLoop(el, { text, speed, curveAmount, direction, interactive })

export const CURVED_LOOP_JS = `(function(){
window.__curvedLoop=function(el,opts){
  var text=(opts.text||el.textContent||'Marquee Text').trim();
  var speed=opts.speed||2;
  var curve=opts.curveAmount||80;
  var dir=opts.direction==='right'?1:-1;
  var interactive=opts.interactive!==false;

  var W=el.offsetWidth||800;
  var H=Math.abs(curve)+60;
  el.style.overflow='visible';
  el.innerHTML='';

  var uid='cl'+Math.random().toString(36).slice(2,7);
  var mid=H/2;
  var pathD='M 0 '+mid+' Q '+(W/2)+' '+(mid-curve)+' '+W+' '+mid;

  // Measure text width
  var probe=document.createElementNS('http://www.w3.org/2000/svg','svg');
  probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  var pt=document.createElementNS('http://www.w3.org/2000/svg','text');
  var cs=getComputedStyle(el);
  pt.style.font=cs.font;
  pt.textContent=text+'\u2003';
  probe.appendChild(pt);
  var unit=pt.getComputedTextLength()||120;
  document.body.removeChild(probe);

  var repeats=Math.ceil((W*2.5)/unit)+2;
  var full=Array(repeats).fill(text+'\u2003').join('');

  var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width','100%');
  svg.setAttribute('height',H);
  svg.style.overflow='visible';

  svg.innerHTML='<defs><path id="'+uid+'" d="'+pathD+'" fill="none"/></defs>'+
    '<text style="font:'+cs.font+';fill:currentColor">'+
    '<textPath id="'+uid+'tp" href="#'+uid+'">'+full+'</textPath></text>';

  el.appendChild(svg);
  var tp=svg.getElementById(uid+'tp');

  var offset=0,dragging=false,lastX=0,vel=0;

  function frame(){
    if(!dragging) offset+=speed*dir;
    if(offset>unit) offset-=unit;
    if(offset<-unit) offset+=unit;
    tp.setAttribute('startOffset',offset+'px');
    requestAnimationFrame(frame);
  }

  if(interactive){
    svg.style.cursor='grab';
    svg.addEventListener('pointerdown',function(e){
      dragging=true;lastX=e.clientX;vel=0;
      svg.style.cursor='grabbing';svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove',function(e){
      if(!dragging) return;
      vel=e.clientX-lastX;offset+=vel;lastX=e.clientX;
    });
    svg.addEventListener('pointerup',function(){
      dragging=false;svg.style.cursor='grab';
      if(Math.abs(vel)>1) dir=vel>0?1:-1;
    });
  }

  frame();

  // Recalc on resize
  if(typeof ResizeObserver!=='undefined'){
    new ResizeObserver(function(){
      W=el.offsetWidth||W;
      var newD='M 0 '+mid+' Q '+(W/2)+' '+(mid-curve)+' '+W+' '+mid;
      svg.querySelector('path').setAttribute('d',newD);
    }).observe(el);
  }
};
})();`;

// ─── 5. ScrollStack ───────────────────────────────────────────────────────────
// Cards stack on top of each other as user scrolls, with scale/rotate/blur.
// Hooks into window.__lenis (already loaded globally).
// Usage: window.__scrollStack(container, { cardSelector, scaleStep, rotateStep, blurStep })

export const SCROLL_STACK_JS = `(function(){
window.__scrollStack=function(container,opts){
  var sel=opts.cardSelector||'.stack-card';
  var scaleStep=opts.scaleStep||0.06;
  var rotateStep=opts.rotateStep||2;
  var blurStep=opts.blurStep||0.5;
  var sticky=opts.stickyOffset||80;

  var cards=[].slice.call(container.querySelectorAll(sel));
  if(!cards.length) return;

  cards.forEach(function(c,i){
    c.style.cssText+='position:sticky;top:'+sticky+'px;z-index:'+(10+i)+
      ';will-change:transform;backface-visibility:hidden;transform-origin:center top;';
  });

  var total=cards.length;

  function getProgress(){
    var r=container.getBoundingClientRect();
    var scrolled=Math.max(0,-r.top);
    var full=r.height-window.innerHeight;
    return full>0?Math.min(1,scrolled/full):0;
  }

  function update(){
    var p=getProgress();
    var step=1/total;
    cards.forEach(function(c,i){
      var cardProgress=Math.max(0,Math.min(1,(p-i*step)/step));
      var nextProgress=Math.max(0,Math.min(1,(p-(i)*step)/step));
      var scale=1-(total-1-i)*scaleStep*nextProgress;
      var rotate=(total-1-i)*rotateStep*nextProgress*(i%2===0?1:-1);
      var blur=(total-1-i)*blurStep*nextProgress;
      var ty=i<total-1?-cardProgress*20:0;
      c.style.transform='translate3d(0,'+ty+'px,0) scale('+scale+') rotate('+rotate+'deg)';
      c.style.filter=blur>0?'blur('+blur+'px)':'none';
      c.style.opacity=scale<0.7?'0':'1';
    });
  }

  window.addEventListener('scroll',update,{passive:true});
  if(window.__lenis) window.__lenis.on('scroll',update);
  update();
};
})();`;

// ─── 6. PillNav ───────────────────────────────────────────────────────────────
// Animated navigation with a morphing pill indicator that follows active link.
// Sonnet generates: <nav data-pill-nav> with <a> links inside.
// Usage: window.__pillNav(navEl, { pillColor, pillTextColor, ease })

export const PILL_NAV_JS = `(function(){
window.__pillNav=function(nav,opts){
  if(!nav||!window.gsap) return;
  var pillColor=opts&&opts.pillColor||'var(--color-primary)';
  var pillTextColor=opts&&opts.pillTextColor||'#fff';
  var ease=opts&&opts.ease||'power2.inOut';

  var links=[].slice.call(nav.querySelectorAll('a[href]'));
  if(!links.length) return;

  // Create pill
  var pill=document.createElement('span');
  pill.style.cssText='position:absolute;border-radius:999px;background:'+pillColor+
    ';z-index:0;pointer-events:none;transition:none;';
  nav.style.position='relative';
  nav.insertBefore(pill,nav.firstChild);

  links.forEach(function(a){
    a.style.position='relative';
    a.style.zIndex='1';
    a.style.transition='color 0.3s';
  });

  // Find current active link (hash or first)
  function getActive(){
    var hash=location.hash;
    return links.find(function(a){return a.getAttribute('href')===hash;})||links[0];
  }

  function movePill(target,animate){
    var tr=target.getBoundingClientRect();
    var nr=nav.getBoundingClientRect();
    var x=tr.left-nr.left;
    var y=tr.top-nr.top;
    links.forEach(function(a){a.style.color='';});
    target.style.color=pillTextColor;
    if(animate){
      gsap.to(pill,{x:x,y:y,width:tr.width,height:tr.height,duration:0.4,ease:ease});
    } else {
      gsap.set(pill,{x:x,y:y,width:tr.width,height:tr.height});
    }
  }

  // Initial position
  movePill(getActive(),false);

  links.forEach(function(a){
    a.addEventListener('mouseenter',function(){movePill(a,true);});
  });
  nav.addEventListener('mouseleave',function(){movePill(getActive(),true);});

  window.addEventListener('hashchange',function(){movePill(getActive(),true);});
  window.addEventListener('resize',function(){movePill(getActive(),false);});
};
})();`;

// ─── 7. FlowingMenu ───────────────────────────────────────────────────────────
// Full-screen menu where each item has a marquee text that flows on hover.
// Sonnet generates: <ul data-flowing-menu> with <li data-label="Text"><a>Text</a></li>
// Usage: window.__flowingMenu(ul, { speed, textColor, bgColor, marqueeBg })

export const FLOWING_MENU_JS = `(function(){
window.__flowingMenu=function(ul,opts){
  if(!ul||!window.gsap) return;
  var speed=opts&&opts.speed||1;
  var marqueeBg=opts&&opts.marqueeBg||'var(--color-primary)';
  var marqueeText=opts&&opts.marqueeColor||'#fff';
  var itemH=opts&&opts.itemHeight||'20vh';

  var items=[].slice.call(ul.querySelectorAll('li'));
  ul.style.cssText+='list-style:none;padding:0;margin:0;';

  items.forEach(function(li){
    var label=li.dataset.label||li.querySelector('a').textContent||'Item';
    li.style.cssText='position:relative;overflow:hidden;cursor:pointer;border-bottom:1px solid var(--color-border,rgba(0,0,0,0.08));';
    var link=li.querySelector('a');
    if(link){
      link.style.cssText='display:flex;align-items:center;height:'+itemH+
        ';padding:0 4rem;font-size:clamp(1.8rem,4vw,3.5rem);font-weight:700;'+
        'letter-spacing:-0.03em;position:relative;z-index:1;text-decoration:none;color:inherit;';
    }

    // Marquee overlay
    var marquee=document.createElement('div');
    marquee.style.cssText='position:absolute;inset:0;display:flex;align-items:center;'+
      'background:'+marqueeBg+';color:'+marqueeText+';overflow:hidden;'+
      'translate:0 101%;z-index:2;pointer-events:none;';

    var repeats=8;
    var inner=document.createElement('div');
    inner.style.cssText='display:flex;gap:3rem;white-space:nowrap;flex-shrink:0;';
    inner.textContent=Array(repeats).fill(label+' — ').join('');
    inner.style.fontSize='clamp(1.8rem,4vw,3.5rem)';
    inner.style.fontWeight='700';
    inner.style.letterSpacing='-0.03em';

    var inner2=inner.cloneNode(true);
    marquee.appendChild(inner);
    marquee.appendChild(inner2);
    li.appendChild(marquee);

    // GSAP marquee animation
    var mq=null;
    function startMarquee(){
      if(mq) return;
      var w=inner.offsetWidth+48;
      mq=gsap.to([inner,inner2],{x:'-='+w,duration:w/(120*speed),ease:'none',repeat:-1,modifiers:{x:gsap.utils.unitize(function(x){return parseFloat(x)%w;})}});
    }

    // Detect enter from top or bottom
    function getDir(e){
      var r=li.getBoundingClientRect();
      return e.clientY<(r.top+r.height/2)?-1:1;
    }

    var tl=gsap.timeline({paused:true});
    tl.to(marquee,{yPercent:0,duration:0.4,ease:'power3.out'});

    li.addEventListener('mouseenter',function(e){
      var d=getDir(e);
      gsap.set(marquee,{yPercent:d*101});
      tl.restart();
      startMarquee();
    });
    li.addEventListener('mouseleave',function(e){
      var d=getDir(e);
      gsap.to(marquee,{yPercent:d*101,duration:0.4,ease:'power3.in'});
      if(mq){mq.kill();mq=null;gsap.set([inner,inner2],{x:0});}
    });
  });
};
})();`;

// ─── Video Embed ──────────────────────────────────────────────────────────────
// Handles YouTube links and direct video files.
// Facade pattern: loads nothing until play/scroll. IntersectionObserver for autoplay.
// Usage: window.__videoEmbed(el, { url, mode: 'autoplay'|'click', muted: true, poster: '' })

export const VIDEO_EMBED_JS = `(function(){
window.__videoEmbed=function(el,opts){
  var url=opts.url||'';
  var mode=opts.mode||'click';
  var muted=opts.muted!==false;
  var ytMatch=url.match(/(?:youtube\\.com\\/(?:watch\\?v=|embed\\/)|youtu\\.be\\/)([a-zA-Z0-9_-]{11})/);
  if(ytMatch){
    var id=ytMatch[1];
    var thumb='https://img.youtube.com/vi/'+id+'/hqdefault.jpg';
    el.style.cssText+='position:relative;overflow:hidden;cursor:pointer;background:#000;';
    var img=document.createElement('img');
    img.src=thumb;img.loading='lazy';
    img.style.cssText='width:100%;height:100%;object-fit:cover;display:block;transition:opacity .3s';
    el.appendChild(img);
    var btn=document.createElement('div');
    btn.innerHTML='<svg viewBox="0 0 68 48" width="68" height="48" style="filter:drop-shadow(0 2px 8px rgba(0,0,0,.5))"><path fill="#fff" fill-opacity=".9" d="M66.52 7.74A8.56 8.56 0 0 0 60.7 1.9C55.4 0 34 0 34 0S12.6 0 7.3 1.9A8.56 8.56 0 0 0 1.48 7.74C0 13.06 0 24 0 24s0 10.94 1.48 16.26a8.56 8.56 0 0 0 5.82 5.84C12.6 48 34 48 34 48s21.4 0 26.7-1.9a8.56 8.56 0 0 0 5.82-5.84C68 34.94 68 24 68 24s0-10.94-1.48-16.26z"/><path fill="#f00" d="M66.52 7.74A8.56 8.56 0 0 0 60.7 1.9C55.4 0 34 0 34 0S12.6 0 7.3 1.9A8.56 8.56 0 0 0 1.48 7.74C0 13.06 0 24 0 24s0 10.94 1.48 16.26a8.56 8.56 0 0 0 5.82 5.84C12.6 48 34 48 34 48s21.4 0 26.7-1.9a8.56 8.56 0 0 0 5.82-5.84C68 34.94 68 24 68 24s0-10.94-1.48-16.26z" opacity="0"/><path fill="#f00" d="M27 34.5l18-10.5-18-10.5z"/></svg>';
    btn.style.cssText='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;transition:transform .2s';
    el.appendChild(btn);
    el.addEventListener('mouseenter',function(){btn.style.transform='translate(-50%,-50%) scale(1.12)';img.style.opacity='.8';});
    el.addEventListener('mouseleave',function(){btn.style.transform='translate(-50%,-50%) scale(1)';img.style.opacity='1';});
    function loadIframe(){
      var src='https://www.youtube.com/embed/'+id+'?autoplay=1&mute='+(muted?'1':'0')+'&rel=0&playsinline=1';
      var iframe=document.createElement('iframe');
      iframe.src=src;iframe.allow='autoplay;fullscreen;picture-in-picture';iframe.allowFullscreen=true;
      iframe.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;border:none';
      el.innerHTML='';el.appendChild(iframe);
    }
    if(mode==='autoplay'){
      var io=new IntersectionObserver(function(e){if(e[0].isIntersecting){io.disconnect();loadIframe();}},{threshold:0.5});
      io.observe(el);
    } else {
      el.addEventListener('click',loadIframe);
    }
  } else if(url){
    var video=document.createElement('video');
    video.src=url;video.style.cssText='width:100%;height:100%;object-fit:cover;display:block';
    video.playsInline=true;video.muted=muted;video.preload='none';
    if(opts.poster)video.poster=opts.poster;
    if(mode==='autoplay'){
      var io2=new IntersectionObserver(function(e){if(e[0].isIntersecting)video.play().catch(function(){});else video.pause();},{threshold:0.5});
      io2.observe(video);
    } else {
      video.controls=true;
    }
    el.appendChild(video);
  }
};
})();`;

// ─── Combined runtime (all effects bundled) ──────────────────────────────────

export const ALL_EFFECTS_JS =
  TEXT_TYPE_JS + '\n' +
  TEXT_PRESSURE_JS + '\n' +
  VARIABLE_PROXIMITY_JS + '\n' +
  CURVED_LOOP_JS + '\n' +
  SCROLL_STACK_JS + '\n' +
  PILL_NAV_JS + '\n' +
  FLOWING_MENU_JS;

// ─── Per-effect runtime map (inject only what's used) ────────────────────────

export const EFFECT_RUNTIMES: Record<string, string> = {
  __textType:          TEXT_TYPE_JS,
  __textPressure:      TEXT_PRESSURE_JS,
  __variableProximity: VARIABLE_PROXIMITY_JS,
  __curvedLoop:        CURVED_LOOP_JS,
  __scrollStack:       SCROLL_STACK_JS,
  __pillNav:           PILL_NAV_JS,
  __flowingMenu:       FLOWING_MENU_JS,
  __videoEmbed:        VIDEO_EMBED_JS,
};

// ─── Variable font list (Google Fonts with wght/wdth axes) ───────────────────
// TextPressure and VariableProximity work best with these fonts.

export const VARIABLE_FONTS = new Set([
  'Inter', 'Roboto Flex', 'Montserrat', 'Raleway', 'Oswald', 'Nunito',
  'Source Sans Pro', 'Open Sans', 'Lato', 'Playfair Display', 'DM Sans',
  'Outfit', 'Plus Jakarta Sans', 'Syne', 'Bricolage Grotesque',
  'Cabinet Grotesk', 'Satoshi', 'General Sans',
]);

// ─── Sonnet documentation (injected per-effect when enabled) ─────────────────

export const EFFECTS_DOCS: Record<string, string> = {
  textType: `
EFFECT: window.__textType(el, opts)
  Types and deletes text in a loop. Use on headlines, hero subtitles, or taglines.
  opts: { texts: string[], speed: 70, deleteSpeed: 40, pauseMs: 1800, cursor: true, cursorChar: '|', colors: [], variableSpeed: false }
  Example: window.__textType(document.querySelector('[data-section="hero"] h1'), { texts: ['We build brands.','We craft experiences.','We ship fast.'] });`,

  textPressure: `
EFFECT: window.__textPressure(el, opts)
  Each character responds to mouse proximity by changing font weight/width. Requires a variable font.
  opts: { text: string, minWeight: 100, maxWeight: 900, radius: 400, italic: false }
  Example: window.__textPressure(document.querySelector('[data-section="hero"] h1'), { text: 'HOVER ME', minWeight: 100, maxWeight: 900, radius: 350 });
  NOTE: The element will be replaced with individual <span>s — set a fixed font-size on the parent first.`,

  variableProximity: `
EFFECT: window.__variableProximity(el, opts)
  Characters interpolate between two font-variation-settings states based on mouse distance.
  opts: { text: string, fromSettings: string, toSettings: string, radius: 200, falloff: 'linear'|'exponential'|'gaussian' }
  Example: window.__variableProximity(document.querySelector('[data-section="hero"] h2'), { text: 'Proximity', fromSettings: "'wght' 100", toSettings: "'wght' 900", radius: 250, falloff: 'gaussian' });`,

  curvedLoop: `
EFFECT: window.__curvedLoop(el, opts)
  Text follows a quadratic Bézier curve and loops as a marquee. Interactive drag supported.
  opts: { text: string, speed: 2, curveAmount: 80, direction: 'left'|'right', interactive: true }
  The container element must have a defined width and height. Positive curveAmount = curves up, negative = curves down.
  Example: window.__curvedLoop(document.querySelector('.curved-marquee'), { text: 'Creative Agency — Award Winning — ', speed: 1.5, curveAmount: 60 });`,

  scrollStack: `
EFFECT: window.__scrollStack(container, opts)
  Cards stack as user scrolls through the container. Container must be tall (e.g. height: 300vh).
  opts: { cardSelector: '.stack-card', scaleStep: 0.06, rotateStep: 2, blurStep: 0.5, stickyOffset: 80 }
  HTML structure: <div style="height:300vh"> <div class="stack-card">...</div> <div class="stack-card">...</div> </div>
  Example: window.__scrollStack(document.querySelector('.scroll-stack-container'), { cardSelector: '.stack-card', scaleStep: 0.05 });`,

  pillNav: `
EFFECT: window.__pillNav(navEl, opts)
  Animated pill indicator that slides between nav links on hover. Use on the <nav> element.
  opts: { pillColor: 'var(--color-primary)', pillTextColor: '#fff', ease: 'power2.inOut' }
  Requires GSAP (already loaded). Nav must use <a href="#section"> anchor links.
  Example: window.__pillNav(document.querySelector('[data-section="nav"] nav'), { pillColor: 'var(--color-primary)', pillTextColor: '#fff' });`,

  flowingMenu: `
EFFECT: window.__flowingMenu(ul, opts)
  Full-width menu items with a marquee overlay that slides in on hover. Use for hero navigation or large menus.
  opts: { speed: 1, marqueeBg: 'var(--color-primary)', marqueeColor: '#fff', itemHeight: '20vh' }
  HTML structure: <ul data-flowing-menu> <li data-label="Services"><a href="#services">Services</a></li> ... </ul>
  Example: window.__flowingMenu(document.querySelector('[data-flowing-menu]'), { speed: 1.2, marqueeBg: 'var(--color-primary)' });`,

  videoEmbed: `
EFFECT: window.__videoEmbed(el, opts)
  Embeds a YouTube video or direct video file with a performance-first facade (loads nothing until play).
  opts: { url: string, mode: 'autoplay'|'click', muted: true, poster: '' }
  - url: YouTube URL (any format) or direct video file URL
  - mode 'autoplay': video starts automatically when 50% visible in viewport (always muted for browser compatibility)
  - mode 'click': shows thumbnail + play button, loads video on click
  - The container element must have explicit width and height (e.g. width:100%; height:400px or aspect-ratio:16/9)
  Example (YouTube, click-to-play):
    window.__videoEmbed(document.querySelector('.video-container'), { url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'click' });
  Example (YouTube, autoplay on scroll):
    window.__videoEmbed(document.querySelector('.video-container'), { url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'autoplay' });
  Example (direct video, click-to-play):
    window.__videoEmbed(document.querySelector('.video-container'), { url: 'https://example.com/video.mp4', mode: 'click', poster: 'https://example.com/poster.jpg' });`,
};
