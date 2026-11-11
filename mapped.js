const WEBMAP_ID = '077054926df6434f8662cf8850e3c100';
const SERVICE_ROOT = 'https://services2.arcgis.com/VmLllxPKgIzlr2id/arcgis/rest/services/Mapped_Memories_Full_Schema/FeatureServer';
const MAPPED_LAYER_URL = `${SERVICE_ROOT}/5`; // verified live layer

const state = { layer:null, mapEl:null, fields:new Set(), fieldAliases:new Map(), selected:null, mysterySelected:null, originalViewpoint:null };
const $ = (id)=>document.getElementById(id);
const esc = (v)=>String(v ?? '').replaceAll("'","''");
const truthy = (v)=> ['yes','true','1','y'].includes(String(v ?? '').trim().toLowerCase());
const imgFallback = 'photos-banner.png';

function resolveField(...candidates){
  for(const c of candidates){
    if(!c) continue;
    if(state.fields.has(c)) return c;
    const low=String(c).toLowerCase();
    const byName=[...state.fields].find(f=>f.toLowerCase()===low);
    if(byName) return byName;
    const byAlias=state.fieldAliases.get(low);
    if(byAlias) return byAlias;
  }
  return null;
}
function fieldExists(name){ return Boolean(resolveField(name)); }
function val(a,...candidates){ const f=resolveField(...candidates); return f && a ? a[f] : null; }
function displayDate(v){
  if(!v) return '';
  const d = new Date(v);
  if(!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  return String(v);
}
function imageUrl(a){
  const direct = val(a,'photo_url','thumbnail_url','image_url','image','photo','media_url','web_image_url','public_url','r2_url','object_url','url');
  if (direct && /^https?:\/\//i.test(String(direct))) return String(direct).trim();
  // Scan the full record for image-looking URLs so the app remains resilient to schema refinements.
  for (const [key,raw] of Object.entries(a||{})){
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const txt=raw.trim();
    const urls=txt.match(/https?:\/\/[^\s"'<>]+/ig) || [];
    for (const u of urls){
      if (/\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u) || /(photo|image|media|thumbnail|cloudflare|r2\.)/i.test(key+' '+u)) return u;
    }
  }
  return '';
}
function setImg(el,url){
  el.dataset.usingFallback='false';
  el.onerror=()=>{ if(el.dataset.usingFallback==='true') return; el.dataset.usingFallback='true'; el.src=imgFallback; };
  el.src=url || imgFallback;
}

async function findMappedLayer(mapEl){
  await mapEl.viewOnReady();
  const map = mapEl.map;
  if (map?.loadAll) await map.loadAll();
  const layers = map?.allLayers?.toArray?.() || [];
  // Prefer the exact verified Mapped Memories layer if it is already in the Web Map.
  for (const layer of layers){
    try{
      await layer.load();
      if ((layer.url || '').replace(/\/$/,'') === MAPPED_LAYER_URL) return layer;
      const names = new Set((layer.fields || []).map(f=>f.name.toLowerCase()));
      if(names.has('photo_url') && names.has('photo_id') && names.has('description')) return layer;
    }catch(e){ console.warn('Layer inspection skipped:', layer?.title, e); }
  }
  // Otherwise add the known public layer directly.
  const FeatureLayer = await $arcgis.import('@arcgis/core/layers/FeatureLayer.js');
  const layer = new FeatureLayer({url:MAPPED_LAYER_URL, outFields:['*'], popupEnabled:false});
  map.add(layer);
  await layer.load();
  return layer;
}

function registerFields(layer){
  state.fields=new Set((layer.fields||[]).map(f=>f.name));
  state.fieldAliases=new Map();
  (layer.fields||[]).forEach(f=>{ if(f.alias) state.fieldAliases.set(String(f.alias).toLowerCase(),f.name); });
}

async function applyMemoryRenderer(){
  if(!state.layer || state.layer.geometryType!=='point') return;
  try{
    const [SimpleRenderer,PictureMarkerSymbol] = await Promise.all([
      $arcgis.import('@arcgis/core/renderers/SimpleRenderer.js'),
      $arcgis.import('@arcgis/core/symbols/PictureMarkerSymbol.js')
    ]);
    state.layer.renderer = new SimpleRenderer({symbol:new PictureMarkerSymbol({url:new URL('icon-memories.png',location.href).href,width:34,height:34})});
  }catch(e){ console.warn('Custom Mapped Memories symbology unavailable; retaining Web Map renderer.',e); }
}

async function populateDistinct(selectId, field){
  const actual=resolveField(field); if(!actual) return [];
  try{
    const q=state.layer.createQuery(); q.where='1=1';q.outFields=[actual];q.returnDistinctValues=true;q.returnGeometry=false;q.orderByFields=[actual];q.num=2000;
    const fs=await state.layer.queryFeatures(q);
    const vals=[...new Set(fs.features.map(f=>f.attributes[actual]).filter(v=>v!==null && v!==''))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}));
    const sel=$(selectId); vals.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;sel.appendChild(o)});
    if(vals.length>0 && vals.length<5) makeChipFilter(selectId,vals);
    else clearChipFilter(selectId);
    return vals;
  }catch(e){ console.warn('Distinct query failed:',field,e); return []; }
}
function clearChipFilter(selectId){
  const sel=$(selectId), box=$(`${selectId}Chips`); if(!sel||!box) return;
  sel.hidden=false; sel.style.display=''; box.hidden=true; box.style.display='none'; box.innerHTML='';
  sel.closest('.filter-control')?.classList.remove('chip-mode');
}
function makeChipFilter(selectId,values){
  const sel=$(selectId), box=$(`${selectId}Chips`); if(!sel||!box) return;
  sel.hidden=true; sel.style.display='none'; box.hidden=false; box.style.display='flex';
  sel.closest('.filter-control')?.classList.add('chip-mode');
  const allText=(sel.options[0]?.textContent || 'All').trim();
  const items=[['',allText],...values.map(v=>[String(v),String(v)])];
  box.innerHTML=items.map(([v,t],i)=>`<button type="button" class="filter-chip${i===0?' active':''}" data-value="${String(v).replaceAll('&','&amp;').replaceAll('"','&quot;')}">${t}</button>`).join('');
  box.addEventListener('click',e=>{
    const b=e.target.closest('.filter-chip'); if(!b)return;
    sel.value=b.dataset.value; box.querySelectorAll('.filter-chip').forEach(x=>x.classList.toggle('active',x===b)); applyFilters();
  });
}
function syncChip(selectId){ const box=$(`${selectId}Chips`); if(!box||box.hidden)return; box.querySelectorAll('.filter-chip').forEach(b=>b.classList.toggle('active',b.dataset.value===$(selectId).value)); }

function activeWhere(){
  const parts=[];
  const pairs=[['eraFilter','era'],['mediaFilter','media_type'],['themeFilter','theme'],['areaFilter','waterfront_area'],['collectionFilter','archive_collection']];
  pairs.forEach(([id,f])=>{const actual=resolveField(f);const v=$(id).value;if(v&&actual)parts.push(`${actual}='${esc(v)}'`)});
  const mystery=resolveField('mystery_photo'); if($('mysteryOnly').checked&&mystery)parts.push(`UPPER(${mystery}) IN ('YES','TRUE','Y','1')`);
  const thenNow=resolveField('then_now_available'); if($('thenNowOnly').checked&&thenNow)parts.push(`UPPER(${thenNow}) IN ('YES','TRUE','Y','1')`);
  const s=$('memorySearch').value.trim();
  if(s){
    const sf=['title','description','photo_tags','people_names','vessels','businesses_orgs','location_description'].map(x=>resolveField(x)).filter(Boolean);
    if(sf.length)parts.push('('+sf.map(f=>`UPPER(${f}) LIKE '%${esc(s.toUpperCase())}%'`).join(' OR ')+')');
  }
  return parts.length?parts.join(' AND '):'1=1';
}
async function applyFilters(){
  if(!state.layer)return; const where=activeWhere(); state.layer.definitionExpression=where==='1=1'?null:where;
  const ids=['eraFilter','mediaFilter','themeFilter','areaFilter','collectionFilter'];ids.forEach(syncChip);
  const active=ids.filter(id=>$(id).value).length+Number($('mysteryOnly').checked)+Number($('thenNowOnly').checked)+Number(Boolean($('memorySearch').value.trim()));
  $('filterCount').textContent=active?`(${active})`:'';
  try{const q=state.layer.createQuery();q.where=where;const c=await state.layer.queryFeatureCount(q);$('resultCount').textContent=`${c.toLocaleString()} items`;}catch(e){$('resultCount').textContent='Collection loaded';}
}

function metaRow(label,value){ return value ? `<dt>${label}</dt><dd>${value}</dd>` : ''; }
function detailData(a){
  return {
    image:imageUrl(a), media:val(a,'media_type','type')||'Archive item', era:[val(a,'era'),displayDate(val(a,'photo_date','date','date_taken'))].filter(Boolean).join(' · '),
    title:val(a,'title','object_name','source_caption','name')||'Untitled memory',
    description:val(a,'description','source_caption','caption','location_description','notes')||'',
    location:val(a,'waterfront_area','neighborhood','location_description','place_name','location'), people:val(a,'people_names','people'), vessel:val(a,'vessels','vessel_name','vessel'), tags:val(a,'photo_tags','tags'),
    collection:val(a,'archive_collection','collection'), credit:val(a,'source_credit','credit'), confidence:val(a,'location_confidence'),
    pair:val(a,'then_now_pair_URL','then_now_pair_url','now_photo_url','comparison_url'), mystery:truthy(val(a,'mystery_photo','mystery')), mysteryNotes:val(a,'mystery_notes','identification_notes','notes_needed'),
    story:val(a,'storymap_link','related_story','story_url')
  };
}
async function attachmentImageUrl(graphic){
  if(!graphic || !state.layer?.capabilities?.data?.supportsAttachment) return '';
  try{
    const oid=graphic.getObjectId?.() ?? graphic.attributes?.[state.layer.objectIdField];
    if(oid==null) return '';
    const result=await state.layer.queryAttachments({objectIds:[oid]});
    const items=result?.[oid] || result?.[String(oid)] || [];
    const img=items.find(x=>/^image\//i.test(x.contentType||'')) || items[0];
    return img?.url || '';
  }catch(e){ console.warn('Attachment image lookup failed.',e); return ''; }
}
function fillDetailFields(prefix,d){
  setImg($(prefix+'Image'),d.image);
  $(prefix+'MediaBadge').textContent=d.media;
  $(prefix+'Era').textContent=d.era;
  $(prefix+'Title').textContent=d.title;
  $(prefix+'Description').textContent=d.description;
  $(prefix+'Meta').innerHTML=[metaRow('Location',d.location),metaRow('People',d.people),metaRow('Vessel',d.vessel),metaRow('Tags',d.tags),metaRow('Collection',d.collection),metaRow('Credit',d.credit),metaRow('Confidence',d.confidence)].join('');
}
async function selectFeature(graphic){
  if(!graphic)return; state.selected=graphic; const a=graphic.attributes||{},d=detailData(a);
  if(!d.image || d.image===imgFallback) d.image=await attachmentImageUrl(graphic) || imgFallback;
  const hasPair=truthy(val(a,'then_now_available'))&&d.pair;
  // Universal immersive viewer for desktop + mobile
  fillDetailFields('detail',d);
  $('detailThenNowBtn').hidden=!hasPair;$('detailThenNowBtn').onclick=openThenNow;
  $('detailIdentifyBtn').hidden=!d.mystery;$('detailIdentifyBtn').onclick=()=>openContribute(`Help identify: ${d.title}`,d.mysteryNotes);
  $('detailStoryBtn').hidden=!/^https?:/i.test(d.story||'');if(d.story)$('detailStoryBtn').href=d.story;
  $('memoryDetailViewer').classList.add('open');$('memoryDetailViewer').setAttribute('aria-hidden','false');document.body.classList.add('memory-detail-open');
}
function closeDetail(){ $('memoryDetailViewer').classList.remove('open');$('memoryDetailViewer').setAttribute('aria-hidden','true');document.body.classList.remove('memory-detail-open'); }
async function hydrateHitGraphic(graphic){
  if(!graphic||!state.layer)return graphic;
  try{
    const oid=graphic.getObjectId?.() ?? graphic.attributes?.[state.layer.objectIdField];
    if(oid==null)return graphic;
    const q=state.layer.createQuery();q.objectIds=[oid];q.outFields=['*'];q.returnGeometry=true;
    const fs=await state.layer.queryFeatures(q);return fs.features[0]||graphic;
  }catch(e){console.warn('Could not hydrate clicked memory feature.',e);return graphic;}
}

async function randomFeature(where){
  const q=state.layer.createQuery();q.where=where;q.outFields=['*'];q.returnGeometry=true;q.num=100;
  const fs=await state.layer.queryFeatures(q);if(!fs.features.length)return null;return fs.features[Math.floor(Math.random()*fs.features.length)];
}
async function chooseMystery(){
  const f=resolveField('mystery_photo');if(!state.layer||!f)return;
  try{const g=await randomFeature(`UPPER(${f}) IN ('YES','TRUE','Y','1')`);if(g)openMystery(g);}catch(e){console.warn(e)}
}
function openMystery(g){
  state.mysterySelected=g; const d=detailData(g.attributes||{});setImg($('mysteryImage'),d.image);$('mysteryTitle').textContent=d.title==='Untitled memory'?'Can you help identify this memory?':d.title;
  $('mysteryPrompt').textContent=d.mysteryNotes||d.description||'Some details about this photograph are still unknown. What can you tell us about the people, vessel, place, or date?';
  $('mysteryMeta').innerHTML=[metaRow('Approx. date',d.era),metaRow('Location',d.location),metaRow('Collection',d.collection),metaRow('What we know',d.tags)].join('');
  $('mysteryIdentify').onclick=()=>{closeModal('mysteryModal');openContribute(`Help identify: ${d.title}`,d.mysteryNotes)};
  $('mysteryOnMap').onclick=async()=>{closeModal('mysteryModal');await selectFeature(g);if(g.geometry)state.mapEl.goTo({target:g.geometry,zoom:17},{duration:650});};
  $('mysteryModal').classList.add('open');$('mysteryModal').setAttribute('aria-hidden','false');
}
async function chooseThenNow(){
  const f=resolveField('then_now_available');if(!state.layer||!f)return;
  try{const g=await randomFeature(`UPPER(${f}) IN ('YES','TRUE','Y','1')`);if(g){await selectFeature(g);openThenNow();}}catch(e){console.warn(e)}
}
function openThenNow(){
  const a=state.selected?.attributes||{},d=detailData(a);const pair=d.pair||$('thenNowBtn').dataset.pair;if(!pair)return;
  setImg($('thenImage'),d.image);setImg($('nowImage'),pair);$('thenNowTitle').textContent=`${d.title}: then + now`;$('thenNowModal').classList.add('open');$('thenNowModal').setAttribute('aria-hidden','false');
}
function updateSlider(v){$('nowClip').style.left=`${v}%`;const img=$('nowClip').querySelector('img');img.style.left=`-${v}%`;img.style.width=`${10000/Math.max(1,100-v)}%`;$('thenDivider').style.left=`${v}%`;}
function openContribute(title='Help build the archive',notes=''){$('contributeTitle').textContent=title;const p=$('contributeModal').querySelector('p:not(.eyebrow)');p.textContent=notes||'The public contribution workflow is still being developed. The finished Atlas can invite people to upload photographs or objects, identify mystery images, and add context about people, vessels, businesses, and places.';$('contributeModal').classList.add('open');$('contributeModal').setAttribute('aria-hidden','false');}
function closeModal(id){$(id).classList.remove('open');$(id).setAttribute('aria-hidden','true')}

async function nearestFeatureFromClick(event){
  if(!state.layer || !state.view || !event?.mapPoint) return null;
  try{
    const q=state.layer.createQuery();
    q.where=activeWhere();
    q.geometry=event.mapPoint;
    // Convert roughly 18 screen pixels to map units; enforce a useful touch target.
    const metersPerPixel=Number(state.view.resolution)||2;
    q.distance=Math.max(25, metersPerPixel*18);
    q.units='meters';
    q.spatialRelationship='intersects';
    q.outFields=['*'];
    q.returnGeometry=true;
    q.num=20;
    const fs=await state.layer.queryFeatures(q);
    if(!fs.features.length) return null;
    const click={x:event.x,y:event.y};
    let best=null,bestD=Infinity;
    for(const f of fs.features){
      const pt=state.view.toScreen(f.geometry);
      if(!pt) continue;
      const d=Math.hypot(pt.x-click.x,pt.y-click.y);
      if(d<bestD){bestD=d;best=f;}
    }
    return bestD<=28 ? best : null;
  }catch(e){
    console.warn('Nearest-feature fallback failed.',e);
    return null;
  }
}

async function initMap(){
  const mapEl=$('memoryMap');state.mapEl=mapEl;
  try{
    await mapEl.componentOnReady();await mapEl.viewOnReady();state.originalViewpoint=mapEl.viewpoint?.clone?.()||null;
    const layer=await findMappedLayer(mapEl);state.layer=layer;registerFields(layer);await applyMemoryRenderer();
    await Promise.all([populateDistinct('eraFilter','era'),populateDistinct('mediaFilter','media_type'),populateDistinct('themeFilter','theme'),populateDistinct('areaFilter','waterfront_area'),populateDistinct('collectionFilter','archive_collection')]);
    await applyFilters();$('mapNote').textContent='Tap a point to explore its story.';
    state.view=mapEl.view;
    state.view.on('click',async event=>{
      try{
        let selected=null;
        const hit=await state.view.hitTest(event,{include:[layer]});
        const result=(hit.results||[]).find(r=>r?.graphic && (r.graphic.layer===layer || r.graphic.layer?.url===layer.url || r.graphic.sourceLayer?.url===layer.url));
        if(result?.graphic) selected=await hydrateHitGraphic(result.graphic);
        if(!selected) selected=await nearestFeatureFromClick(event);
        if(selected){
          await selectFeature(selected);
          $('mapNote').textContent='Photo opened — use “Back to map” to continue exploring.';
        }
      }catch(err){console.warn('Mapped Memories click selection failed.',err);}
    });
  }catch(e){console.error('Mapped Memories initialization failed:',e);$('mapNote').textContent='The live ArcGIS map could not be loaded. Open the browser console for the exact error.';$('resultCount').textContent='Map unavailable';}
}

['eraFilter','mediaFilter','themeFilter','areaFilter','collectionFilter','mysteryOnly','thenNowOnly'].forEach(id=>$(id).addEventListener('change',applyFilters));
let timer;$('memorySearch').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(applyFilters,280)});
$('clearFilters').onclick=()=>{['eraFilter','mediaFilter','themeFilter','areaFilter','collectionFilter'].forEach(id=>{$(id).value='';syncChip(id)});$('memorySearch').value='';$('mysteryOnly').checked=false;$('thenNowOnly').checked=false;applyFilters()};
function setFiltersOpen(open){
  $('filtersPanel').classList.toggle('open',open);
  $('filtersBackdrop')?.classList.toggle('open',open);
  $('filtersBackdrop')?.setAttribute('aria-hidden',String(!open));
  document.body.classList.toggle('filters-open',open);
}
$('filtersToggle').onclick=()=>setFiltersOpen(true);
$('filtersClose').onclick=()=>setFiltersOpen(false);
$('filtersDone').onclick=()=>setFiltersOpen(false);
$('filtersBackdrop').onclick=()=>setFiltersOpen(false);
$('mysteryBtn').onclick=chooseMystery;$('nextMystery').onclick=chooseMystery;$('thenNowExploreBtn').onclick=chooseThenNow;$('nextThenNow').onclick=chooseThenNow;$('contributeBtn').onclick=()=>openContribute();
$('thenNowOnMap').onclick=()=>{closeModal('thenNowModal');const g=state.selected;if(g?.geometry)state.mapEl.goTo({target:g.geometry,zoom:17},{duration:650});};
$('resetMap').onclick=()=>state.originalViewpoint&&state.mapEl?.goTo(state.originalViewpoint,{duration:600});$('thenNowSlider').addEventListener('input',e=>updateSlider(+e.target.value));updateSlider(50);
document.querySelectorAll('[data-close-modal]').forEach(x=>x.onclick=()=>closeModal('thenNowModal'));document.querySelectorAll('[data-close-mystery]').forEach(x=>x.onclick=()=>closeModal('mysteryModal'));document.querySelectorAll('[data-close-contribute]').forEach(x=>x.onclick=()=>closeModal('contributeModal'));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal('thenNowModal');closeModal('mysteryModal');closeModal('contributeModal');closeDetail();setFiltersOpen(false)}});

$('detailBack').onclick=closeDetail;
document.querySelectorAll('[data-close-detail]').forEach(x=>x.onclick=closeDetail);
customElements.whenDefined('arcgis-map').then(initMap);
