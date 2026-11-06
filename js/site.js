// Shared site logic. Products come from data/products.json (single source of truth).
const MJG = {
  async load(){ const r = await fetch('data/products.json'); return r.json(); },
  money(p,c){ return p==null ? 'Price TBD' : new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD',minimumFractionDigits:0}).format(p)+' + shipping'; },
  esc(s){ return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); },
  buy(p,data){
    if(!p.inStock) return '<span class="btn disabled">Sold out</span>';
    if(p.stripeLink && /^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(p.stripeLink))
      return `<a class="btn" href="${MJG.esc(p.stripeLink)}">Buy now</a>`;
    const m = `mailto:${data.contactEmail}?subject=${encodeURIComponent('Order inquiry: '+p.name)}`;
    return `<a class="btn" href="${m}">Coming soon – email to order</a>`;
  },
  pic(base,alt,size,attrs){ const b=MJG.esc(base),s=size||'-800'; return `<picture><source type="image/webp" srcset="${b}-800.webp 800w, ${b}.webp 1600w" sizes="${attrs&&attrs.includes('main')?'(max-width:720px) 100vw, 540px':'(max-width:600px) 100vw, 340px'}"><img src="${b}${s}.jpg" srcset="${b}-800.jpg 800w, ${b}.jpg 1600w" alt="${MJG.esc(alt||'')}" width="1200" height="1600" ${attrs||'loading="lazy"'}></picture>`; },
  card(p,data){ return `<div class="card"><a href="product.html?id=${encodeURIComponent(p.id)}">${MJG.pic(p.images[0],(p.imageAlts||[])[0]||p.name)}</a><div class="body"><h3><a href="product.html?id=${encodeURIComponent(p.id)}">${MJG.esc(p.name)}</a></h3><p>${MJG.esc(p.shortDescription)}</p><div class="price">${MJG.money(p.price,data.currency)}</div>${MJG.buy(p,data)}</div></div>`; }
};

const Cart = {
  key:'mjg-cart',
  read(){ try{return JSON.parse(localStorage.getItem(this.key)||'[]');}catch(e){return [];} },
  write(items){ localStorage.setItem(this.key, JSON.stringify(items)); this.render(); },
  add(item){
    const items=this.read();
    // Quantity-only product: merge by product id (ignore legacy strings field if present).
    const i=items.findIndex(x=>x.id===item.id);
    if(i>=0) items[i].qty += item.qty; else items.push(item);
    this.write(items);
    this.open();
  },
  setQty(idx,qty){
    const items=this.read();
    qty=Math.max(1, Math.min(20, +qty||1));
    items[idx].qty=qty;
    this.write(items);
  },
  remove(idx){ const items=this.read(); items.splice(idx,1); this.write(items); },
  count(){ return this.read().reduce((n,x)=>n+x.qty,0); },
  subtotal(){ return this.read().reduce((n,x)=>n+x.price*x.qty,0); },
  open(){
    const d=document.getElementById('cart-drawer');
    if(!d)return;
    d.hidden=false;
    requestAnimationFrame(()=>d.classList.add('is-open'));
  },
  close(){
    const d=document.getElementById('cart-drawer');
    if(!d)return;
    d.classList.remove('is-open');
    setTimeout(()=>{d.hidden=true;},280);
  },
  render(){
    const n=this.count();
    document.querySelectorAll('.cart-count').forEach(el=>{el.dataset.n=String(n); el.textContent=n?String(n):'';});
    const box=document.getElementById('cart-items');
    const sub=document.getElementById('cart-subtotal');
    const checkout=document.getElementById('cart-checkout');
    if(!box)return;
    const items=this.read();
    if(checkout){ checkout.disabled=!items.length; checkout.classList.toggle('disabled', !items.length); }
    if(!items.length){
      box.innerHTML='<p class="cart-empty">Your cart is empty.</p>';
      if(sub) sub.textContent='$0';
      return;
    }
    box.innerHTML=items.map((it,idx)=>`
      <div class="cart-item">
        <img src="${MJG.esc(it.image)}" alt="">
        <div>
          <h3>${MJG.esc(it.name)}</h3>
          <div class="meta">$${it.price} each</div>
          <label class="meta">Qty <input type="number" min="1" max="20" value="${it.qty}" data-qty="${idx}"></label>
          <button type="button" class="cart-remove" data-remove="${idx}">Remove</button>
        </div>
        <div><strong>$${it.price*it.qty}</strong></div>
      </div>`).join('');
    if(sub) sub.textContent='$'+this.subtotal();
    box.querySelectorAll('[data-qty]').forEach(inp=>inp.onchange=()=>this.setQty(+inp.dataset.qty, inp.value));
    box.querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=()=>this.remove(+btn.dataset.remove));
  },
  checkout(data){
    const items=this.read();
    if(!items.length) return;
    // Legacy Payment Links: stripeLinks is a flat qty -> URL map (one SKU, quantity only).
    if(items.length===1){
      const it=items[0];
      const prod=(data.products||[]).find(p=>p.id===it.id);
      const entry=prod && prod.stripeLinks;
      let url='';
      if(typeof entry==='string') url=entry;
      else if(entry && typeof entry==='object'){
        const vals=Object.values(entry);
        const nested=vals.length && vals.every(v=>v && typeof v==='object');
        if(nested){
          // Legacy nested map (variant -> qty -> URL); prefer defaultVariantId, else first key.
          const vid=String(prod.defaultVariantId||Object.keys(entry)[0]||'');
          const map=entry[vid]||entry[Object.keys(entry)[0]];
          const q=parseInt(it.qty,10)||1;
          url=(map && (map[String(q)]||(q>10?map['10']:map['1'])))||'';
        } else {
          const q=parseInt(it.qty,10)||1;
          if(entry[String(q)]) url=entry[String(q)];
          else if(q>10) url=entry['10']; // adjustable qty on Stripe goes up to 20
          else url=entry['1']||'';
        }
      }
      if(!url && prod && prod.stripeLink) url=prod.stripeLink;
      // Stripe Payment Links ignore ?quantity=, so each qty has its own link
      if(url && /^https:\/\//.test(url)){
        location.href=url;
        return;
      }
    }
    const email=data.contactEmail||'';
    const body=items.map(it=>`- ${it.name} x${it.qty} = $${it.price*it.qty}`).join('\n')
      + `\n\nSubtotal: $${this.subtotal()} + shipping`;
    location.href=`mailto:${email}?subject=${encodeURIComponent('Order: piezo bridge pickup')}&body=${encodeURIComponent(body)}`;
  }
};


/** Product buy-box qty: full-width stepper, always-visible ▲/▼, clamp 1..10. */
function wireBuyQtyStepper(formEl){
  const inp=formEl.querySelector('input[name="qty"]');
  if(!inp) return;
  const min=Math.max(1, parseInt(inp.min,10)||1);
  const max=Math.max(min, parseInt(inp.max,10)||10);
  const up=formEl.querySelector('[data-qty-step="1"]');
  const down=formEl.querySelector('[data-qty-step="-1"]');
  const sync=()=>{
    let v=parseInt(inp.value,10);
    if(!Number.isFinite(v)) v=min;
    v=Math.max(min, Math.min(max, v));
    inp.value=String(v);
    inp.setAttribute('aria-valuenow', String(v));
    if(up) up.disabled = v>=max;
    if(down) down.disabled = v<=min;
  };
  const step=(delta)=>{
    const cur=parseInt(inp.value,10);
    const base=Number.isFinite(cur)?cur:min;
    const next=Math.max(min, Math.min(max, base+delta));
    inp.value=String(next);
    sync();
  };
  if(up) up.addEventListener('click',(e)=>{ if(up.disabled){ e.preventDefault(); return; } step(1); });
  if(down) down.addEventListener('click',(e)=>{ if(down.disabled){ e.preventDefault(); return; } step(-1); });
  inp.addEventListener('input', sync);
  inp.addEventListener('change', sync);
  sync();
}

document.addEventListener('DOMContentLoaded', async ()=>{
  const y=document.getElementById('year'); if(y) y.textContent=new Date().getFullYear();
  Cart.render();
  document.querySelectorAll('.cart-btn').forEach(b=>b.onclick=()=>Cart.open());
  document.querySelectorAll('[data-cart-close]').forEach(b=>b.onclick=()=>Cart.close());

  const grid=document.getElementById('product-grid'), detail=document.getElementById('product-detail');
  const mails=document.querySelectorAll('[data-mailto]');
  let data=null;
  if(grid || detail || mails.length){
    data = await MJG.load();
    mails.forEach(a=>{a.href='mailto:'+data.contactEmail; if(!a.textContent.trim()) a.textContent=data.contactEmail;});
    if(grid){ const lim=+grid.dataset.limit||999; grid.innerHTML=data.products.slice(0,lim).map(p=>MJG.card(p,data)).join(''); }
    if(detail){
      const id=new URLSearchParams(location.search).get('id'); const p=data.products.find(x=>x.id===id);
      if(!p){ detail.innerHTML='<p>Product not found. <a href="index.html">Back to home</a></p>'; return; }
      document.title=p.name+' | Michael James Guitars';
      const specs=Object.entries(p.specs||{}).map(([k,v])=>`<tr><td><strong>${MJG.esc(k)}</strong></td><td>${MJG.esc(v)}</td></tr>`).join('');
      const alts=p.imageAlts||[];
      const media=p.images.map((i,n)=>({type:'img',src:i,alt:alts[n]||p.name}));
      if(p.video)media.splice(3,0,{type:'video',src:p.video.src,poster:p.video.poster,alt:p.video.caption||'Demo video'});
      const show=(m,first)=>m.type==='video'?`<video id="main" controls playsinline preload="metadata" poster="${MJG.esc(m.poster)}" width="540" height="960" aria-label="${MJG.esc(m.alt)}"><source src="${MJG.esc(m.src)}" type="video/mp4"></video>`:MJG.pic(m.src,m.alt,'',first?'id="main" fetchpriority="high"':'id="main"');
      const thumbs=media.length>1?media.map((m,n)=>`<button type="button" data-n="${n}" aria-label="${m.type==='video'?'Play video':'Show photo '+(n+1)}"${m.type==='video'?' class="vthumb"':''}><img src="${MJG.esc(m.type==='video'?m.poster:m.src+'-800.jpg')}" alt="" width="70" height="93"></button>`).join(''):'';
      const form = p.inStock ? `<form class="buy-form" id="buy-form">
        <label class="qty-label" for="buy-qty">Quantity</label>
        <div class="qty-stepper" role="group" aria-label="Quantity">
          <input id="buy-qty" type="number" name="qty" min="1" max="10" value="1" required inputmode="numeric" aria-valuemin="1" aria-valuemax="10" aria-valuenow="1">
          <div class="qty-stepper-btns">
            <button type="button" class="qty-btn qty-up" data-qty-step="1" aria-label="Increase quantity">▲</button>
            <button type="button" class="qty-btn qty-down" data-qty-step="-1" aria-label="Decrease quantity">▼</button>
          </div>
        </div>
        <button type="submit" class="btn">Add to cart</button>
      </form>` : '<span class="btn disabled">Sold out</span>';
      detail.innerHTML=`<div class="product"><div><div id="main-img">${show(media[0],true)}</div><div class="thumbs">${thumbs}</div></div><div><h1>${MJG.esc(p.name)}</h1><p class="price">${MJG.money(p.price,data.currency)}</p><p>${MJG.esc(p.description)}</p>${form}<p><small>Choose a quantity, then add to cart. One ungrooved saddle fits 3- or 4-string guitars.</small></p><h2>Specs</h2><table>${specs}</table><h2>Install notes</h2><p>${MJG.esc(p.installNotes)}</p></div></div>`;
      detail.querySelectorAll('.thumbs button').forEach(t=>t.onclick=()=>{const n=+t.dataset.n;document.getElementById('main-img').innerHTML=show(media[n]);});
      const formEl=document.getElementById('buy-form');
      if(formEl){
        wireBuyQtyStepper(formEl);
        formEl.onsubmit=(e)=>{
          e.preventDefault();
          const fd=new FormData(formEl);
          Cart.add({
            id:p.id,
            name:p.name,
            price:p.price,
            variantId:String(p.defaultVariantId||'standard'),
            qty:Math.max(1, Math.min(10, +fd.get('qty')||1)),
            image:(p.images[0]||'')+'-800.jpg'
          });
        };
      }
    }
  } else {
    try{ data = await MJG.load(); }catch(e){}
  }
  const checkout=document.getElementById('cart-checkout');
  if(checkout) checkout.onclick=async ()=>{
    if(CHECKOUT_MODE==='backend') return backendCheckout(checkout);
    if(!data){ try{data=await MJG.load();}catch(e){data={contactEmail:''};} }
    Cart.checkout(data||{});
  };
});

// Reduced motion: stop the hero video so only the poster/background image shows.
if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('.hero-bg').forEach(v=>{v.removeAttribute('autoplay');v.pause();});
// Hero sound toggle.
document.querySelectorAll('.hero-sound').forEach(b=>{
  const v=document.querySelector('.hero-bg');
  if(!v)return;
  b.onclick=()=>{
    v.muted=!v.muted;
    if(!v.muted){v.volume=1;v.play();}
    b.setAttribute('aria-pressed',String(!v.muted));
    b.setAttribute('aria-label',v.muted?'Unmute video':'Mute video');
    b.innerHTML=v.muted?'<i class="bi bi-volume-mute-fill" aria-hidden="true"></i>':'<i class="bi bi-volume-up-fill" aria-hidden="true"></i>';
  };
});
// Mobile nav toggle.
document.querySelectorAll('.nav-toggle').forEach(btn=>{
  const nav=document.getElementById(btn.getAttribute('aria-controls'));
  if(!nav)return;
  btn.addEventListener('click',()=>{
    const open=nav.classList.toggle('is-open');
    btn.setAttribute('aria-expanded',String(open));
    btn.innerHTML=open?'<i class="bi bi-x-lg" aria-hidden="true"></i>':'<i class="bi bi-list" aria-hidden="true"></i>';
  });
});
// Homepage lightbox.
(()=>{
  const lb=document.getElementById('lightbox');
  if(!lb)return;
  const img=lb.querySelector('img');
  const countEl=lb.querySelector('.lightbox-count');
  const items=[...document.querySelectorAll('.home-gallery-item')];
  let i=0;
  const show=(n)=>{
    if(!items.length)return;
    i=(n+items.length)%items.length;
    const btn=items[i];
    img.src=btn.dataset.full;
    img.alt=btn.dataset.alt||'';
    if(countEl) countEl.textContent=(i+1)+' / '+items.length;
  };
  const open=(n)=>{ show(n); lb.showModal(); };
  const close=()=>lb.close();
  lb.querySelector('.lightbox-close').onclick=close;
  lb.querySelector('.lightbox-prev').onclick=()=>show(i-1);
  lb.querySelector('.lightbox-next').onclick=()=>show(i+1);
  lb.addEventListener('click',e=>{if(e.target===lb)close();});
  lb.addEventListener('keydown',e=>{
    if(e.key==='ArrowLeft'){e.preventDefault();show(i-1);}
    if(e.key==='ArrowRight'){e.preventDefault();show(i+1);}
  });
  items.forEach((btn,n)=>btn.addEventListener('click',()=>open(n)));
})();

// Checkout mode. 'legacy' = existing static Stripe Payment Links (DEFAULT, unchanged).
// 'backend' = server Checkout Session via /api/checkout (Firebase Functions). Do not flip until E2E test verified.
const CHECKOUT_MODE='legacy';
let checkoutPending=false;
async function backendCheckout(btn){
  if(checkoutPending) return;
  const items=Cart.read().map(it=>({productId:String(it.id),variantId:String(it.variantId||it.strings||'standard'),qty:parseInt(it.qty,10)}));
  if(!items.length) return;
  checkoutPending=true; btn.disabled=true; const label=btn.textContent; btn.textContent='Starting checkout…';
  let key=sessionStorage.getItem('mjg_ck_key');
  const fp=JSON.stringify(items);
  if(!key || sessionStorage.getItem('mjg_ck_fp')!==fp){ key=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9-]/g,''); sessionStorage.setItem('mjg_ck_key',key); sessionStorage.setItem('mjg_ck_fp',fp); }
  try{
    const r=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({items})});
    const j=await r.json().catch(()=>({}));
    if(r.ok && j.ok && typeof j.url==='string' && j.url.startsWith('https://checkout.stripe.com/')){ location.href=j.url; return; }
    if(j.rotateKey) sessionStorage.removeItem('mjg_ck_key');
    alert(j.message||'Checkout is unavailable right now. Please try again.');
  }catch(e){ alert('Network problem starting checkout. Please try again.'); }
  checkoutPending=false; btn.disabled=false; btn.textContent=label;
}
