const SOURCE_TABLE_ID = 'SaidaDados_ProjecaoEstoque';
const PLAN_VERSION_TABLE_ID = 'Entrada_VersoesPlano';
const PLAN_VERSION_STORAGE_KEY = 'dkt-summary-v2:selected-plan-version';
const MONTH_FIELDS = Array.from({ length: 13 }, (_, index) => `M${String(index).padStart(2, '0')}`);
const REQUESTED_COLUMNS = [
  { name: 'id_produto', optional: true },
  { name: 'periodo', optional: true },
  { name: 'ano_mes', optional: true },
  { name: 'descricao', optional: true },
  { name: 'fornecedor', optional: true },
  { name: 'categoria', optional: true },
  { name: 'abc_index', optional: true },
  { name: 'custo', optional: true },
  { name: 'lote', optional: true },
  { name: 'flag_validate', optional: true },
  { name: 'proposta_pedido_qtd', optional: true },
  { name: 'proposta_pedido_qtd_mil', optional: true },
  { name: 'vlr_custo_proposta_pedido_qtd', optional: true },
  { name: 'lead_time_meses', optional: true },
  { name: 'ultimo_periodo_possivel_pedido', optional: true },
  { name: 'versao_plano', optional: true },
  { name: 'ciclo', optional: true },
];
const SOURCE_FIELD_MAP = {
  sku: ['id_produto'],
  period: ['periodo'],
  monthLabel: ['ano_mes'],
  description: ['descricao'],
  supplier: ['fornecedor'],
  category: ['categoria'],
  abc: ['abc_index', 'abc'],
  unitCost: ['custo', 'custo_unit'],
  lot: ['lote'],
  validate: ['flag_validate'],
  proposalQty: ['proposta_pedido_qtd'],
  proposalQtyMil: ['proposta_pedido_qtd_mil'],
  proposalCost: ['vlr_custo_proposta_pedido_qtd'],
  leadTime: ['lead_time_meses'],
  latestOrderPeriod: ['ultimo_periodo_possivel_pedido'],
  planVersion: ['versao_plano'],
  cycle: ['ciclo'],
};
const MODE_CONFIG = {
  emissao: {
    kicker: 'Planejamento de suprimentos',
    title: 'Pedidos propostos',
    subtitle: 'Revise as recomendações por período de emissão.',
    toggleLabel: 'Emissão',
    periodTransform: (row) => normalizePeriod(readMappedField(row, 'latestOrderPeriod')),
    fieldsNote: 'id_produto, ultimo_periodo_possivel_pedido, ano_mes, descricao, fornecedor, categoria, abc_index, custo, lote, flag_validate, proposta_pedido_qtd, vlr_custo_proposta_pedido_qtd.',
  },
  recebimento: {
    kicker: 'Planejamento de suprimentos',
    title: 'Pedidos propostos',
    subtitle: 'Revise as recomendações por período de recebimento.',
    toggleLabel: 'Recebimento',
    periodTransform: (row) => normalizePeriod(readMappedField(row, 'period')),
    fieldsNote: 'id_produto, periodo, ano_mes, descricao, fornecedor, categoria, abc_index, custo, lote, flag_validate, proposta_pedido_qtd, vlr_custo_proposta_pedido_qtd.',
  },
};
const params = new URLSearchParams(window.location.search);
const debugMode = params.get('debug') === '1';
const forceDiagnosticPanel = false;
const diagnosticBuild = '20260520-dkt-summary-v2-clean-mil-units';
const initialMode = params.get('mode') === 'recebimento' ? 'recebimento' : 'emissao';
let currentMode = initialMode;
const initialBasis = params.get('basis') === 'cost' ? 'cost' : 'units';
let currentBasis = initialBasis;
const MEASURE_BASIS_CONFIG = {
  units: { label: 'Mil unidades', shortLabel: 'mil un.', logicalField: 'proposalQtyMil' },
  cost: { label: 'Custo', shortLabel: 'R$', logicalField: 'proposalCost' },
};
const statusEl = document.getElementById('status');
const notesEl = document.getElementById('notes-card');
const tableShellEl = document.getElementById('table-shell');
const sourcePillEl = document.getElementById('source-pill');
const summaryPillEl = document.getElementById('summary-pill');
const planVersionSelectEl = document.getElementById('plan-version-select');
const titleEl = document.getElementById('page-title');
const subtitleEl = document.getElementById('page-subtitle');
const kickerEl = document.getElementById('mode-kicker');
const modeToggleButtons = Array.from(document.querySelectorAll('[data-mode-toggle]'));
const basisToggleButtons = Array.from(document.querySelectorAll('[data-basis-toggle]'));
const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
let table = null;
let currentTableId = null;
let latestRows = [];
let latestSourceLabel = null;
let planVersionOptions = [];
let currentPlanVersion = null;

setElementVisible(notesEl, forceDiagnosticPanel || debugMode);
setElementVisible(sourcePillEl, forceDiagnosticPanel || debugMode);
setElementVisible(statusEl, forceDiagnosticPanel || debugMode);
applyModeUi();

function getModeConfig() {
  return MODE_CONFIG[currentMode];
}

function getBasisConfig() {
  return MEASURE_BASIS_CONFIG[currentBasis];
}

function applyModeUi() {
  const modeConfig = getModeConfig();
  const basisConfig = getBasisConfig();
  kickerEl.textContent = modeConfig.kicker;
  titleEl.textContent = `${modeConfig.title} · ${basisConfig.label}`;
  subtitleEl.textContent = `${modeConfig.subtitle} Base: ${basisConfig.label.toLowerCase()}.`;
  for (const button of modeToggleButtons) {
    const isActive = button.dataset.modeToggle === currentMode;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
  for (const button of basisToggleButtons) {
    const isActive = button.dataset.basisToggle === currentBasis;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function setElementVisible(element, visible) {
  if (!element) {
    return;
  }
  element.hidden = !visible;
  element.classList.toggle('is-hidden', !visible);
}

function readStoredPlanVersion() {
  try {
    return window.localStorage?.getItem(PLAN_VERSION_STORAGE_KEY) || '';
  } catch (_error) {
    return '';
  }
}

function writeStoredPlanVersion(planVersion) {
  try {
    if (planVersion) {
      window.localStorage?.setItem(PLAN_VERSION_STORAGE_KEY, planVersion);
    }
  } catch (_error) {
    // Storage may be unavailable inside embedded contexts; selection still works for this session.
  }
}

function normalizeCycle(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/\d{6}/);
  return match ? match[0] : '';
}

function inferPlanVersionsFromRows(rows) {
  const byVersion = new Map();
  for (const rawRow of rows || []) {
    const row = normalizeRow(rawRow);
    const value = readMappedField(row, 'planVersion');
    if (!value) {
      continue;
    }
    const planVersion = String(value);
    const existing = byVersion.get(planVersion) || { versao_plano: planVersion, ciclo: '', flag_ativo: false, source: 'projection_rows' };
    existing.ciclo = existing.ciclo || normalizeCycle(readMappedField(row, 'cycle')) || normalizeCycle(planVersion);
    byVersion.set(planVersion, existing);
  }
  return Array.from(byVersion.values());
}

function chooseDefaultPlanVersion(options) {
  if (!options.length) {
    return '';
  }
  const stored = readStoredPlanVersion();
  if (stored && options.some((option) => option.versao_plano === stored)) {
    return stored;
  }
  const sorted = [...options].sort((left, right) => {
    const cycleDiff = String(right.ciclo || '').localeCompare(String(left.ciclo || ''));
    if (cycleDiff !== 0) {
      return cycleDiff;
    }
    return String(right.versao_plano || '').localeCompare(String(left.versao_plano || ''));
  });
  const activeLatestCycle = sorted.find((option) => option.flag_ativo);
  return (activeLatestCycle || sorted[0]).versao_plano;
}

function setPlanVersionOptions(options, rows = latestRows) {
  const inferred = inferPlanVersionsFromRows(rows);
  const byVersion = new Map();
  for (const option of inferred) {
    byVersion.set(option.versao_plano, option);
  }
  for (const option of options || []) {
    if (option.versao_plano) {
      byVersion.set(option.versao_plano, { ...byVersion.get(option.versao_plano), ...option });
    }
  }
  planVersionOptions = Array.from(byVersion.values()).sort((left, right) => {
    const cycleDiff = String(right.ciclo || '').localeCompare(String(left.ciclo || ''));
    if (cycleDiff !== 0) {
      return cycleDiff;
    }
    return String(right.versao_plano || '').localeCompare(String(left.versao_plano || ''));
  });
  if (!currentPlanVersion || !planVersionOptions.some((option) => option.versao_plano === currentPlanVersion)) {
    currentPlanVersion = chooseDefaultPlanVersion(planVersionOptions);
  }
  renderPlanVersionSelect();
}

function renderPlanVersionSelect() {
  if (!planVersionSelectEl) {
    return;
  }
  planVersionSelectEl.innerHTML = '';
  if (!planVersionOptions.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Sem versões disponíveis';
    planVersionSelectEl.append(option);
    planVersionSelectEl.disabled = true;
    return;
  }
  planVersionSelectEl.disabled = false;
  for (const planVersion of planVersionOptions) {
    const option = document.createElement('option');
    option.value = planVersion.versao_plano;
    const activeSuffix = planVersion.flag_ativo ? ' · ativa' : '';
    option.textContent = `${planVersion.versao_plano}${activeSuffix}`;
    planVersionSelectEl.append(option);
  }
  planVersionSelectEl.value = currentPlanVersion || '';
}

function filterRowsBySelectedPlanVersion(rows) {
  if (!currentPlanVersion) {
    return rows || [];
  }
  return (rows || []).filter((rawRow) => String(readMappedField(normalizeRow(rawRow), 'planVersion') || '') === currentPlanVersion);
}

function setStatus(message, { visible = debugMode } = {}) {
  statusEl.textContent = message;
  setElementVisible(statusEl, visible);
}

function getDocApi() {
  return window.grist?.docApi || window.grist?.raw?.docApi || null;
}

function normalizeRow(record) {
  return record?.fields ?? record ?? {};
}

function rowsFromColumnarTable(tableData) {
  const columns = Object.keys(tableData || {});
  if (!columns.length) {
    return [];
  }
  const rowCount = Array.isArray(tableData[columns[0]]) ? tableData[columns[0]].length : 0;
  return Array.from({ length: rowCount }, (_, index) => {
    const row = {};
    for (const column of columns) {
      row[column] = tableData[column]?.[index];
    }
    return row;
  });
}

function rowsFromTablePayload(payload) {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.map(normalizeRow);
  }
  if (Array.isArray(payload.records)) {
    return payload.records.map(normalizeRow);
  }
  if (payload.tableData && typeof payload.tableData === 'object') {
    return rowsFromColumnarTable(payload.tableData);
  }
  if (typeof payload === 'object') {
    const firstValue = Object.values(payload)[0];
    if (Array.isArray(firstValue)) {
      return rowsFromColumnarTable(payload);
    }
  }
  return [];
}

function readMappedField(row, logicalField) {
  const candidates = SOURCE_FIELD_MAP[logicalField] || [];
  for (const field of candidates) {
    if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
      return row[field];
    }
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const raw = String(value).trim();
  const normalized = raw.includes(',')
    ? (raw.includes('.') ? raw.replaceAll('.', '').replace(',', '.') : raw.replace(',', '.'))
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const numeric = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

function normalizePeriod(value) {
  if (!value) {
    return null;
  }
  const match = String(value).trim().toUpperCase().match(/^M(\d{1,2})$/);
  if (!match) {
    return null;
  }
  return `M${String(Number(match[1])).padStart(2, '0')}`;
}

function shiftPeriod(period, offset) {
  if (!period) {
    return null;
  }
  const baseIndex = Number(period.slice(1));
  if (!Number.isFinite(baseIndex)) {
    return null;
  }
  const targetIndex = baseIndex + (Number.isFinite(offset) ? offset : 0);
  if (targetIndex < 0 || targetIndex >= MONTH_FIELDS.length) {
    return null;
  }
  return `M${String(targetIndex).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatNumeric(value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="muted">—</span>';
  }
  const numeric = toNumber(value);
  if (Number.isInteger(numeric)) {
    return numberFormatter.format(numeric);
  }
  return decimalFormatter.format(numeric);
}

function formatMeasure(value) {
  if (currentBasis === 'cost') {
    return currencyFormatter.format(toNumber(value));
  }
  return formatNumeric(value);
}

function readMeasureValue(row) {
  const rawProposalQty = toNumber(readMappedField(row, 'proposalQty'));
  if (rawProposalQty <= 0) {
    return 0;
  }
  if (currentBasis === 'cost') {
    return toNumber(readMappedField(row, 'proposalCost'));
  }
  const explicitMil = readMappedField(row, 'proposalQtyMil');
  if (explicitMil !== null && explicitMil !== undefined && explicitMil !== '') {
    return toNumber(explicitMil);
  }
  return rawProposalQty / 1000;
}

function formatFlag(value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="muted">—</span>';
  }
  const normalized = toInteger(value);
  const kind = normalized === 1 ? 'ok' : 'warn';
  return `<span class="flag-pill ${kind}">${normalized === 1 ? '1' : '0'}</span>`;
}

function hasLatestOrderPeriod(row) {
  const value = readMappedField(row, 'latestOrderPeriod');
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function buildDisplayRows(rows) {
  const modeConfig = getModeConfig();
  const groups = new Map();
  const monthLabels = Object.fromEntries(MONTH_FIELDS.map((fieldId) => [fieldId, fieldId]));
  let skippedRows = 0;
  let excludedProposalRows = 0;
  let excludedProposalUnits = 0;

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    const sku = readMappedField(row, 'sku');
    const period = modeConfig.periodTransform(row);
    if (!sku || !period || !MONTH_FIELDS.includes(period)) {
      skippedRows += 1;
      continue;
    }

    const rawProposalQty = toNumber(readMappedField(row, 'proposalQty'));
    const measureValue = readMeasureValue(row);
    const isActionableProposal = rawProposalQty > 0;
    const bucketValue = isActionableProposal ? measureValue : 0;
    if (!isActionableProposal) {
      excludedProposalRows += 1;
      excludedProposalUnits += Math.max(rawProposalQty, 0);
    }

    const monthLabel = readMappedField(row, 'monthLabel');
    if (monthLabel) {
      monthLabels[period] = String(monthLabel);
    }

    const rowKey = String(sku);
    if (!groups.has(rowKey)) {
      groups.set(rowKey, {
        _rowKey: rowKey,
        id_produto: rowKey,
        descricao: readMappedField(row, 'description') || '',
        fornecedor: readMappedField(row, 'supplier') || '',
        categoria: readMappedField(row, 'category') || '',
        abc: readMappedField(row, 'abc') || '',
        custo_unit: toNumber(readMappedField(row, 'unitCost')) || 0,
        lote: toNumber(readMappedField(row, 'lot')) || 0,
        flag_validate: toInteger(readMappedField(row, 'validate')),
        latest_order_period: readMappedField(row, 'latestOrderPeriod') || '',
        total: 0,
        ...Object.fromEntries(MONTH_FIELDS.map((fieldId) => [fieldId, 0])),
      });
    }

    const grouped = groups.get(rowKey);
    grouped[period] += bucketValue;
    grouped.total += bucketValue;
    grouped.flag_validate = Math.max(grouped.flag_validate, toInteger(readMappedField(row, 'validate')));
    if (!grouped.descricao && readMappedField(row, 'description')) {
      grouped.descricao = readMappedField(row, 'description');
    }
    if (!grouped.fornecedor && readMappedField(row, 'supplier')) {
      grouped.fornecedor = readMappedField(row, 'supplier');
    }
    if (!grouped.categoria && readMappedField(row, 'category')) {
      grouped.categoria = readMappedField(row, 'category');
    }
    if (!grouped.abc && readMappedField(row, 'abc')) {
      grouped.abc = readMappedField(row, 'abc');
    }
    if (!grouped.latest_order_period && readMappedField(row, 'latestOrderPeriod')) {
      grouped.latest_order_period = readMappedField(row, 'latestOrderPeriod');
    }
  }

  const displayRows = Array.from(groups.values()).sort((left, right) => left.id_produto.localeCompare(right.id_produto));
  const actionableSkuCount = displayRows.filter((row) => toNumber(row.total) > 0).length;
  const totalRow = {
    _rowKey: '__total__',
    _rowType: 'total',
    id_produto: 'TOTAL GERAL',
    descricao: `${displayRows.length} SKUs`,
    fornecedor: '',
    categoria: '',
    abc: '',
    custo_unit: '',
    lote: '',
    flag_validate: '',
    latest_order_period: '',
    total: 0,
    ...Object.fromEntries(MONTH_FIELDS.map((fieldId) => [fieldId, 0])),
  };

  for (const row of displayRows) {
    for (const fieldId of MONTH_FIELDS) {
      totalRow[fieldId] += toNumber(row[fieldId]);
    }
    totalRow.total += toNumber(row.total);
  }

  return {
    displayRows: [...displayRows, totalRow],
    skuCount: actionableSkuCount,
    displayedSkuCount: displayRows.length,
    skippedRows,
    excludedProposalRows,
    excludedProposalUnits,
    totalUnits: totalRow.total,
    monthLabels,
  };
}

function textHeaderFilter(placeholder = 'Filtrar') {
  return {
    headerFilter: 'input',
    headerFilterFunc: 'like',
    headerFilterPlaceholder: placeholder,
  };
}

function listHeaderFilter() {
  return {
    headerFilter: 'list',
    headerFilterFunc: (headerValue, rowValue) => {
      if (headerValue === null || headerValue === undefined || headerValue === '') {
        return true;
      }
      return String(rowValue ?? '') === String(headerValue);
    },
    headerFilterParams: {
      valuesLookup: true,
      clearable: true,
      sort: 'asc',
    },
  };
}

function numericHeaderFilter(placeholder = '>=') {
  return {
    headerFilter: 'input',
    headerFilterFunc: (headerValue, rowValue) => {
      if (headerValue === null || headerValue === undefined || String(headerValue).trim() === '') {
        return true;
      }
      return toNumber(rowValue) >= toNumber(headerValue);
    },
    headerFilterPlaceholder: placeholder,
  };
}

function updateSummaryFromVisibleRows(rows) {
  const modeConfig = getModeConfig();
  const visibleRows = (rows || []).filter((row) => row && row._rowType !== 'total');
  const actionableVisibleRows = visibleRows.filter((row) => toNumber(row.total) > 0);
  const visibleUnits = visibleRows.reduce((sum, row) => sum + toNumber(row.total), 0);
  const basisConfig = getBasisConfig();
  const formattedTotal = currentBasis === 'cost' ? currencyFormatter.format(visibleUnits) : `${numberFormatter.format(visibleUnits)} ${basisConfig.shortLabel}`;
  summaryPillEl.textContent = `${modeConfig.toggleLabel} · ${basisConfig.label} · ${numberFormatter.format(actionableVisibleRows.length)} SKUs com pedido · ${formattedTotal}`;
}

function updateDiagnosticPanel(details) {
  if (!notesEl || !(forceDiagnosticPanel || debugMode)) {
    return;
  }
  const lines = [
    `Build: ${diagnosticBuild}`,
    `Source label: ${details.sourceLabel || latestSourceLabel || 'n/a'}`,
    `Current Grist table id: ${currentTableId || 'n/a'}`,
    `Mode: ${currentMode}`,
    `Basis: ${currentBasis}`,
    `Selected plan version: ${currentPlanVersion || 'n/a'}`,
    `Plan options: ${planVersionOptions.map((option) => `${option.versao_plano}${option.flag_ativo ? ' [ativo]' : ''}`).join(' | ') || 'n/a'}`,
    `Rows received: ${numberFormatter.format(details.rowsReceived ?? 0)}`,
    `Rows after selected-version filter: ${numberFormatter.format(details.filteredRows ?? 0)}`,
    `Rows with proposta_pedido_qtd > 0: ${numberFormatter.format(details.positiveRows ?? 0)}`,
    `Distinct SKUs with positive proposals: ${numberFormatter.format(details.positiveSkuCount ?? 0)}`,
    `Display rows including total: ${numberFormatter.format(details.displayRows ?? 0)}`,
    `Rendered SKUs: ${numberFormatter.format(details.displayedSkuCount ?? 0)}`,
    `SKUs with positive rendered total: ${numberFormatter.format(details.skuCount ?? 0)}`,
    `Total rendered measure: ${currentBasis === 'cost' ? currencyFormatter.format(details.totalUnits ?? 0) : `${numberFormatter.format(details.totalUnits ?? 0)} un.`}`,
    `Skipped rows: ${numberFormatter.format(details.skippedRows ?? 0)}`,
    `Rows excluded because proposta <= 0: ${numberFormatter.format(details.excludedProposalRows ?? 0)}`,
    `First row keys: ${details.firstRowKeys || 'n/a'}`,
    `Error: ${details.error || 'none'}`,
  ];
  notesEl.innerHTML = `<strong>Diagnóstico técnico temporário.</strong><pre style="white-space: pre-wrap; margin: 0.5rem 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.35;">${escapeHtml(lines.join('\n'))}</pre>`;
  setElementVisible(notesEl, true);
}

function refreshVisibleSummaryFromTable() {
  if (!table) {
    return;
  }
  updateSummaryFromVisibleRows(table.getRows('active').map((row) => row.getData()));
}

function buildColumns(monthLabels) {
  const baseColumns = [
    {
      title: 'SKU',
      field: 'id_produto',
      frozen: true,
      width: 128,
      resizable: true,
      cssClass: 'frozen-meta',
      formatter: (cell) => escapeHtml(cell.getValue() || '—'),
      ...textHeaderFilter('SKU'),
    },
    {
      title: 'Descrição',
      field: 'descricao',
      frozen: true,
      width: 340,
      minWidth: 220,
      resizable: true,
      cssClass: 'frozen-meta wrap-cell',
      formatter: (cell) => escapeHtml(cell.getValue() || '—'),
      ...textHeaderFilter('Descrição'),
    },
    {
      title: 'Fornecedor',
      field: 'fornecedor',
      frozen: true,
      width: 200,
      minWidth: 160,
      resizable: true,
      cssClass: 'frozen-meta wrap-cell',
      formatter: (cell) => escapeHtml(cell.getValue() || '—'),
      ...listHeaderFilter(),
    },
    { title: 'Categoria', field: 'categoria', width: 170, minWidth: 140, resizable: true, formatter: (cell) => escapeHtml(cell.getValue() || '—'), ...listHeaderFilter() },
    { title: 'ABC', field: 'abc', width: 86, hozAlign: 'center', resizable: true, formatter: (cell) => escapeHtml(cell.getValue() || '—'), ...listHeaderFilter() },
    { title: 'Custo un.', field: 'custo_unit', width: 118, hozAlign: 'right', resizable: true, cssClass: 'numeric-cell', formatter: (cell) => formatNumeric(cell.getValue()), ...numericHeaderFilter() },
    { title: 'Lote', field: 'lote', width: 96, hozAlign: 'right', resizable: true, cssClass: 'numeric-cell', formatter: (cell) => formatNumeric(cell.getValue()), ...numericHeaderFilter() },
    { title: 'Validar', field: 'flag_validate', width: 96, hozAlign: 'center', resizable: true, formatter: (cell) => formatFlag(cell.getValue()), ...listHeaderFilter() },
    { title: 'Últ. pedido', field: 'latest_order_period', width: 120, hozAlign: 'center', resizable: true, formatter: (cell) => escapeHtml(cell.getValue() || '—'), ...listHeaderFilter() },
    { title: `Total (${getBasisConfig().shortLabel})`, field: 'total', width: 130, hozAlign: 'right', resizable: true, cssClass: 'numeric-cell', formatter: (cell) => formatMeasure(cell.getValue()), ...numericHeaderFilter() },
  ];

  const monthColumns = MONTH_FIELDS.map((fieldId) => ({
    title: `${fieldId}<br><span class="muted">${escapeHtml(monthLabels[fieldId] || fieldId)}</span>`,
    field: fieldId,
    width: 108,
    minWidth: 90,
    resizable: true,
    hozAlign: 'right',
    cssClass: 'numeric-cell',
    headerSort: false,
    formatter: (cell) => formatMeasure(cell.getValue()),
    ...numericHeaderFilter(),
  }));

  return [...baseColumns, ...monthColumns];
}

function ensureTable(columns) {
  if (!table) {
    table = new Tabulator('#summary-table', {
      data: [],
      columns,
      layout: 'fitDataFill',
      responsiveLayout: false,
      height: '68vh',
      movableColumns: false,
      resizableColumns: true,
      selectableRows: false,
      placeholder: 'Nenhuma linha encontrada na fonte de dados.',
      rowFormatter: (row) => {
        const element = row.getElement();
        if (row.getData()?._rowType === 'total') {
          element.classList.add('total-row');
        } else {
          element.classList.remove('total-row');
        }
      },
    });
    table.on('dataFiltered', refreshVisibleSummaryFromTable);
    const tableEl = document.getElementById('summary-table');
    tableEl?.addEventListener('change', () => setTimeout(refreshVisibleSummaryFromTable, 0));
    tableEl?.addEventListener('input', () => setTimeout(refreshVisibleSummaryFromTable, 0));
    tableEl?.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') {
        setTimeout(refreshVisibleSummaryFromTable, 0);
      }
    });
    return;
  }
  table.setColumns(columns);
}

async function renderFromRows(rows, sourceLabel) {
  latestRows = rows;
  latestSourceLabel = sourceLabel;
  setPlanVersionOptions(planVersionOptions, rows);
  const filteredRows = filterRowsBySelectedPlanVersion(rows);
  const modeConfig = getModeConfig();
  const { displayRows, skuCount, displayedSkuCount, skippedRows, excludedProposalRows, excludedProposalUnits, totalUnits, monthLabels } = buildDisplayRows(filteredRows);
  const positiveRows = filteredRows.filter((rawRow) => toNumber(readMappedField(normalizeRow(rawRow), 'proposalQty')) > 0);
  const positiveSkuCount = new Set(positiveRows.map((rawRow) => String(readMappedField(normalizeRow(rawRow), 'sku') || ''))).size;
  updateDiagnosticPanel({
    sourceLabel,
    rowsReceived: rows.length,
    filteredRows: filteredRows.length,
    positiveRows: positiveRows.length,
    positiveSkuCount,
    displayRows: displayRows.length,
    skuCount,
    displayedSkuCount,
    skippedRows,
    excludedProposalRows,
    totalUnits,
    firstRowKeys: rows[0] ? Object.keys(normalizeRow(rows[0])).slice(0, 30).join(', ') : '',
  });
  ensureTable(buildColumns(monthLabels));
  await table.replaceData(displayRows);
  setElementVisible(tableShellEl, true);
  setElementVisible(summaryPillEl, true);
  updateSummaryFromVisibleRows(displayRows);
  setStatus(
    `Fonte: ${currentTableId || SOURCE_TABLE_ID}. Versão: ${currentPlanVersion || 'todas'}. ${numberFormatter.format(rows.length)} linhas recebidas, ${numberFormatter.format(filteredRows.length)} linhas na versão, ${numberFormatter.format(displayedSkuCount)} SKUs renderizados, ${numberFormatter.format(skuCount)} SKUs com pedido positivo, ${numberFormatter.format(skippedRows)} linhas fora da janela M00-M12, ${numberFormatter.format(excludedProposalRows)} linhas sem proposta positiva excluídas, total excluído de ${numberFormatter.format(excludedProposalUnits)} un. Campos usados: ${modeConfig.fieldsNote}`,
    { visible: forceDiagnosticPanel || debugMode }
  );
}

async function fetchRowsFromDocApi(tableName) {
  const docApi = getDocApi();
  if (!docApi?.fetchTable || !tableName) {
    return [];
  }
  const payload = await docApi.fetchTable(tableName);
  return rowsFromTablePayload(payload);
}

async function fetchRowsFromSelectedTable() {
  if (!window.grist?.fetchSelectedTable) {
    return [];
  }
  const payload = await window.grist.fetchSelectedTable({ format: 'rows' });
  return rowsFromTablePayload(payload);
}

async function fetchPlanVersionOptions() {
  const rows = await fetchRowsFromDocApi(PLAN_VERSION_TABLE_ID);
  return rows
    .filter((row) => row?.versao_plano)
    .map((row) => ({
      versao_plano: String(row.versao_plano),
      ciclo: normalizeCycle(row.ciclo_normalizado || row.ciclo || row.versao_plano),
      flag_ativo: row.flag_ativo === true || row.flag_ativo === 1 || row.flag_ativo === '1' || row.flag_ativo === 'true',
      source: PLAN_VERSION_TABLE_ID,
    }));
}

function persistStateInUrl() {
  const nextParams = new URLSearchParams(window.location.search);
  nextParams.set('mode', currentMode);
  nextParams.set('basis', currentBasis);
  const nextUrl = `${window.location.pathname}?${nextParams.toString()}${window.location.hash || ''}`;
  window.history.replaceState({}, '', nextUrl);
}

async function applyMode(nextMode) {
  if (!MODE_CONFIG[nextMode]) {
    return;
  }
  currentMode = nextMode;
  applyModeUi();
  persistStateInUrl();
  await refreshRows(`mode changed to ${nextMode}`);
}

async function applyBasis(nextBasis) {
  if (!MEASURE_BASIS_CONFIG[nextBasis]) {
    return;
  }
  currentBasis = nextBasis;
  applyModeUi();
  persistStateInUrl();
  await refreshRows(`basis changed to ${nextBasis}`);
}

async function refreshRows(reason) {
  try {
    setStatus(`Carregando dados (${reason})...`, { visible: debugMode });

    if (!planVersionOptions.length) {
      try {
        setPlanVersionOptions(await fetchPlanVersionOptions(), latestRows);
      } catch (error) {
        console.warn('Não foi possível carregar versões do plano; inferindo a partir da projeção.', error);
      }
    }

    const fromSourceTable = await fetchRowsFromDocApi(SOURCE_TABLE_ID);
    if (fromSourceTable.length) {
      currentTableId = SOURCE_TABLE_ID;
      await renderFromRows(fromSourceTable, 'grist.docApi.fetchTable(source table)');
      return;
    }

    const fromSelectedTable = await fetchRowsFromSelectedTable();
    if (fromSelectedTable.length) {
      await renderFromRows(fromSelectedTable, 'grist.fetchSelectedTable');
      return;
    }

    if (latestRows.length) {
      await renderFromRows(latestRows, 'cached onRecords payload');
      return;
    }

    setElementVisible(tableShellEl, false);
    setElementVisible(summaryPillEl, false);
    setStatus('Nenhuma linha foi retornada pela fonte de dados.', { visible: true });
  } catch (error) {
    setElementVisible(tableShellEl, false);
    setElementVisible(summaryPillEl, false);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Não foi possível carregar os dados: ${message}`, { visible: true });
    updateDiagnosticPanel({ error: message });
    console.error(error);
  }
}

for (const button of modeToggleButtons) {
  button.addEventListener('click', () => {
    void applyMode(button.dataset.modeToggle);
  });
}

for (const button of basisToggleButtons) {
  button.addEventListener('click', () => {
    void applyBasis(button.dataset.basisToggle);
  });
}

planVersionSelectEl?.addEventListener('change', () => {
  currentPlanVersion = planVersionSelectEl.value;
  writeStoredPlanVersion(currentPlanVersion);
  void refreshRows('plan version change');
});

if (window.grist) {
  window.grist.ready({ requiredAccess: 'read table', columns: REQUESTED_COLUMNS });

  window.grist.onRecords((records) => {
    latestRows = Array.isArray(records) ? records.map(normalizeRow) : [];
    void refreshRows('onRecords payload received; fetching full source table');
  }, { format: 'rows' });

  window.grist.on('message', (message) => {
    if (message?.tableId) {
      currentTableId = message.tableId;
    }
    if (message?.tableId || message?.dataChange || message?.mappingsChange) {
      void refreshRows(message?.tableId ? 'table change' : 'data change');
    }
  });

  void refreshRows('initial load');
} else {
  setStatus('Este widget precisa ser aberto dentro do Grist.', { visible: true });
}
