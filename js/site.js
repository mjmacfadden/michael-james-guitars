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
  card(p,data){ return `<div class="card"><a href="product.html?id=${encodeURIComponent(p.id)}"><img src="${MJG.esc(p.images[0])}" alt="${MJG.esc(p.name)}" loading="lazy" width="800" height="600"></a><div class="body"><h3><a href="product.html?id=${encodeURIComponent(p.id)}">${MJG.esc(p.name)}</a></h3><p>${MJG.esc(p.shortDescription)}</p><div class="price">${MJG.money(p.price,data.currency)}</div>${MJG.buy(p,data)}</div></div>`; }
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
    detail.innerHTML=`<div class="product"><div><img id="main-img" src="${MJG.esc(p.images[0])}" alt="${MJG.esc(p.name)}" width="800" height="600"><div class="thumbs">${p.images.length>1?p.images.map(i=>`<img src="${MJG.esc(i)}" alt="" data-src="${MJG.esc(i)}">`).join(''):''}</div></div><div><h1>${MJG.esc(p.name)}</h1><p class="price">${MJG.money(p.price,data.currency)}</p><p>${MJG.esc(p.description)}</p>${MJG.buy(p,data)}<p><small>Checkout is handled securely by Stripe. You can adjust quantity at checkout.</small></p><h2>Specs</h2><table>${specs}</table><h2>Install notes</h2><p>${MJG.esc(p.installNotes)}</p></div></div>`;
    detail.querySelectorAll('.thumbs img').forEach(t=>t.onclick=()=>document.getElementById('main-img').src=t.dataset.src);
  }
});
