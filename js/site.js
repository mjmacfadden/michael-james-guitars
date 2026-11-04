// Shared site logic. Products come from data/products.json (single source of truth).
const MJG = {
  async load(){ const r = await fetch('data/products.json'); return r.json(); },
  money(p,c){ return p==null ? 'Price TBD' : new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD',minimumFractionDigits:0}).format(p)+' + shipping'; },
  esc(s){ return String(s).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); },
  // Buy button: Stripe Payment Link if set, otherwise a mailto fallback (never a broken link).
  buy(p,data){
    if(!p.inStock) return '<span class="btn disabled">Sold out</span>';
    if(p.stripeLink && /^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(p.stripeLink))
      return `<a class="btn" href="${MJG.esc(p.stripeLink)}">Buy now</a>`;
    const m = `mailto:${data.contactEmail}?subject=${encodeURIComponent('Order inquiry: '+p.name)}`;
    return `<a class="btn" href="${m}">Coming soon – email to order</a>`;
  },
  // images in products.json are base paths; files exist as <base>.jpg/.webp (1600px) and <base>-800.jpg/.webp
  pic(base,alt,size,attrs){ const b=MJG.esc(base),s=size||'-800'; return `<picture><source type="image/webp" srcset="${b}-800.webp 800w, ${b}.webp 1600w" sizes="${attrs&&attrs.includes('main')?'(max-width:720px) 100vw, 540px':'(max-width:600px) 100vw, 340px'}"><img src="${b}${s}.jpg" srcset="${b}-800.jpg 800w, ${b}.jpg 1600w" alt="${MJG.esc(alt||'')}" width="1200" height="1600" ${attrs||'loading="lazy"'}></picture>`; },
  card(p,data){ return `<div class="card"><a href="product.html?id=${encodeURIComponent(p.id)}">${MJG.pic(p.images[0],(p.imageAlts||[])[0]||p.name)}</a><div class="body"><h3><a href="product.html?id=${encodeURIComponent(p.id)}">${MJG.esc(p.name)}</a></h3><p>${MJG.esc(p.shortDescription)}</p><div class="price">${MJG.money(p.price,data.currency)}</div>${MJG.buy(p,data)}</div></div>`; }
};
document.addEventListener('DOMContentLoaded', async ()=>{
  const y=document.getElementById('year'); if(y) y.textContent=new Date().getFullYear();
  const grid=document.getElementById('product-grid'), detail=document.getElementById('product-detail');
  const mails=document.querySelectorAll('[data-mailto]');
  if(!grid && !detail && !mails.length) return;
  const data = await MJG.load();
  mails.forEach(a=>{a.href='mailto:'+data.contactEmail; if(!a.textContent.trim()) a.textContent=data.contactEmail;});
  if(grid){ const lim=+grid.dataset.limit||999; grid.innerHTML=data.products.slice(0,lim).map(p=>MJG.card(p,data)).join(''); }
  if(detail){
    const id=new URLSearchParams(location.search).get('id'); const p=data.products.find(x=>x.id===id);
    if(!p){ detail.innerHTML='<p>Product not found. <a href="shop.html">Back to shop</a></p>'; return; }
    document.title=p.name+' | Michael James Guitars';
    const specs=Object.entries(p.specs||{}).map(([k,v])=>`<tr><td><strong>${MJG.esc(k)}</strong></td><td>${MJG.esc(v)}</td></tr>`).join('');
    const alts=p.imageAlts||[];
    const video=p.video?`<figure><video controls muted playsinline preload="none" poster="${MJG.esc(p.video.poster)}" width="540" height="960"><source src="${MJG.esc(p.video.src)}" type="video/mp4"></video><figcaption>${MJG.esc(p.video.caption||'')}</figcaption></figure>`:'';
    detail.innerHTML=`<div class="product"><div><div id="main-img">${MJG.pic(p.images[0],alts[0]||p.name,'','id="main" fetchpriority="high"')}</div><div class="thumbs">${p.images.length>1?p.images.map((i,n)=>`<button type="button" data-n="${n}" aria-label="Show photo ${n+1}"><img src="${MJG.esc(i)}-800.jpg" alt="" width="70" height="93"></button>`).join(''):''}</div>${video}</div><div><h1>${MJG.esc(p.name)}</h1><p class="price">${MJG.money(p.price,data.currency)}</p><p>${MJG.esc(p.description)}</p>${MJG.buy(p,data)}<p><small>Checkout is handled securely by Stripe. Choose quantity and shipping at checkout.</small></p><h2>Specs</h2><table>${specs}</table><h2>Install notes</h2><p>${MJG.esc(p.installNotes)}</p></div></div>`;
    detail.querySelectorAll('.thumbs button').forEach(t=>t.onclick=()=>{const n=+t.dataset.n;document.getElementById('main-img').innerHTML=MJG.pic(p.images[n],alts[n]||p.name,'','id="main"');});
  }
});
