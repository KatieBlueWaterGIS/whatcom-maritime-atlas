const WEBMAP_ID = '077054926df6434f8662cf8850e3c100';
const SERVICE_ROOT = 'https://services2.arcgis.com/VmLllxPKgIzlr2id/arcgis/rest/services/Mapped_Memories_Full_Schema/FeatureServer';

const state = { layer:null, mapEl:null, fields:new Set(), fieldAliases:new Map(), selected:null, mysterySelected:null, originalViewpoint:null };
const $ = (id)=>document.getElementById(id);
const esc = (v)=>String(v ?? '').replaceAll("'","''");
const truthy = (v)=> ['yes','true','1','y'].includes(String(v ?? '').trim().toLowerCase());
const imgFallback = 'assets/photos-banner.png';

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
function imageUrl(a){ return val(a,'thumbnail_url','photo_url','image_url','image','photo','media_url','url') || imgFallback; }
function setImg(el,url){ el.onerror=()=>{el.onerror=null;el.src=imgFallback}; el.src=url || imgFallback; }

async function findMappedLayer(mapEl){
  await mapEl.viewOnReady();
  const map = mapEl.map;
  if (map?.loadAll) await map.loadAll();
  const layers = map?.allLayers?.toArray?.() || [];
  for (const layer of layers){
    try{
      await layer.load();
      const names = new Set((layer.fields || []).map(f=>f.name.toLowerCase()));
      if(names.has('photo_id') || names.has('mystery_photo') || names.has('then_now_available')) return layer;
    }catch(e){ console.warn('Layer inspection skipped:', layer?.title, e); }
  }
  const FeatureLayer = await $arcgis.import('@arcgis/core/layers/FeatureLayer.js');
  const root = await fetch(`${SERVICE_ROOT}?f=json`).then(r=>{if(!r.ok) throw new Error(`Feature service request failed (${r.status})`);return r.json();});
  for (const info of (root.layers || [])){
    const meta = await fetch(`${SERVICE_ROOT}/${info.id}?f=json`).then(r=>r.json());
    const names = new Set((meta.fields || []).map(f=>f.name.toLowerCase()));
    if(names.has('photo_id') || names.has('mystery_photo') || names.has('title')){
      const layer = new FeatureLayer({url:`${SERVICE_ROOT}/${info.id}`, outFields:['*']});
      map.add(layer); await layer.load(); return layer;
    }
  }
  throw new Error('Could not identify a Mapped Memories feature layer in the Web Map or feature service.');
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
    state.layer.renderer = new SimpleRenderer({symbol:new PictureMarkerSymbol({url:new URL('assets/icon-memories.png',location.href).href,width:34,height:34})});
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
    return vals;
  }catch(e){ console.warn('Distinct query failed:',field,e); return []; }
}
function makeChipFilter(selectId,values){
  const sel=$(selectId), box=$(`${selectId}Chips`); if(!sel||!box) return;
  sel.hidden=true; box.hidden=false;
  const allText=sel.options[0]?.textContent?.replace(/^All\s+/i,'All') || 'All';
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
function selectFeature(graphic){
  if(!graphic)return; state.selected=graphic; const a=graphic.attributes||{},d=detailData(a);
  $('selectedPlaceholder').hidden=true;$('selectedContent').hidden=false; setImg($('selectedImage'),d.image);$('selectedMediaBadge').textContent=d.media;$('selectedEra').textContent=d.era;$('selectedTitle').textContent=d.title;$('selectedDescription').textContent=d.description;
  $('selectedMeta').innerHTML=[metaRow('Location',d.location),metaRow('People',d.people),metaRow('Vessel',d.vessel),metaRow('Tags',d.tags),metaRow('Collection',d.collection),metaRow('Credit',d.credit),metaRow('Confidence',d.confidence)].join('');
  const hasPair=truthy(val(a,'then_now_available'))&&d.pair;$('thenNowBtn').hidden=!hasPair;$('thenNowBtn').dataset.pair=d.pair||'';
  $('identifyBtn').hidden=!d.mystery;$('identifyBtn').onclick=()=>openContribute(`Help identify: ${d.title}`,d.mysteryNotes);
  $('relatedStoryBtn').hidden=!/^https?:/i.test(d.story||'');if(d.story)$('relatedStoryBtn').href=d.story;
}
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
  $('mysteryOnMap').onclick=()=>{closeModal('mysteryModal');selectFeature(g);if(g.geometry)state.mapEl.goTo({target:g.geometry,zoom:17},{duration:650});};
  $('mysteryModal').classList.add('open');$('mysteryModal').setAttribute('aria-hidden','false');
}
async function chooseThenNow(){
  const f=resolveField('then_now_available');if(!state.layer||!f)return;
  try{const g=await randomFeature(`UPPER(${f}) IN ('YES','TRUE','Y','1')`);if(g){selectFeature(g);openThenNow();}}catch(e){console.warn(e)}
}
function openThenNow(){
  const a=state.selected?.attributes||{},d=detailData(a);const pair=d.pair||$('thenNowBtn').dataset.pair;if(!pair)return;
  setImg($('thenImage'),d.image);setImg($('nowImage'),pair);$('thenNowTitle').textContent=`${d.title}: then + now`;$('thenNowModal').classList.add('open');$('thenNowModal').setAttribute('aria-hidden','false');
}
function updateSlider(v){$('nowClip').style.left=`${v}%`;const img=$('nowClip').querySelector('img');img.style.left=`-${v}%`;img.style.width=`${10000/Math.max(1,100-v)}%`;$('thenDivider').style.left=`${v}%`;}
function openContribute(title='Help build the archive',notes=''){$('contributeTitle').textContent=title;const p=$('contributeModal').querySelector('p:not(.eyebrow)');p.textContent=notes||'The public contribution workflow is still being developed. The finished Atlas can invite people to upload photographs or objects, identify mystery images, and add context about people, vessels, businesses, and places.';$('contributeModal').classList.add('open');$('contributeModal').setAttribute('aria-hidden','false');}
function closeModal(id){$(id).classList.remove('open');$(id).setAttribute('aria-hidden','true')}

async function initMap(){
  const mapEl=$('memoryMap');state.mapEl=mapEl;
  try{
    await mapEl.componentOnReady();await mapEl.viewOnReady();state.originalViewpoint=mapEl.viewpoint?.clone?.()||null;
    const layer=await findMappedLayer(mapEl);state.layer=layer;registerFields(layer);await applyMemoryRenderer();
    await Promise.all([populateDistinct('eraFilter','era'),populateDistinct('mediaFilter','media_type'),populateDistinct('themeFilter','theme'),populateDistinct('areaFilter','waterfront_area'),populateDistinct('collectionFilter','archive_collection')]);
    await applyFilters();$('mapNote').textContent='Tap a point to explore its story.';
    mapEl.addEventListener('arcgisViewClick',async event=>{
      const hit=await mapEl.hitTest(event.detail,{include:[layer]});
      const result=(hit.results||[]).find(r=>r?.graphic && (r.graphic.layer===layer || r.graphic.layer?.url===layer.url || r.graphic.sourceLayer?.url===layer.url));
      if(result?.graphic){const full=await hydrateHitGraphic(result.graphic);selectFeature(full);}
    });
  }catch(e){console.error('Mapped Memories initialization failed:',e);$('mapNote').textContent='The live ArcGIS map could not be loaded. Open the browser console for the exact error.';$('resultCount').textContent='Map unavailable';}
}

['eraFilter','mediaFilter','themeFilter','areaFilter','collectionFilter','mysteryOnly','thenNowOnly'].forEach(id=>$(id).addEventListener('change',applyFilters));
let timer;$('memorySearch').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(applyFilters,280)});
$('clearFilters').onclick=()=>{['eraFilter','mediaFilter','themeFilter','areaFilter','collectionFilter'].forEach(id=>{$(id).value='';syncChip(id)});$('memorySearch').value='';$('mysteryOnly').checked=false;$('thenNowOnly').checked=false;applyFilters()};
$('filtersToggle').onclick=()=>$('filtersPanel').classList.toggle('open');$('filtersClose').onclick=()=>$('filtersPanel').classList.remove('open');
$('mysteryBtn').onclick=chooseMystery;$('nextMystery').onclick=chooseMystery;$('thenNowExploreBtn').onclick=chooseThenNow;$('nextThenNow').onclick=chooseThenNow;$('contributeBtn').onclick=()=>openContribute();$('thenNowBtn').onclick=openThenNow;
$('thenNowOnMap').onclick=()=>{closeModal('thenNowModal');const g=state.selected;if(g?.geometry)state.mapEl.goTo({target:g.geometry,zoom:17},{duration:650});};
$('resetMap').onclick=()=>state.originalViewpoint&&state.mapEl?.goTo(state.originalViewpoint,{duration:600});$('thenNowSlider').addEventListener('input',e=>updateSlider(+e.target.value));updateSlider(50);
document.querySelectorAll('[data-close-modal]').forEach(x=>x.onclick=()=>closeModal('thenNowModal'));document.querySelectorAll('[data-close-mystery]').forEach(x=>x.onclick=()=>closeModal('mysteryModal'));document.querySelectorAll('[data-close-contribute]').forEach(x=>x.onclick=()=>closeModal('contributeModal'));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal('thenNowModal');closeModal('mysteryModal');closeModal('contributeModal');$('filtersPanel').classList.remove('open')}});
customElements.whenDefined('arcgis-map').then(initMap);
