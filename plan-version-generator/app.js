const el = {
  cycle: document.getElementById('cycle-input'),
  location: document.getElementById('location-select'),
  name: document.getElementById('name-input'),
  preview: document.getElementById('preview-button'),
  create: document.getElementById('create-button'),
  status: document.getElementById('status-text'),
  badge: document.getElementById('status-badge'),
  finalName: document.getElementById('final-name'),
  versionKey: document.getElementById('version-key'),
  productCount: document.getElementById('product-count'),
  periodCount: document.getElementById('period-count'),
  supportCount: document.getElementById('support-count'),
  outputCount: document.getElementById('output-count'),
  resumePanel: document.getElementById('resume-panel'),
  resumeText: document.getElementById('resume-text'),
  resumeButton: document.getElementById('resume-button'),
};

const COPY_FIELDS = [
  'periodo','id_local','descricao','divisao','fornecedor','categoria','abc_index','pqr_index','xyz_index','index_produto','custo','preco_venda_medio','trigger_level_lote','lote','lead_time_meses','meses_entre_pedidos','recebimentos_confirmados','demanda','flag_validate','metodo_estoque_seguranca','nivel_servico','cov_trimestre_referencia','cov_qtd_venda_trimestre_y_minus_1','cov_qtd_venda_trimestre_sinal_atual','cov_qtd_venda_trimestre_sinal_resolvido','cov_qtd_venda_media_diaria_trimestre_y_minus_1','cov_qtd_venda_media_diaria_trimestre_atual','cov_qtd_venda_media_diaria_trimestre_blended','qtd_std_venda_U12M','estoque_inicial_m00','cobertura_objetivo_dias','extra_cobertura_dias','qtd_demanda_12M','id_produto'
];

let state = { locations: [], plans: [], products: [], periods: [], supportRows: [], outputRows: [], preview: null, running: false, resumablePlan: null };

function docApi(){ return window.grist?.docApi || window.grist?.raw?.docApi; }
function setBadge(kind,label){ el.badge.className = `badge badge-${kind}`; el.badge.textContent = label; }
function setStatus(msg){ el.status.textContent = msg; }
function normalizeName(value){ return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'plano'; }
function normalizeCycle(value){ return String(value || '').replace(/\D/g,'').slice(0,6); }
function versionKey(ciclo, local, nome){ return `${ciclo}_${local}_${normalizeName(nome)}`; }
function rowId(row){ return row?.id || row?.recordId; }
function chunk(list, size){ const out=[]; for(let i=0;i<list.length;i+=size) out.push(list.slice(i,i+size)); return out; }

function rowsFromColumnar(table){
  const cols = Object.keys(table || {}); if(!cols.length) return [];
  const n = Array.isArray(table[cols[0]]) ? table[cols[0]].length : 0;
  return Array.from({length:n},(_,i)=>{ const r={}; for(const c of cols) r[c]=table[c]?.[i]; return r; });
}
function rowsFromPayload(payload){
  if(!payload) return [];
  if(Array.isArray(payload)) return payload.map(r=>r?.fields ? {id:r.id,...r.fields} : r);
  if(Array.isArray(payload.records)) return payload.records.map(r=>r?.fields ? {id:r.id,...r.fields} : r);
  if(payload.tableData) return rowsFromColumnar(payload.tableData);
  if(typeof payload === 'object' && Array.isArray(Object.values(payload)[0])) return rowsFromColumnar(payload);
  return [];
}
async function fetchRows(table){ const api=docApi(); if(!api?.fetchTable) throw new Error('Grist fetchTable unavailable.'); return rowsFromPayload(await api.fetchTable(table)); }
async function apply(actions){ const api=docApi(); if(!api?.applyUserActions) throw new Error('Grist applyUserActions unavailable.'); for(const batch of chunk(actions, 200)) await api.applyUserActions(batch); }

function computePreview(){
  const ciclo = normalizeCycle(el.cycle.value); el.cycle.value = ciclo;
  const local = el.location.value;
  const baseName = el.name.value.trim();
  if(!/^\d{6}$/.test(ciclo)) throw new Error('Cycle must be YYYYMM.');
  if(!local) throw new Error('Choose a valid location from Entrada_Locais.');
  if(!baseName) throw new Error('Enter a plan name.');
  const used = new Set(state.plans.map(p => String(p.versao_plano || '')));
  let finalName = normalizeName(baseName); let key = versionKey(ciclo, local, finalName); let suffix = 2;
  while(used.has(key)){ finalName = `${normalizeName(baseName)}_v${suffix}`; key = versionKey(ciclo, local, finalName); suffix += 1; }
  const products = state.products.filter(p => String(p.id_local || '') === local && p.id_produto);
  const periods = state.periods.filter(p => p.periodo);
  return { ciclo, local, nome: finalName, versao_plano: key, products, periods, supportCount: products.length * periods.length };
}
function renderPreview(p){
  el.finalName.textContent = p?.nome || '—'; el.versionKey.textContent = p?.versao_plano || '—'; el.productCount.textContent = p ? p.products.length : '—'; el.periodCount.textContent = p ? p.periods.length : '—'; el.supportCount.textContent = p ? p.supportCount : '—'; el.outputCount.textContent = p ? p.supportCount : '—'; el.create.disabled = !p || !p.supportCount || state.running;
}
function installNavigationWarning(){
  window.addEventListener('beforeunload', (event) => {
    if (!state.running) return;
    event.preventDefault();
    event.returnValue = 'Plan version creation is still running. Leaving now may create a partial plan.';
    return event.returnValue;
  });
  document.addEventListener('visibilitychange', () => {
    if (state.running && document.hidden) {
      setStatus('Creation is still running. Keep this widget open until the success message appears.');
    }
  });
}
async function refreshTables(){
  const [locations, plans, products, periods, supportRows, outputRows] = await Promise.all([
    fetchRows('Entrada_Locais'), fetchRows('Entrada_VersoesPlano'), fetchRows('Entrada_Produtos'), fetchRows('Entrada_Periodo'), fetchRows('Apoio_ProjecaoEstoque'), fetchRows('SaidaDados_ProjecaoEstoque')
  ]);
  state = {...state, locations, plans, products, periods, supportRows, outputRows};
  el.location.innerHTML = '';
  for(const loc of locations.filter(l => l.flag_ativo !== false && l.id_local)){
    const opt = document.createElement('option'); opt.value = loc.id_local; opt.textContent = loc.nome ? `${loc.nome} (${loc.id_local})` : loc.id_local; el.location.appendChild(opt);
  }
  renderResumePanel();
  setStatus(`Loaded ${locations.length} locations, ${products.length} products, ${periods.length} periods.`);
}
function planRows(planId){
  const supportRows = state.supportRows.filter(r => Number(r.link_versao_plano) === Number(planId));
  const outputRows = state.outputRows.filter(r => Number(r.link_versao_plano) === Number(planId));
  return {supportRows, outputRows};
}
function outputKey(row){ return `${row.id_produto || row.produto || ''}|${row.periodo || ''}`; }
function missingOutputRows(planId){
  const {supportRows, outputRows} = planRows(planId);
  const existing = new Set(outputRows.map(outputKey));
  return supportRows.filter(row => !existing.has(outputKey(row)));
}
function renderResumePanel(){
  const candidates = state.plans
    .filter(plan => plan.status_geracao === 'generating')
    .map(plan => ({plan, ...planRows(rowId(plan))}))
    .filter(item => item.supportRows.length > item.outputRows.length);
  state.resumablePlan = candidates[0]?.plan || null;
  if (!state.resumablePlan) {
    el.resumePanel.hidden = true;
    return;
  }
  const planId = rowId(state.resumablePlan);
  const {supportRows, outputRows} = planRows(planId);
  el.resumePanel.hidden = false;
  el.resumeText.textContent = `Plan ${state.resumablePlan.versao_plano} is incomplete: ${outputRows.length}/${supportRows.length} output rows copied. Resume will copy only missing rows.`;
  el.resumeButton.disabled = state.running;
}
function buildSupportActions(planId, p){
  const existing = new Set(state.supportRows.filter(r => Number(r.link_versao_plano) === Number(planId)).map(r => `${r.id_produto || r.produto}|${r.periodo}`));
  const actions = [];
  for(const product of p.products){
    for(const period of p.periods){
      const key = `${product.id_produto}|${period.periodo}`;
      if(existing.has(key)) continue;
      actions.push(['AddRecord','Apoio_ProjecaoEstoque',null,{link_versao_plano: planId, id_produto: product.id_produto, periodo: period.periodo}]);
    }
  }
  return actions;
}
function outputFields(planId, row){
  const fields = { link_versao_plano: planId };
  for(const field of COPY_FIELDS){ if(field in row) fields[field] = row[field]; }
  return fields;
}
function buildOutputActions(planId, supportRows){
  return supportRows.map(row => ['AddRecord','SaidaDados_ProjecaoEstoque',null,outputFields(planId, row)]);
}
async function copyOutputRowsWithProgress(planId, rowsToCopy){
  const {outputRows, supportRows} = planRows(planId);
  let copied = outputRows.length;
  for (const batchRows of chunk(rowsToCopy, 200)) {
    await apply(buildOutputActions(planId, batchRows));
    copied += batchRows.length;
    await apply([['UpdateRecord','Entrada_VersoesPlano',planId,{qtd_linhas_geradas:copied,status_geracao:'generating'}]]);
    setStatus(`Copying output rows… ${copied}/${supportRows.length}`);
  }
}
async function preview(){
  try{ state.preview = computePreview(); renderPreview(state.preview); setBadge('success','Ready'); setStatus('Preview ready. Final name/key shown before creation.'); }
  catch(err){ state.preview=null; renderPreview(null); setBadge('error','Fix inputs'); setStatus(err.message); }
}
async function resumePlan(){
  if(state.running || !state.resumablePlan) return;
  state.running = true; el.resumeButton.disabled = true; setBadge('running','Resuming'); setStatus('Resuming interrupted generation… Keep this widget open until completion.');
  try{
    const planId = rowId(state.resumablePlan);
    const missing = missingOutputRows(planId);
    await copyOutputRowsWithProgress(planId, missing);
    await refreshTables();
    const {supportRows, outputRows} = planRows(planId);
    if(outputRows.length !== supportRows.length) throw new Error(`Resume incomplete: ${outputRows.length}/${supportRows.length} output rows copied.`);
    await apply([['UpdateRecord','Entrada_VersoesPlano',planId,{status_geracao:'generated',qtd_linhas_geradas:outputRows.length,gerado_em:new Date().toISOString(),erro_geracao:''}]]);
    setBadge('success','Resumed'); setStatus(`Completed ${state.resumablePlan.versao_plano}: ${outputRows.length}/${supportRows.length} output rows copied.`);
  } catch(err) {
    setBadge('error','Error'); setStatus(err.message || String(err));
  } finally {
    state.running=false; await refreshTables().catch(()=>{}); await preview().catch(()=>{});
  }
}
async function createPlan(){
  if(state.running) return;
  state.running = true; el.create.disabled = true; setBadge('running','Creating'); setStatus('Creating inactive plan version… Keep this widget open until completion. Leaving now may create a partial plan.');
  try{
    const p = state.preview || computePreview();
    await apply([['AddRecord','Entrada_VersoesPlano',null,{nome:p.nome,ciclo:p.ciclo,local:p.local,flag_ativo:false,criado_em:new Date().toISOString(),criado_por:'plan-version-generator',status_geracao:'generating',qtd_linhas_geradas:0,erro_geracao:''}]]);
    await refreshTables();
    const plan = state.plans.find(row => row.versao_plano === p.versao_plano);
    const planId = rowId(plan); if(!planId) throw new Error('Created plan version row was not found after insert.');
    await apply(buildSupportActions(planId, p));
    await refreshTables();
    const source = state.supportRows.filter(r => Number(r.link_versao_plano) === Number(planId));
    await copyOutputRowsWithProgress(planId, source);
    await apply([['UpdateRecord','Entrada_VersoesPlano',planId,{status_geracao:'generated',qtd_linhas_geradas:source.length,gerado_em:new Date().toISOString(),erro_geracao:''}]]);
    setBadge('success','Created'); setStatus(`Created inactive plan version ${p.versao_plano} with ${source.length} output rows. Activate manually after review.`);
  }catch(err){ setBadge('error','Error'); setStatus(err.message || String(err)); }
  finally{ state.running=false; await refreshTables().catch(()=>{}); await preview().catch(()=>{}); }
}

el.preview.addEventListener('click', preview); el.create.addEventListener('click', createPlan); el.resumeButton.addEventListener('click', resumePlan); [el.cycle, el.location, el.name].forEach(node => node.addEventListener('input', () => preview().catch(()=>{})));
installNavigationWarning();
(async function init(){ try{ if(window.grist?.ready) window.grist.ready({requiredAccess:'full'}); await refreshTables(); await preview(); } catch(err){ setBadge('error','Error'); setStatus(err.message || String(err)); } })();
