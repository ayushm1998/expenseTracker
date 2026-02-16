import './styles.css';

async function fetchJson(url, options) {
  const base = import.meta.env.VITE_API_BASE_URL || '';
  const apiKey = (() => {
    try {
      return String(localStorage.getItem('apiKey') || '').trim();
    } catch {
      return '';
    }
  })();
  const headers = {
    ...(options?.headers || {}),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
  const res = await fetch(`${base}${url}`, { ...options, headers });
  return res.json();
}

async function fetchJsonOrThrow(url, options) {
  const res = await fetchJson(url, options);
  if (res?.ok === false) throw new Error(res?.error || 'Request failed');
  return res;
}

function buildEditTextFromForm(baseText, opts) {
  const cleaned = String(baseText || '').trim();
  const tokens = [];
  if (opts?.card) tokens.push(`card:${opts.card}`);
  if (opts?.paidBy === 'me') tokens.push('paidby:me');
  if (opts?.paidBy === 'roommate') {
    tokens.push('paidby:roommate');
    // If roommate is selected, encode who it was as other:<name> when we know it.
    if (opts?.paidByRoommateName) tokens.push(`other:${opts.paidByRoommateName}`);
  }

  if (opts?.splitOn) {
    if (opts?.splitType === 'ratio' && opts?.splitRatio) {
      tokens.push(`split:${opts.splitRatio}`);
    } else {
      tokens.push('split:equal');
    }

    // Primary person
    if (opts?.splitWith && opts?.splitWith !== 'other') {
      tokens.push(`other:${opts.splitWith}`);
    } else if (opts?.splitWith === 'other' && opts?.splitWithName) {
      tokens.push(`other:${opts.splitWithName}`);
    }

    // Additional people
    const more = normalizePeopleList(opts?.splitWithMore);
    for (const p of more) tokens.push(`other:${p}`);
  }

  const occurredOn = String(opts?.occurredOn || '').trim();
  if (occurredOn) tokens.push(occurredOn);
  const meta = tokens.length ? ` ${tokens.join(' ')}` : '';
  return `${cleaned}${meta}`.trim();
}

function openExpenseEditor(expense, { onSave } = {}) {
  const modal = document.getElementById('editModal');
  if (!modal) return;

  modal.dataset.expenseId = expense.id;

  const baseTextEl = document.getElementById('editBaseText');
  const occurredOnEl = document.getElementById('editOccurredOn');
  const cardEl = document.getElementById('editCard');
  const paidByEl = document.getElementById('editPaidBy');
  const splitEl = document.getElementById('editSplit');
  const splitTypeEl = document.getElementById('editSplitType');
  const splitRatioEl = document.getElementById('editSplitRatio');
  const splitWithEl = document.getElementById('editSplitWith');
  const splitWithNameEl = document.getElementById('editSplitWithName');
  const splitWithMoreEl = document.getElementById('editSplitWithMore');
  const previewEl = document.getElementById('editPreview');
  const statusEl = document.getElementById('editStatus');

  if (
    !baseTextEl ||
    !occurredOnEl ||
    !cardEl ||
  !paidByEl ||
    !splitEl ||
    !splitTypeEl ||
    !splitRatioEl ||
    !splitWithEl ||
    !splitWithNameEl ||
    !splitWithMoreEl ||
    !previewEl ||
    !statusEl
  ) {
    return;
  }

  // Seed form values from record.
  baseTextEl.value = expense.rawText || expense.note || '';
  occurredOnEl.value = expense.occurredOn || '';
  cardEl.value = expense.card || '';

  // paidBy is stored as me|roommate in DB
  paidByEl.value = expense.paidBy === 'roommate' ? 'roommate' : 'me';

  splitEl.checked = expense.splitType && expense.splitType !== 'none';
  splitTypeEl.value = expense.splitType === 'ratio' ? 'ratio' : 'equal';
  splitRatioEl.value = '';

  // We only store the primary party on the expense row.
  // If otherParty exists, use the explicit name field; otherwise leave it blank.
  splitWithEl.value = expense.otherParty ? 'other' : '';
  splitWithNameEl.value = expense.otherParty || '';
  splitWithMoreEl.value = '';

  const toggleSplit = () => {
    const on = splitEl.checked;
    splitTypeEl.style.display = on ? 'block' : 'none';
    splitWithEl.style.display = on ? 'block' : 'none';
    splitWithMoreEl.style.display = on ? 'block' : 'none';
    if (!on) {
      splitWithNameEl.style.display = 'none';
      splitRatioEl.style.display = 'none';
      splitWithNameEl.value = '';
      splitWithMoreEl.value = '';
      splitRatioEl.value = '';
      return;
    }
    splitWithNameEl.style.display = splitWithEl.value === 'other' ? 'block' : 'none';
    splitRatioEl.style.display = splitTypeEl.value === 'ratio' ? 'block' : 'none';
    if (splitWithEl.value !== 'other') splitWithNameEl.value = '';
    if (splitTypeEl.value !== 'ratio') splitRatioEl.value = '';
  };

  const updatePreview = () => {
    statusEl.textContent = '';
    const text = buildEditTextFromForm(baseTextEl.value, {
      occurredOn: occurredOnEl.value,
      card: cardEl.value,
      paidBy: paidByEl.value,
      splitOn: splitEl.checked,
      splitType: splitTypeEl.value,
      splitRatio: splitRatioEl.value.trim(),
      splitWith: splitWithEl.value,
      splitWithName: splitWithNameEl.value.trim(),
      splitWithMore: splitWithMoreEl.value,
    });
    previewEl.textContent = text;
  };

  paidByEl.onchange = () => {
    updatePreview();
  };
  splitEl.onchange = () => {
    toggleSplit();
    updatePreview();
  };
  splitTypeEl.onchange = () => {
    toggleSplit();
    updatePreview();
  };
  splitWithEl.onchange = () => {
    toggleSplit();
    updatePreview();
  };
  splitWithNameEl.oninput = updatePreview;
  splitWithMoreEl.oninput = updatePreview;
  splitRatioEl.oninput = updatePreview;
  baseTextEl.oninput = updatePreview;
  occurredOnEl.onchange = updatePreview;
  cardEl.onchange = updatePreview;

  // Wire buttons
  const closeBtn = document.getElementById('editClose');
  const cancelBtn = document.getElementById('editCancel');
  const saveBtn = document.getElementById('editSave');

  const close = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };
  if (closeBtn) closeBtn.onclick = close;
  if (cancelBtn) cancelBtn.onclick = close;

  if (saveBtn) {
    saveBtn.onclick = async () => {
      try {
        saveBtn.disabled = true;
        statusEl.textContent = 'Saving…';
        const text = previewEl.textContent;
        const occurredOn = occurredOnEl.value;
        await onSave?.({ text, occurredOn });
        close();
      } catch (err) {
        statusEl.textContent = err?.message || String(err);
      } finally {
        saveBtn.disabled = false;
      }
    };
  }

  toggleSplit();
  updatePreview();

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function formatMoney(currency, amount) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeToQuery(range) {
  const now = new Date();

  if (range === 'month') {
    const [yStr, mStr] = String(selectedMonth || '').split('-');
    const y = Number(yStr);
    const m0 = Number(mStr) - 1;
    if (Number.isFinite(y) && Number.isFinite(m0) && m0 >= 0 && m0 <= 11) {
      const start = new Date(y, m0, 1);
      const end = new Date(y, m0 + 1, 0);
      return { from: toYmd(start), to: toYmd(end) };
    }
  }

  if (range === 'custom') {
    return {
      ...(customFrom ? { from: customFrom } : {}),
      ...(customTo ? { to: customTo } : {}),
    };
  }

  if (range === 'week') {
    const dow = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    return { from: toYmd(start), to: toYmd(now) };
  }
  if (range === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: toYmd(start), to: toYmd(now) };
  }
  return {};
}

let selectedRange = 'month';

// For the Month view, allow choosing any month.
let selectedMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

// Expenses tab: independent month picker (so Expenses isn't tied to Summary's month/range).
let expensesMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
let expensesMonthMode = 'all'; // 'all' | 'month'

function expensesMonthToQuery() {
  if (expensesMonthMode !== 'month') return {};
  const [yStr, mStr] = String(expensesMonth || '').split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return {};

  const from = `${yStr}-${String(m).padStart(2, '0')}-01`;
  const next = new Date(y, m, 1);
  const to = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  return { from, to };
}

// For the Custom view, user provides a date range.
let customFrom = '';
let customTo = '';

function bucketByCategory(expenses) {
  const byCat = new Map();
  for (const e of expenses) {
    const cat = (e.category || '').trim().toLowerCase() || 'misc';
    byCat.set(cat, (byCat.get(cat) || 0) + Number(e.amount || 0));
  }
  return Array.from(byCat.entries())
    .map(([category, total]) => ({ category, total }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

function niceCategoryLabel(cat) {
  if (cat === 'misc') return 'Misc';
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function nicePersonLabel(name) {
  const s = String(name || '').trim();
  if (!s) return 'Someone';
  return s
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      // Keep acronyms like "USA" or "NYC".
      if (w.toUpperCase() === w && /[A-Z]/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function normalizePeopleList(raw) {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const byKey = new Map();
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, nicePersonLabel(p));
  }
  return Array.from(byKey.values());
}

function addRecentPerson(name) {
  const clean = nicePersonLabel(String(name || '').trim());
  if (!clean || clean === 'Someone') return;
  try {
    const key = 'recentPeople';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const next = [clean, ...existing.filter((x) => nicePersonLabel(x) !== clean)].slice(0, 12);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function getRecentPeople() {
  try {
    const existing = JSON.parse(localStorage.getItem('recentPeople') || '[]');
    if (!Array.isArray(existing)) return [];
    return existing.map(nicePersonLabel).filter((x) => x && x !== 'Someone');
  } catch {
    return [];
  }
}

function getConfig() {
  const defaults = {
    roommates: [],
    paymentMethods: ['Amex', 'Citi', 'Apple Card', 'BofA', 'BoFA Debit', 'Chase', 'Zolve', 'Cash'],
  };
  try {
    const raw = JSON.parse(localStorage.getItem('appConfig') || 'null');
    if (!raw || typeof raw !== 'object') return defaults;
    return {
      roommates: Array.isArray(raw.roommates) && raw.roommates.length ? raw.roommates.map(nicePersonLabel) : defaults.roommates,
      paymentMethods:
        Array.isArray(raw.paymentMethods) && raw.paymentMethods.length
          ? raw.paymentMethods.map((s) => String(s || '').trim()).filter(Boolean)
          : defaults.paymentMethods,
    };
  } catch {
    return defaults;
  }
}

function setConfig(next) {
  const clean = {
    roommates: Array.isArray(next?.roommates) ? next.roommates.map(nicePersonLabel).filter(Boolean) : [],
    paymentMethods: Array.isArray(next?.paymentMethods) ? next.paymentMethods.map((s) => String(s || '').trim()).filter(Boolean) : [],
  };
  localStorage.setItem('appConfig', JSON.stringify(clean));
  return clean;
}

function parseCommaList(s) {
  return String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function renderSettingsLists(cfg) {
  const roomList = document.getElementById('cfgRoommateList');
  const cardList = document.getElementById('cfgCardList');
  if (roomList) {
    roomList.innerHTML = (cfg.roommates || [])
      .map(
        (name) => `
        <div class="cfg-item">
          <span>${nicePersonLabel(name)}</span>
          <button type="button" class="btn-secondary cfg-del" data-kind="roommate" data-value="${encodeURIComponent(
            name
          )}">Delete</button>
        </div>`
      )
      .join('');
  }
  if (cardList) {
    cardList.innerHTML = (cfg.paymentMethods || [])
      .map(
        (label) => `
        <div class="cfg-item">
          <span>${String(label)}</span>
          <button type="button" class="btn-secondary cfg-del" data-kind="card" data-value="${encodeURIComponent(
            label
          )}">Delete</button>
        </div>`
      )
      .join('');
  }
}

function setPersonSelectOptions(selectEl, people) {
  if (!selectEl) return;
  const keep = new Set(['', 'other']);
  for (const opt of Array.from(selectEl.querySelectorAll('option'))) {
    if (!keep.has(opt.value)) opt.remove();
  }
  const existingVals = new Set(Array.from(selectEl.querySelectorAll('option')).map((o) => o.value));
  for (const p of people) {
    const val = nicePersonLabel(p);
    if (!val || existingVals.has(val) || val === 'Someone') continue;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    selectEl.insertBefore(opt, selectEl.querySelector('option[value="other"]'));
    existingVals.add(val);
  }
}

function setRoommateSelectOptions(selectEl, roommates) {
  if (!selectEl) return;
  const keep = new Set(['', 'other']);
  for (const opt of Array.from(selectEl.querySelectorAll('option'))) {
    if (!keep.has(opt.value)) opt.remove();
  }
  const existingVals = new Set(Array.from(selectEl.querySelectorAll('option')).map((o) => o.value));
  for (const r of roommates || []) {
    const val = nicePersonLabel(r);
    if (!val || existingVals.has(val) || val === 'Someone') continue;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    selectEl.appendChild(opt);
    existingVals.add(val);
  }
}

async function deleteExpense(id) {
  return fetchJsonOrThrow(`/api/expenses/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

async function updateExpense(id, payload) {
  return fetchJsonOrThrow(`/api/expenses/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function refreshAll() {
  // Keep it simple: re-run the main loader by reloading.
  // (This codebase renders lots of derived UI in one pass.)
  window.location.reload();
}

function renderPieChart(buckets, currency) {
  if (!buckets.length) return '<div class="muted">No data yet for this range.</div>';

  const total = buckets.reduce((s, b) => s + b.total, 0);
  if (total <= 0) return '<div class="muted">No data yet for this range.</div>';

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 70;

  const colors = ['#7c5cff', '#2dd4bf', '#f97316', '#22c55e', '#e11d48', '#60a5fa', '#a78bfa'];

  let angle = 0;
  const slices = buckets
    .map((b, i) => {
      const pct = b.total / total;
      const start = angle;
      const end = angle + pct * 360;
      angle = end;
      const color = colors[i % colors.length];
      const label = `${niceCategoryLabel(b.category)} — ${formatMoney(currency, b.total)} (${Math.round(pct * 100)}%)`;
      return `<path d="${arcPath(cx, cy, r, start, end)}" fill="${color}" opacity="0.95" title="${label}"></path>`;
    })
    .join('');

  const legend = buckets
    .slice(0, 8)
    .map((b, i) => {
      const color = colors[i % colors.length];
      return `
        <div class="legend-row">
          <span class="legend-dot" style="background:${color}"></span>
          <span class="legend-name">${niceCategoryLabel(b.category)}</span>
          <span class="legend-val">${formatMoney(currency, b.total)}</span>
        </div>
      `;
    })
    .join('');

  return `
    <div class="pie-wrap">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Category spending pie chart">
        ${slices}
        <circle cx="${cx}" cy="${cy}" r="38" fill="rgba(11,16,32,.92)" />
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="rgba(231,236,255,.95)" font-size="12" font-weight="800">Total</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="rgba(231,236,255,.95)" font-size="12">${formatMoney(currency, total)}</text>
      </svg>
      <div class="legend">
        ${legend}
      </div>
    </div>
  `;
}

function renderShell() {
  document.querySelector('#app').innerHTML = `
    <main class="container">
      <header class="header">
        <h1>Expense Tracker</h1>
        <p class="sub">Type a WhatsApp/SMS-style message and it’ll add an expense.</p>
      </header>

      <nav class="card" style="padding:10px;">
        <div class="row" style="justify-content:space-between;align-items:center;gap:10px;">
          <div class="row" style="gap:10px;flex-wrap:wrap;">
            <button id="tabSummary" type="button" class="chip active">Summary</button>
            <button id="tabExpenses" type="button" class="chip">Expenses</button>
            <button id="tabMoney" type="button" class="chip">Money</button>
            <button id="tabSettings" type="button" class="chip">Settings</button>
          </div>
        </div>
      </nav>

      <div id="panelMoney" style="display:none;">
      <section class="card">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div style="font-weight:800;">Money</div>
        </div>
        <div id="moneyTools" style="margin-top:10px;">
          <form id="ledgerForm" class="form">
            <label for="ledgerText">Earnings / Savings / Investments / Liabilities</label>
            <input id="ledgerText" name="ledgerText" type="text" autocomplete="off" placeholder="e.g. salary 5000" required />
            <div class="row">
              <select id="ledgerType" name="ledgerType" aria-label="Ledger type">
                <option value="income">Income</option>
                <option value="transfer">Savings transfer</option>
                <option value="investment">Investment</option>
                <option value="liability">Liability</option>
              </select>
              <input id="ledgerOccurredOn" name="ledgerOccurredOn" type="date" />
              <button type="submit">Add</button>
            </div>
            <p class="muted" style="margin-top:8px;font-size:12px;">
              Optional meta: <code>account:savings</code>, <code>asset:vti</code>, <code>liability:loan</code>
            </p>
            <p id="ledgerStatus" class="status"></p>
          </form>

          <div style="height:12px;"></div>

          <form id="recvForm" class="form">
            <label for="recvAmount">Borrow/Lend tracker (keeps remaining balance)</label>
            <div class="row">
              <select id="recvAction" aria-label="Action">
                <option value="took">I took from</option>
                <option value="gave">I gave to</option>
                <option value="return">I returned to</option>
                <option value="got">I got back from</option>
              </select>
              <input id="recvPerson" type="text" placeholder="Person (e.g. kevin)" class="grow" />
              <input id="recvAmount" type="number" placeholder="Amount" inputmode="decimal" />
              <button type="submit">Add</button>
            </div>
            <p id="recvStatus" class="status"></p>
          </form>

          <div class="muted" style="margin-top:8px;font-size:12px;" id="receivables"></div>
        </div>
      </section>

      <section class="grid">
        <div class="card">
          <div class="card-head">
            <h2>Reimbursements</h2>
            <div class="card-head-right">
              <select id="partyFilter" name="partyFilter" aria-label="Filter by person">
                <option value="">All people</option>
              </select>
            </div>
          </div>
          <div class="muted" id="reimbBalance" style="margin-top:10px;font-size:12px;"></div>
          <div id="reimbList" class="expenses" style="margin-top:10px;"></div>
        </div>
      </section>
      </div>

      <div id="panelSettings" style="display:none;">
      <section class="card">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div style="font-weight:800;">Settings</div>
        </div>

        <div style="margin-top:12px;" class="muted">
          <div style="font-weight:700;">Access key (for private hosting)</div>
          <div style="font-size:12px;margin-top:4px;">If your server is protected, paste your key here once. Stored locally in this browser.</div>
          <div class="row" style="margin-top:8px;">
            <input id="apiKey" type="password" placeholder="API key" class="grow" autocomplete="off" />
            <button id="apiKeySave" type="button">Save</button>
            <button id="apiKeyClear" type="button" class="btn-secondary">Clear</button>
          </div>
          <div id="apiKeyStatus" class="status" style="margin-top:6px;"></div>
        </div>

        <hr style="margin:14px 0;border:0;border-top:1px solid rgba(255,255,255,.08);" />

        <div style="margin-top:12px;" class="muted">
          <div class="row" style="align-items:flex-start;gap:14px;flex-wrap:wrap;">
            <div style="flex:1 1 320px;min-width:280px;">
              <div style="font-weight:700;">Roommates / people</div>
              <div id="cfgRoommateList" style="margin-top:8px;"></div>
              <div class="row" style="margin-top:10px;">
                <input id="cfgRoommates" type="text" placeholder="Add names (comma-separated)" class="grow" />
                <button id="cfgSave" type="button">Add</button>
              </div>
            </div>

            <div style="flex:1 1 320px;min-width:280px;">
              <div style="font-weight:700;">Payment methods / cards</div>
              <div id="cfgCardList" style="margin-top:8px;"></div>
              <div class="row" style="margin-top:10px;">
                <input id="cfgCards" type="text" placeholder="Add methods (comma-separated)" class="grow" />
              </div>
            </div>
          </div>

          <div class="row" style="margin-top:12px;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <button id="cfgReset" type="button" class="btn-secondary">Reset defaults</button>
            <div id="cfgStatus" class="status"></div>
          </div>
        </div>

        <div class="muted" style="margin-top:12px;font-size:12px;">
          This only affects the UI (stored locally in your browser).
        </div>
      </section>
      </div>

      <div id="panelExpenses" style="display:none;">
      <section class="card">
        <form id="ingestForm" class="form">
          <label for="text">Message</label>
          <input id="text" name="text" type="text" autocomplete="off" placeholder="e.g. food 250 chai" required />
          <div class="row">
            <input id="occurredOn" name="occurredOn" type="date" />
            <select id="card" name="card" aria-label="Card">
              <option value="">Card</option>
              <option value="amex">Amex</option>
              <option value="citi">Citi</option>
              <option value="apple">Apple Card</option>
              <option value="bofa">BofA</option>
              <option value="bofa-debit">BoFA Debit</option>
              <option value="chase">Chase</option>
              <option value="zolve">Zolve</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div class="row" style="margin-top:8px;">
            <select id="paidBy" name="paidBy" aria-label="Paid by">
              <option value="me">I paid</option>
              <option value="roommate">Roommate paid</option>
            </select>

            <select id="paidByRoommateName" name="paidByRoommateName" aria-label="Which roommate?" style="display:none;">
              <option value="">Which roommate?</option>
            </select>

            <div class="toggle-group" id="paidForMeGroup">
              <label class="toggle" for="paidForMe" title="Someone else paid, but this is 100% your expense (you owe them the full amount).">
                <input id="paidForMe" name="paidForMe" type="checkbox" />
                <span class="toggle-ui"></span>
                <span class="toggle-text">Paid for me</span>
              </label>
            </div>

            <div class="toggle-group" id="forOtherGroup">
              <label class="toggle" for="forOther" title="You paid the full amount for someone else (your share becomes 0).">
                <input id="forOther" name="forOther" type="checkbox" />
                <span class="toggle-ui"></span>
                <span class="toggle-text">For someone</span>
              </label>
              <select id="forOtherPerson" name="forOtherPerson" aria-label="Who was it for?" style="display:none;">
                <option value="">Who?</option>
                <option value="other">Other…</option>
              </select>
              <input id="forOtherName" name="forOtherName" type="text" placeholder="Type a name" class="grow" style="display:none;" />
            </div>
          </div>

          <div class="row" style="margin-top:8px;">
            <label class="toggle" for="split" id="splitToggle">
              <input id="split" name="split" type="checkbox" />
              <span class="toggle-ui"></span>
              <span class="toggle-text">Split</span>
            </label>
            <select id="splitWith" name="splitWith" aria-label="Split with" style="display:none;">
              <option value="">With…</option>
              <option value="me">With me</option>
              <option value="other">With someone else</option>
            </select>
            <input id="splitWithName" name="splitWithName" type="text" placeholder="Who are you splitting with?" class="grow" style="display:none;" />
            <input id="splitWithMore" name="splitWithMore" type="text" placeholder="More people (comma-separated names)" class="grow" style="display:none;" />
            <input id="splitRatio" name="splitRatio" type="text" placeholder="50/50" style="display:none;" />
          </div>
          <div class="row" style="margin-top:10px;justify-content:flex-end;">
            <button type="submit">Add</button>
          </div>
          <p id="status" class="status"></p>
        </form>
      </section>

      <section class="grid">
        <div class="card span-2" data-card="expenses">
          <div class="card-head">
            <h2>Expenses</h2>
            <div class="card-head-right">
              <select id="expensesMonthMode" aria-label="Expenses range">
                <option value="all">All time</option>
                <option value="month">Month</option>
              </select>
              <input id="expensesMonth" name="expensesMonth" type="month" aria-label="Expenses month" style="display:none;" />
              <select id="expensesFilter" name="expensesFilter" aria-label="Expenses filter">
                <option value="all">All</option>
                <option value="split">Split only</option>
                <option value="onlyMe">Only me</option>
                <option value="roommatePaid">Roommate paid</option>
              </select>
              <select id="cardFilter" name="cardFilter" aria-label="Filter by card">
              <option value="">All cards</option>
              <option value="amex">Amex</option>
              <option value="citi">Citi</option>
              <option value="apple">Apple Card</option>
              <option value="bofa">BofA</option>
              <option value="bofa-debit">BoFA Debit</option>
              <option value="chase">Chase</option>
              <option value="zolve">Zolve</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
              <option value="none">No card</option>
              </select>
            </div>
          </div>
          <div id="expenses" class="expenses"></div>
        </div>
      </section>
      </div>

      <div id="panelSummary">
      <section class="grid">
        <div class="card span-2">
          <div class="card-head">
            <h2>Summary</h2>
            <div class="card-head-right">
              <select id="summaryCard" name="summaryCard" aria-label="Card for summary">
                <option value="">All cards</option>
                <option value="amex">Amex</option>
                <option value="citi">Citi</option>
                <option value="apple">Apple Card</option>
                <option value="bofa">BofA</option>
                <option value="bofa-debit">BoFA Debit</option>
                <option value="chase">Chase</option>
                <option value="zolve">Zolve</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
                <option value="none">No card</option>
              </select>
            </div>
          </div>
          <div class="filters">
            <button class="chip" data-range="week" type="button">Week</button>
            <button class="chip active" data-range="month" type="button">Month</button>
            <button class="chip" data-range="year" type="button">Year</button>
            <button class="chip" data-range="all" type="button">All</button>
            <button class="chip" data-range="custom" type="button">Custom</button>

            <div id="monthPicker" class="filters-inline">
              <input id="month" name="month" type="month" aria-label="Select month" />
            </div>
          </div>

          <div id="customRange" class="filters-row" style="display:none;">
            <input id="customFrom" name="customFrom" type="date" aria-label="From" />
            <span class="muted" style="font-size:12px;">to</span>
            <input id="customTo" name="customTo" type="date" aria-label="To" />
          </div>
          <div class="summary">
            <div>
              <div class="metric" id="selectedTotal">—</div>
              <div class="label" id="selectedLabel">Selected total</div>
            </div>
            <div>
              <div class="metric" id="selectedYtd">—</div>
              <div class="label" id="selectedYtdLabel">YTD</div>
            </div>
            <div>
              <div class="metric" id="allTotal">—</div>
              <div class="label">All time</div>
            </div>
          </div>

          <div class="muted" id="reimb" style="margin-top:10px;font-size:12px;"></div>

          <div class="summary" style="margin-top:12px;">
            <div>
              <div class="metric" id="myShareSelected">—</div>
              <div class="label">My share (selected)</div>
            </div>
            <div>
              <div class="metric" id="expectedBack">—</div>
              <div class="label">Expected back</div>
            </div>
            <div>
              <div class="metric" id="iOwe">—</div>
              <div class="label">I owe</div>
            </div>
          </div>

          <div id="shareChart" class="chart" style="margin-top:10px;">Loading…</div>

          <div class="muted" id="networth" style="margin-top:10px;font-size:12px;"></div>

          <div id="cardTotals" class="muted" style="margin-top:8px;font-size:12px;"></div>

          <h3 style="margin-top: 18px;">Spending by category</h3>
          <div id="categoryCharts" class="chart" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;">
            <div>
              <div class="muted" style="font-size:12px;margin-bottom:6px;">Selected range</div>
              <div id="chart" class="chart">Loading…</div>
            </div>
            <div>
              <div class="muted" style="font-size:12px;margin-bottom:6px;">Year-to-date</div>
              <div id="chartYear" class="chart">Loading…</div>
            </div>
          </div>
          <div class="chart-legend">
            <small>Category totals for the selected range and the full year-to-date.</small>
          </div>
        </div>
      </section>
      </div>

      <footer class="footer">
        <small>
          Tip: try <code>spent 12 coffee</code>, <code>rent 1200 2026-02-01</code>, <code>food 9 yesterday</code>.
        </small>
      </footer>

      <div id="editModal" class="modal" aria-hidden="true">
        <div class="modal-backdrop" id="editBackdrop"></div>
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Edit expense">
          <div class="modal-head">
            <div class="modal-title">Edit expense</div>
            <button id="editClose" type="button" class="icon-btn" aria-label="Close">×</button>
          </div>

          <div class="modal-body">
            <label for="editBaseText">Message</label>
            <input id="editBaseText" type="text" placeholder="e.g. food 12 lunch" />

            <div class="row">
              <input id="editOccurredOn" type="date" />
              <select id="editCard" aria-label="Card">
                <option value="">Card</option>
                <option value="amex">Amex</option>
                <option value="citi">Citi</option>
                <option value="apple">Apple Card</option>
                <option value="bofa">BofA</option>
                <option value="bofa-debit">BoFA Debit</option>
                <option value="chase">Chase</option>
                <option value="zolve">Zolve</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div class="row" style="margin-top:8px;">
              <select id="editPaidBy" aria-label="Paid by">
                <option value="me">I paid</option>
                <option value="roommate">Roommate paid</option>
              </select>
              <label class="inline" style="gap:10px;">
                <span>Split?</span>
                <input id="editSplit" type="checkbox" />
              </label>
            </div>

            <div class="row" style="margin-top:8px;">
              <select id="editSplitType" aria-label="Split type" style="display:none;">
                <option value="equal">Equal</option>
                <option value="ratio">Ratio</option>
              </select>
              <input id="editSplitRatio" type="text" placeholder="e.g. 2/1" style="display:none;" />
              <select id="editSplitWith" aria-label="Split with" style="display:none;">
                <option value="">With…</option>
                <option value="other">With someone else</option>
              </select>
              <input id="editSplitWithName" type="text" placeholder="Who are you splitting with?" class="grow" style="display:none;" />
              <input id="editSplitWithMore" type="text" placeholder="More people (comma-separated names)" class="grow" style="display:none;" />
            </div>

            <div class="muted" style="margin-top:10px;font-size:12px;">Preview (what we’ll save)</div>
            <pre id="editPreview" class="preview" style="margin-top:6px;"></pre>
            <div id="editStatus" class="status" style="margin-top:8px;"></div>
          </div>

          <div class="modal-actions">
            <button id="editCancel" type="button" class="btn-secondary">Cancel</button>
            <button id="editSave" type="button">Save</button>
          </div>
        </div>
      </div>
    </main>
  `;
}

async function refresh() {
  const summary = await fetchJson('/api/summary');
  const q = rangeToQuery(selectedRange);
  const cardFilter = document.getElementById('cardFilter')?.value || '';
  const expQ = expensesMonthToQuery();
  // For charts/summary, we want the selected-range filter (week/month/year/custom/all).
  // For the Expenses tab list, we want its independent month filter.
  const selectedRangeQuery = new URLSearchParams({
    limit: '200',
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
    ...(cardFilter ? { card: cardFilter } : {}),
  });
  const expensesSelected = await fetchJson(`/api/expenses?${selectedRangeQuery.toString()}`);

  const listQuery = new URLSearchParams({
    limit: '200',
    ...(expQ.from ? { from: expQ.from } : {}),
    ...(expQ.to ? { to: expQ.to } : {}),
    ...(cardFilter ? { card: cardFilter } : {}),
  });
  const expensesList = await fetchJson(`/api/expenses?${listQuery.toString()}`);

  const currency = summary.currency || 'USD';

  // Selected-range totals (computed client-side from the filtered expense list)
  const selectedTotal = (expensesSelected.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);
  document.getElementById('selectedTotal').textContent = formatMoney(currency, selectedTotal);

  // Selected-range "my share" (after splits). This reflects what you actually consumed.
  const selectedMyShare = (expensesSelected.expenses || []).reduce((s, e) => s + Number(e.myAmount ?? e.amount ?? 0), 0);

  // Labels
  const labelEl = document.getElementById('selectedLabel');
  if (labelEl) {
    if (selectedRange === 'month') labelEl.textContent = `Total for ${selectedMonth}`;
    else if (selectedRange === 'custom') labelEl.textContent = `Total for range`;
    else if (selectedRange === 'week') labelEl.textContent = `This week`;
    else if (selectedRange === 'year') labelEl.textContent = `This year`;
    else labelEl.textContent = `All expenses`;
  }

  // YTD: if you pick January, show YTD as-of end of January (not today).
  let ytdTo = new Date().toISOString().slice(0, 10);
  if (selectedRange === 'month') {
    const [yStr, mStr] = String(selectedMonth || '').split('-');
    const y = Number(yStr);
    const m0 = Number(mStr) - 1;
    if (Number.isFinite(y) && Number.isFinite(m0) && m0 >= 0 && m0 <= 11) {
      const end = new Date(y, m0 + 1, 0);
      ytdTo = toYmd(end);
    }
  } else if (selectedRange === 'custom' && customTo) {
    ytdTo = customTo;
  } else if (selectedRange === 'week' && q.to) {
    ytdTo = q.to;
  } else if (selectedRange === 'year' && q.to) {
    ytdTo = q.to;
  }

  const ytdYear = ytdTo.slice(0, 4);
  const ytdFrom = `${ytdYear}-01-01`;
  const ytdResp = await fetchJson(
    `/api/expenses?${new URLSearchParams({
      limit: '200',
      from: ytdFrom,
      to: ytdTo,
      ...(cardFilter ? { card: cardFilter } : {}),
    }).toString()}`
  );
  const ytdTotal = (ytdResp.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);
  document.getElementById('selectedYtd').textContent = formatMoney(currency, ytdTotal);

  const ytdMyShare = (ytdResp.expenses || []).reduce((s, e) => s + Number(e.myAmount ?? e.amount ?? 0), 0);
  const ytdLabelEl = document.getElementById('selectedYtdLabel');
  if (ytdLabelEl) ytdLabelEl.textContent = `YTD (to ${ytdTo})`;

  document.getElementById('allTotal').textContent = formatMoney(currency, summary.allTime.total);

  const netEl = document.getElementById('networth');
  if (netEl && summary?.ledger) {
    const l = summary.ledger;
    netEl.textContent = `Income: ${formatMoney(currency, l.incomeTotal)} · Savings: ${formatMoney(currency, l.savingsTotal)} · Investments: ${formatMoney(currency, l.investmentTotal)} · Liabilities: ${formatMoney(currency, l.liabilityTotal)} · Net: ${formatMoney(currency, l.netWorth)}`;
  }

  const recvEl = document.getElementById('receivables');
  if (recvEl) {
    const rows = summary?.receivables || [];
    if (!rows.length) {
      recvEl.textContent = '';
    } else {
      recvEl.innerHTML = rows
        .map((r) => {
          const name = nicePersonLabel(r.counterparty);
          if (Number(r.theyOwe || 0) > 0) return `${name} owes you <b>${formatMoney(currency, r.theyOwe)}</b>`;
          if (Number(r.iOwe || 0) > 0) return `You owe ${name} <b>${formatMoney(currency, r.iOwe)}</b>`;
          return `${name}: settled`;
        })
        .join('<br/>');
    }
  }

  // Per-card totals (uses separate selector in the Summary header)
  const summaryCard = document.getElementById('summaryCard')?.value || '';
  const cardTotalsEl = document.getElementById('cardTotals');
  if (cardTotalsEl) {
    if (!summaryCard) {
      cardTotalsEl.textContent = '';
    } else {
      const selCardResp = await fetchJson(
        `/api/expenses?${new URLSearchParams({
          limit: '200',
          ...(q.from ? { from: q.from } : {}),
          ...(q.to ? { to: q.to } : {}),
          card: summaryCard,
        }).toString()}`
      );
      const selCardTotal = (selCardResp.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);

      const ytdCardResp = await fetchJson(
        `/api/expenses?${new URLSearchParams({ limit: '200', from: ytdFrom, to: ytdTo, card: summaryCard }).toString()}`
      );
      const ytdCardTotal = (ytdCardResp.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);

      const allCardResp = await fetchJson(`/api/expenses?${new URLSearchParams({ limit: '200', card: summaryCard }).toString()}`);
      const allCardTotal = (allCardResp.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);

      cardTotalsEl.textContent = `Card totals (${summaryCard}): ${formatMoney(currency, selCardTotal)} selected • ${formatMoney(currency, ytdCardTotal)} YTD • ${formatMoney(currency, allCardTotal)} all time`;
    }
  }

  const reimbSummary = summary.reimbursementBalance;
  const reimbEl = document.getElementById('reimb');
  if (reimbEl && reimbSummary) {
    const net = Number(reimbSummary.net || 0);
    if (net > 0) reimbEl.textContent = `You're owed ${formatMoney(currency, net)} (net)`;
    else if (net < 0) reimbEl.textContent = `You owe ${formatMoney(currency, Math.abs(net))} (net)`;
    else reimbEl.textContent = `Balance settled (net ${formatMoney(currency, 0)})`;
  }

  const theyOweMe = Number(reimbSummary?.theyOweMe || 0);
  const iOweThem = Number(reimbSummary?.iOweThem || 0);

  const myShareSelEl = document.getElementById('myShareSelected');
  if (myShareSelEl) myShareSelEl.textContent = formatMoney(currency, selectedMyShare);
  const expectedBackEl = document.getElementById('expectedBack');
  if (expectedBackEl) expectedBackEl.textContent = formatMoney(currency, theyOweMe);
  const iOweEl = document.getElementById('iOwe');
  if (iOweEl) iOweEl.textContent = formatMoney(currency, iOweThem);

  // A simple pie comparing what you consumed vs what you're expected to get back.
  const shareChartEl = document.getElementById('shareChart');
  if (shareChartEl) {
    const shareBuckets = [
      { category: 'my share', total: Math.max(0, selectedMyShare) },
      { category: 'expected back', total: Math.max(0, theyOweMe) },
    ].filter((b) => b.total > 0);
    // Force side-by-side layout for this chart (pie + legend).
    shareChartEl.innerHTML = `<div class="share-pie">${renderPieChart(shareBuckets, currency)}</div>`;
    const note = document.createElement('div');
    note.className = 'muted';
    note.style.marginTop = '6px';
    note.style.fontSize = '12px';
    note.textContent = `Selected: spent ${formatMoney(currency, selectedTotal)} · my share ${formatMoney(currency, selectedMyShare)} · expected back ${formatMoney(currency, theyOweMe)}`;
    shareChartEl.appendChild(note);
  }

  const buckets = bucketByCategory(expensesSelected.expenses || []);
  const chartEl = document.getElementById('chart');
  if (chartEl) chartEl.innerHTML = renderPieChart(buckets, currency);

  const ytdBuckets = bucketByCategory(ytdResp.expenses || []);
  const chartYearEl = document.getElementById('chartYear');
  if (chartYearEl) chartYearEl.innerHTML = renderPieChart(ytdBuckets, currency);

  const root = document.getElementById('expenses');
  root.innerHTML = '';

  const expensesFilter = String(document.getElementById('expensesFilter')?.value || 'all');
  const listRows = (expensesList.expenses || []).filter((e) => {
    if (expensesFilter === 'split') return Boolean(e.splitType && e.splitType !== 'none');
    if (expensesFilter === 'onlyMe') return !e.splitType || e.splitType === 'none';
    if (expensesFilter === 'roommatePaid') return String(e.paidBy || '') === 'roommate';
    return true;
  });

  for (const e of listRows) {
    const div = document.createElement('div');
    div.className = 'expense';
    div.dataset.expenseId = e.id;

    const left = document.createElement('div');
    left.className = 'left';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = e.category ? `${e.category}` : e.note || 'expense';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${e.occurredOn} • ${e.rawText}`;

    left.appendChild(title);
    left.appendChild(meta);

    const amt = document.createElement('div');
    amt.className = 'amount';
    // In the Expenses list, always show the full paid amount.
    // Any split reimbursement is tracked separately under Reimbursements.
    amt.textContent = formatMoney(e.currency || currency, Number(e.amount));

    const actions = document.createElement('div');
    actions.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'chip';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', async () => {
      openExpenseEditor(e, {
        onSave: async ({ text, occurredOn }) => {
          await updateExpense(e.id, {
            text,
            occurredOn: String(occurredOn || '').trim() || undefined,
          });
          await refreshAll();
        },
      });
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'chip danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this expense?')) return;
      try {
        await deleteExpense(e.id);
        await refreshAll();
      } catch (err) {
        alert(err?.message || String(err));
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    div.appendChild(left);
    div.appendChild(amt);
    div.appendChild(actions);
    root.appendChild(div);
  }

  // Populate parties dropdown (multi-person support)
  const partyEl = document.getElementById('partyFilter');
  if (partyEl) {
    const partiesResp = await fetchJson('/api/reimbursements/parties');
    const parties = Array.isArray(partiesResp.parties) ? partiesResp.parties : [];
    const current = partyEl.value;
    partyEl.innerHTML = '<option value="">All people</option>';
    for (const p of parties) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      partyEl.appendChild(opt);
    }
    partyEl.value = current;

    // Also use these parties to populate the “100% for someone” dropdown.
    const forOtherPersonEl = document.getElementById('forOtherPerson');
    if (forOtherPersonEl) {
      const merged = Array.from(new Set([...getRecentPeople(), ...parties]))
        .map(nicePersonLabel)
        .filter((x) => x && x !== 'Someone');
      setPersonSelectOptions(forOtherPersonEl, merged);
    }
  }

  // Reimbursements panel (list + balance)
  const party = document.getElementById('partyFilter')?.value || '';
  const reimbQuery = new URLSearchParams({ limit: '200', ...(party ? { otherParty: party } : {}) });
  const reimbResp = await fetchJson(`/api/reimbursements?${reimbQuery.toString()}`);

  const reimbBalanceEl = document.getElementById('reimbBalance');
  if (reimbBalanceEl && reimbResp?.balance) {
    const net = Number(reimbResp.balance.net || 0);
    if (party) {
      if (net > 0) reimbBalanceEl.textContent = `${party} owes you ${formatMoney(currency, net)} (net)`;
      else if (net < 0) reimbBalanceEl.textContent = `You owe ${party} ${formatMoney(currency, Math.abs(net))} (net)`;
      else reimbBalanceEl.textContent = `Settled with ${party} (net ${formatMoney(currency, 0)})`;
    } else {
      if (net > 0) reimbBalanceEl.textContent = `Others owe you ${formatMoney(currency, net)} (net)`;
      else if (net < 0) reimbBalanceEl.textContent = `You owe others ${formatMoney(currency, Math.abs(net))} (net)`;
      else reimbBalanceEl.textContent = `All reimbursements settled (net ${formatMoney(currency, 0)})`;
    }
  }

  const reimbRoot = document.getElementById('reimbList');
  if (reimbRoot) {
    reimbRoot.innerHTML = '';

    const rows = reimbResp.reimbursements || [];

    // If no person is selected, show one net row per person (much easier to read).
    if (!party) {
      const byParty = new Map();
      for (const r of rows) {
        const whoKey = (r.otherParty || 'someone').trim().toLowerCase();
        const delta = r.direction === 'they_owe_me' ? Number(r.amount || 0) : -Number(r.amount || 0);
        byParty.set(whoKey, (byParty.get(whoKey) || 0) + delta);
      }

      const items = Array.from(byParty.entries())
        .map(([whoKey, net]) => ({ whoKey, who: nicePersonLabel(whoKey), net }))
        .filter((x) => Math.abs(x.net) > 0.00001)
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

      if (!items.length) {
        const div = document.createElement('div');
        div.className = 'muted';
        div.style.fontSize = '12px';
        div.textContent = 'No reimbursements yet.';
        reimbRoot.appendChild(div);
      } else {
        for (const it of items) {
          const div = document.createElement('div');
          div.className = 'expense';

          const left = document.createElement('div');
          left.className = 'left';

          const title = document.createElement('div');
          title.className = 'title';
          title.textContent = it.net > 0 ? `${it.who} owes you` : `You owe ${it.who}`;

          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = 'Net total (all time)';

          left.appendChild(title);
          left.appendChild(meta);

          const amt = document.createElement('div');
          amt.className = 'amount';
          amt.textContent = formatMoney(currency, Math.abs(it.net));

          div.appendChild(left);
          div.appendChild(amt);
          reimbRoot.appendChild(div);
        }
      }
    } else {
      // Person selected: show detailed line items.
      for (const r of rows) {
        const div = document.createElement('div');
        div.className = 'expense';

        const left = document.createElement('div');
        left.className = 'left';

        const title = document.createElement('div');
        title.className = 'title';
        const who = r.otherParty || 'someone';
        title.textContent = r.direction === 'they_owe_me' ? `${who} owes you` : `You owe ${who}`;

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${r.occurredOn} • ${r.rawText}`;

        left.appendChild(title);
        left.appendChild(meta);

        const amt = document.createElement('div');
        amt.className = 'amount';
        amt.textContent = formatMoney(r.currency || currency, r.amount);

        div.appendChild(left);
        div.appendChild(amt);
        reimbRoot.appendChild(div);
      }
    }
  }
}

function wireEvents() {
  // Init month picker
  const monthEl = document.getElementById('month');
  if (monthEl) {
    monthEl.value = selectedMonth;
    monthEl.addEventListener('change', async () => {
      selectedMonth = monthEl.value;
      if (selectedRange === 'month') await refresh();
    });
  }

  // Expenses tab: independent month controls
  const expensesMonthModeEl = document.getElementById('expensesMonthMode');
  const expensesMonthEl = document.getElementById('expensesMonth');
  const syncExpensesMonthUi = async () => {
    if (expensesMonthModeEl) expensesMonthModeEl.value = expensesMonthMode;
    if (expensesMonthEl) {
      expensesMonthEl.value = expensesMonth;
      expensesMonthEl.style.display = expensesMonthMode === 'month' ? 'block' : 'none';
    }
    await refresh();
  };
  if (expensesMonthModeEl) {
    expensesMonthModeEl.value = expensesMonthMode;
    expensesMonthModeEl.addEventListener('change', async () => {
      expensesMonthMode = expensesMonthModeEl.value === 'month' ? 'month' : 'all';
      await syncExpensesMonthUi();
    });
  }
  if (expensesMonthEl) {
    expensesMonthEl.value = expensesMonth;
    expensesMonthEl.style.display = expensesMonthMode === 'month' ? 'block' : 'none';
    expensesMonthEl.addEventListener('change', async () => {
      expensesMonth = expensesMonthEl.value;
      if (expensesMonthMode === 'month') await refresh();
    });
  }

  // Init custom range
  const customFromEl = document.getElementById('customFrom');
  const customToEl = document.getElementById('customTo');
  if (customFromEl) {
    customFromEl.addEventListener('change', async () => {
      customFrom = customFromEl.value;
      if (selectedRange === 'custom') await refresh();
    });
  }

  const cardFilterEl = document.getElementById('cardFilter');
  if (cardFilterEl) {
    cardFilterEl.addEventListener('change', async () => {
      await refresh();
    });
  }

  const summaryCardEl = document.getElementById('summaryCard');
  if (summaryCardEl) {
    summaryCardEl.addEventListener('change', async () => {
      await refresh();
    });
  }

  const splitEl = document.getElementById('split');
  const splitRatioEl = document.getElementById('splitRatio');
  const splitWithEl = document.getElementById('splitWith');
  const splitWithNameEl = document.getElementById('splitWithName');
  const splitWithMoreEl = document.getElementById('splitWithMore');
  const forOtherEl = document.getElementById('forOther');
  const forOtherPersonEl = document.getElementById('forOtherPerson');
  const forOtherNameEl = document.getElementById('forOtherName');
  const splitToggleEl = document.getElementById('splitToggle');
  const forOtherGroupEl = document.getElementById('forOtherGroup');
  if (splitEl && splitRatioEl && splitWithEl && splitWithNameEl && splitWithMoreEl) {
    const toggleSplit = () => {
      const on = splitEl.checked;
      splitRatioEl.style.display = on ? 'block' : 'none';
      splitWithEl.style.display = on ? 'block' : 'none';
      splitWithMoreEl.style.display = on ? 'block' : 'none';
      if (!on) {
        splitRatioEl.value = '';
        splitWithEl.value = '';
        splitWithNameEl.style.display = 'none';
        splitWithNameEl.value = '';
        splitWithMoreEl.value = '';
        return;
      }
      const showName = splitWithEl.value === 'other';
      splitWithNameEl.style.display = showName ? 'block' : 'none';
      if (!showName) splitWithNameEl.value = '';
    };

    const toggleForOther = () => {
      if (!forOtherEl || !forOtherNameEl) return;
      const on = Boolean(forOtherEl.checked);
      if (forOtherPersonEl) {
        const cfg = getConfig();
        const people = [...(cfg.roommates || []), ...getRecentPeople()];
        setPersonSelectOptions(forOtherPersonEl, people);
        forOtherPersonEl.style.display = on ? 'block' : 'none';
      }

      const selected = String(forOtherPersonEl?.value || '').trim();
      // Default to using the dropdown when it exists; only show text box on explicit “Other…” (or no dropdown).
      const usingOther = !forOtherPersonEl || selected === 'other';
      forOtherNameEl.style.display = on && usingOther ? 'block' : 'none';
      // While “100% for someone” is on, visually disable split controls.
      const splitEls = [splitToggleEl, splitRatioEl, splitWithEl, splitWithNameEl, splitWithMoreEl].filter(Boolean);
      for (const el of splitEls) el.classList.toggle('muted-disabled', on);

      if (!on) {
        if (forOtherPersonEl) forOtherPersonEl.value = '';
        forOtherNameEl.value = '';
        return;
      }

      // Mutually exclusive with splitting.
      splitEl.checked = false;
      toggleSplit();

      // Make it fast to enter the person name.
      setTimeout(() => {
        if (forOtherPersonEl) {
          forOtherPersonEl.focus?.();
          const recents = getRecentPeople();
          if (recents.length && !String(forOtherPersonEl.value || '').trim()) {
            setPersonSelectOptions(forOtherPersonEl, recents);
            forOtherPersonEl.value = recents[0];
          }
        }
        const selectedNow = String(forOtherPersonEl?.value || '').trim();
        const usingOtherNow = !forOtherPersonEl || selectedNow === 'other';
        if (usingOtherNow) forOtherNameEl.focus?.();
      }, 0);
    };

    splitEl.addEventListener('change', async () => {
      // Mutually exclusive: if user enables split, turn off “for other”.
      if (splitEl.checked && forOtherEl && forOtherNameEl) {
        forOtherEl.checked = false;
        forOtherNameEl.style.display = 'none';
        forOtherNameEl.value = '';
        // Re-enable split visuals if they were muted.
        const splitEls = [splitToggleEl, splitRatioEl, splitWithEl, splitWithNameEl, splitWithMoreEl].filter(Boolean);
        for (const el of splitEls) el.classList.remove('muted-disabled');
      }
      toggleSplit();
      await refresh();
    });
    splitWithEl.addEventListener('change', toggleSplit);
    toggleSplit();

    if (forOtherEl && forOtherNameEl) {
      forOtherEl.addEventListener('change', () => {
        toggleForOther();
      });

      if (forOtherPersonEl) {
        const cfg = getConfig();
        setPersonSelectOptions(forOtherPersonEl, [...(cfg.roommates || []), ...getRecentPeople()]);
        forOtherPersonEl.addEventListener('change', () => {
          const selected = String(forOtherPersonEl.value || '').trim();
          const usingOther = selected === 'other' || selected === '';
          forOtherNameEl.style.display = forOtherEl.checked && usingOther ? 'block' : 'none';
          if (!usingOther) {
            forOtherNameEl.value = '';
            if (selected) addRecentPerson(selected);
          } else {
            setTimeout(() => forOtherNameEl.focus?.(), 0);
          }
        });
      }
      // Ensure correct initial state on page load / rerenders.
      toggleForOther();
    }
  }

  // Config panel (roommates + cards)
  const cfgRoommatesEl = document.getElementById('cfgRoommates');
  const cfgCardsEl = document.getElementById('cfgCards');
  const cfgSaveEl = document.getElementById('cfgSave');
  const cfgResetEl = document.getElementById('cfgReset');
  const cfgStatusEl = document.getElementById('cfgStatus');
  const cardSelectEl = document.getElementById('card');

  const applyConfigToUi = () => {
    const cfg = getConfig();
    if (cfgRoommatesEl) cfgRoommatesEl.value = '';
    if (cfgCardsEl) cfgCardsEl.value = '';
    renderSettingsLists(cfg);

    // Update card dropdown options while preserving special options
    if (cardSelectEl) {
      const keep = new Set(['', 'other']);
      for (const opt of Array.from(cardSelectEl.querySelectorAll('option'))) {
        if (!keep.has(opt.value)) opt.remove();
      }
      const insertBefore = cardSelectEl.querySelector('option[value="other"]');
      const existing = new Set(Array.from(cardSelectEl.querySelectorAll('option')).map((o) => o.value));
      const canonical = (s) => String(s || '').trim();
      const toVal = (label) => canonical(label).toLowerCase().replace(/\s+/g, '-');

      for (const label of cfg.paymentMethods || []) {
        const cleanLabel = canonical(label);
        if (!cleanLabel) continue;
        const val = toVal(cleanLabel);
        if (!val || keep.has(val) || existing.has(val)) continue;
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = cleanLabel;
        cardSelectEl.insertBefore(opt, insertBefore);
        existing.add(val);
      }
    }

    // Update for-other dropdown options
    if (forOtherPersonEl) {
      setPersonSelectOptions(forOtherPersonEl, [...(cfg.roommates || []), ...getRecentPeople()]);
    }

    // Expenses tab: dynamic roommate & people options (no hardcoding)
    const paidByEl = document.getElementById('paidBy');
    const paidByRoommateEl = document.getElementById('paidByRoommateName');
    if (paidByRoommateEl) setRoommateSelectOptions(paidByRoommateEl, cfg.roommates || []);

    const splitWithEl = document.getElementById('splitWith');
    if (splitWithEl) {
      const people = [...(cfg.roommates || []), ...getRecentPeople()];
      setPersonSelectOptions(splitWithEl, people);
    }

    const updatePaidByUi = () => {
      if (!paidByEl || !paidByRoommateEl) return;
      const on = String(paidByEl.value) === 'roommate';
      paidByRoommateEl.style.display = on ? 'block' : 'none';
      if (!on) paidByRoommateEl.value = '';
    };

    const updatePaidForMeUi = () => {
      const paidForMeEl = document.getElementById('paidForMe');
      const forOtherEl = document.getElementById('forOther');
      const splitEl = document.getElementById('split');
      const splitWithEl = document.getElementById('splitWith');
      const splitWithNameEl = document.getElementById('splitWithName');
      const splitWithMoreEl = document.getElementById('splitWithMore');
      const splitRatioEl = document.getElementById('splitRatio');

      const paidForMeOn = Boolean(paidForMeEl?.checked);

      // Force paidBy=roommate (because someone else paid)
      if (paidForMeOn && paidByEl) paidByEl.value = 'roommate';
      updatePaidByUi();

      // This mode is mutually exclusive with "For someone".
      if (paidForMeOn && forOtherEl) forOtherEl.checked = false;

      // This mode implies 100% me, so we don't need split UI.
      const disable = (el, on) => {
        if (!el) return;
        el.disabled = on;
        if (on) el.classList?.add?.('muted-disabled');
        else el.classList?.remove?.('muted-disabled');
      };

      // Disable split controls and clear values (we'll encode split:1/0 on submit).
      if (splitEl) {
        splitEl.checked = false;
        splitEl.disabled = paidForMeOn;
      }
      if (splitWithEl) {
        splitWithEl.value = '';
        splitWithEl.style.display = 'none';
        splitWithEl.disabled = paidForMeOn;
      }
      if (splitWithNameEl) {
        splitWithNameEl.value = '';
        splitWithNameEl.style.display = 'none';
        splitWithNameEl.disabled = paidForMeOn;
      }
      if (splitWithMoreEl) {
        splitWithMoreEl.value = '';
        splitWithMoreEl.style.display = 'none';
        splitWithMoreEl.disabled = paidForMeOn;
      }
      if (splitRatioEl) {
        splitRatioEl.value = '';
        splitRatioEl.style.display = 'none';
        splitRatioEl.disabled = paidForMeOn;
      }

      // Also disable the "For someone" group while this is on.
      disable(document.getElementById('forOtherGroup'), paidForMeOn);
    };
    if (paidByEl) {
      paidByEl.onchange = () => {
        updatePaidByUi();

        // Default behavior:
        // - If roommate paid and user did NOT opt into Split, treat it as "Paid for me"
        //   (100% on me; I owe the roommate the full amount).
        // - If user turns on Split, they can override this and do a true split.
        const isRoommatePaid = String(paidByEl.value) === 'roommate';
        const paidForMeEl = document.getElementById('paidForMe');
        const splitEl = document.getElementById('split');
        if (isRoommatePaid && paidForMeEl && splitEl && !splitEl.checked) {
          paidForMeEl.checked = true;
        }

        // If they switch back to "I paid", turn off paid-for-me.
        if (!isRoommatePaid && paidForMeEl) {
          paidForMeEl.checked = false;
        }

        updatePaidForMeUi();
      };
      updatePaidByUi();
    }

    const paidForMeEl = document.getElementById('paidForMe');
    if (paidForMeEl) {
      paidForMeEl.addEventListener('change', () => {
        updatePaidForMeUi();
      });
      updatePaidForMeUi();
    }

    const splitEl = document.getElementById('split');
    if (splitEl) {
      splitEl.addEventListener('change', () => {
        // If the user explicitly chooses Split, that should override "Paid for me".
        const paidForMeEl = document.getElementById('paidForMe');
        if (splitEl.checked && paidForMeEl && paidForMeEl.checked) {
          paidForMeEl.checked = false;
        }
        updatePaidForMeUi();
      });
    }
  };

  applyConfigToUi();

  if (cfgSaveEl) {
    cfgSaveEl.addEventListener('click', () => {
      try {
        const cfg = getConfig();
        const addRoommates = parseCommaList(cfgRoommatesEl?.value).map(nicePersonLabel);
        const addCards = parseCommaList(cfgCardsEl?.value);
        const next = {
          roommates: Array.from(new Map([...(cfg.roommates || []), ...addRoommates].map((n) => [nicePersonLabel(n).toLowerCase(), nicePersonLabel(n)])).values()),
          paymentMethods: Array.from(new Map([...(cfg.paymentMethods || []), ...addCards].map((n) => [String(n).toLowerCase(), String(n)])).values()),
        };
        setConfig(next);
        applyConfigToUi();
        if (cfgStatusEl) {
          cfgStatusEl.textContent = 'Saved.';
          cfgStatusEl.className = 'status ok';
        }
      } catch (err) {
        if (cfgStatusEl) {
          cfgStatusEl.textContent = err?.message || String(err);
          cfgStatusEl.className = 'status error';
        }
      }
    });
  }

  // Delete buttons (event delegation)
  const panelSettings = document.getElementById('panelSettings');
  if (panelSettings) {
    panelSettings.addEventListener('click', (ev) => {
      const btn = ev.target?.closest?.('button.cfg-del');
      if (!btn) return;
      const kind = btn.getAttribute('data-kind');
      const val = decodeURIComponent(btn.getAttribute('data-value') || '');
      const cfg = getConfig();
      if (kind === 'roommate') {
        setConfig({
          roommates: (cfg.roommates || []).filter((x) => nicePersonLabel(x) !== nicePersonLabel(val)),
          paymentMethods: cfg.paymentMethods || [],
        });
      } else if (kind === 'card') {
        setConfig({
          roommates: cfg.roommates || [],
          paymentMethods: (cfg.paymentMethods || []).filter((x) => String(x) !== String(val)),
        });
      }
      applyConfigToUi();
      if (cfgStatusEl) {
        cfgStatusEl.textContent = 'Updated.';
        cfgStatusEl.className = 'status ok';
      }
    });
  }

  // API key inputs (local-only)
  const apiKeyEl = document.getElementById('apiKey');
  const apiKeySaveEl = document.getElementById('apiKeySave');
  const apiKeyClearEl = document.getElementById('apiKeyClear');
  const apiKeyStatusEl = document.getElementById('apiKeyStatus');
  if (apiKeyEl) {
    try {
      apiKeyEl.value = '';
    } catch {
      // ignore
    }
  }
  if (apiKeySaveEl) {
    apiKeySaveEl.addEventListener('click', () => {
      try {
        const key = String(apiKeyEl?.value || '').trim();
        if (!key) throw new Error('Enter a key first.');
        localStorage.setItem('apiKey', key);
        if (apiKeyEl) apiKeyEl.value = '';
        if (apiKeyStatusEl) {
          apiKeyStatusEl.textContent = 'Saved.';
          apiKeyStatusEl.className = 'status ok';
        }
      } catch (err) {
        if (apiKeyStatusEl) {
          apiKeyStatusEl.textContent = err?.message || String(err);
          apiKeyStatusEl.className = 'status error';
        }
      }
    });
  }
  if (apiKeyClearEl) {
    apiKeyClearEl.addEventListener('click', () => {
      try {
        localStorage.removeItem('apiKey');
        if (apiKeyStatusEl) {
          apiKeyStatusEl.textContent = 'Cleared.';
          apiKeyStatusEl.className = 'status ok';
        }
      } catch (err) {
        if (apiKeyStatusEl) {
          apiKeyStatusEl.textContent = err?.message || String(err);
          apiKeyStatusEl.className = 'status error';
        }
      }
    });
  }

  if (cfgResetEl) {
    cfgResetEl.addEventListener('click', () => {
      try {
        localStorage.removeItem('appConfig');
        applyConfigToUi();
        if (cfgStatusEl) {
          cfgStatusEl.textContent = 'Reset to defaults.';
          cfgStatusEl.className = 'status ok';
        }
      } catch (err) {
        if (cfgStatusEl) {
          cfgStatusEl.textContent = err?.message || String(err);
          cfgStatusEl.className = 'status error';
        }
      }
    });
  }


  const partyEl = document.getElementById('partyFilter');
  if (partyEl) {
    partyEl.addEventListener('change', async () => {
      await refresh();
    });
  }

  const expensesFilterEl = document.getElementById('expensesFilter');
  if (expensesFilterEl) {
    expensesFilterEl.addEventListener('change', async () => {
      await refresh();
    });
  }
  if (customToEl) {
    customToEl.addEventListener('change', async () => {
      customTo = customToEl.value;
      if (selectedRange === 'custom') await refresh();
    });
  }

  document.getElementById('ingestForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const status = document.getElementById('status');
    status.textContent = '';

    const text = document.getElementById('text').value;
    const occurredOn = document.getElementById('occurredOn').value;

    const card = document.getElementById('card').value;
    const paidBy = document.getElementById('paidBy').value;
    const split = document.getElementById('split').checked;
  const paidForMe = Boolean(document.getElementById('paidForMe')?.checked);
    const forOther = Boolean(document.getElementById('forOther')?.checked);
  const forOtherPerson = String(document.getElementById('forOtherPerson')?.value || '').trim();
  const forOtherNameRaw = (document.getElementById('forOtherName')?.value || '').trim();
  const forOtherName = forOtherPerson && forOtherPerson !== 'other' ? forOtherPerson : forOtherNameRaw;
  const splitWith = String(document.getElementById('splitWith')?.value || '').trim();
    const splitWithName = (document.getElementById('splitWithName')?.value || '').trim();
    const splitWithMore = (document.getElementById('splitWithMore')?.value || '').trim();
    const splitRatio = document.getElementById('splitRatio').value.trim();

    // If the user picked a date, append it to the message so the existing parser can extract it.
    // This keeps the API contract unchanged.
    // Encode metadata into the existing message parser pipeline (no API changes).
    // Examples appended:
    //   card:amex paidby:me split 50/50 2026-02-01
    const metaParts = [];
    if (card) metaParts.push(`card:${card}`);
    // Keep the existing parser contract: paidby supports only me|roommate.
    // For friends/other people, we map to paidby:roommate and encode the name in other:<name>.
    if (paidForMe) {
      metaParts.push('paidby:roommate');
      const payerName = String(document.getElementById('paidByRoommateName')?.value || '').trim();
      if (!payerName) {
        status.textContent = 'Select who paid (roommate name) for “Paid for me”.';
        status.className = 'status error';
        return;
      }
      metaParts.push(`other:${nicePersonLabel(payerName)}`);
      // Encode 100% me (me:other = 1:0)
      metaParts.push('split:1/0');
    } else if (paidBy === 'me') {
      metaParts.push('paidby:me');
    } else {
      // paidBy === 'roommate' or 'other'
      metaParts.push('paidby:roommate');
      // If the user selected a specific roommate name (UI sets it separately), encode it.
      const paidByRoommateName = String(document.getElementById('paidByRoommateName')?.value || '').trim();
      if (paidByRoommateName) metaParts.push(`other:${nicePersonLabel(paidByRoommateName)}`);
    }

    if (!paidForMe && split) {
      // IMPORTANT: parser expects split:<value> (e.g. split:equal or split:2/1).
      metaParts.push(splitRatio ? `split:${splitRatio}` : 'split:equal');
    }

    if (!paidForMe && forOther) {
      if (!forOtherName) {
        status.textContent = 'Please enter who this expense was 100% for.';
        status.className = 'status error';
        return;
      }
      // Token handled server-side: sets my share to 0 and creates a reimbursement.
      metaParts.push(`for:${nicePersonLabel(forOtherName)}`);
      addRecentPerson(forOtherName);
    }

    if (!paidForMe && split) {
      if (splitWith && splitWith !== 'other') {
        if (splitWith === 'me') {
          // Special-case: "split with me" means split with the paying roommate.
          // Encode the roommate name as the counterparty so reimbursements work.
          const paidByRoommateName = String(document.getElementById('paidByRoommateName')?.value || '').trim();
          if (paidByRoommateName) metaParts.push(`other:${nicePersonLabel(paidByRoommateName)}`);
        } else {
          metaParts.push(`other:${nicePersonLabel(splitWith)}`);
        }
      }
      else if (splitWith === 'other' && splitWithName) metaParts.push(`other:${nicePersonLabel(splitWithName)}`);

      // Allow adding multiple people; emit repeated other:<name> tokens for max compatibility.
      for (const p of normalizePeopleList(splitWithMore)) metaParts.push(`other:${p}`);
    }
    if (occurredOn) metaParts.push(occurredOn);
    const textWithMeta = `${text} ${metaParts.join(' ')}`.trim();

    const result = await fetchJson('/api/ingest-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: textWithMeta, source: 'web' }),
    });

    if (!result.ok) {
      status.textContent = result.error || 'Failed.';
      status.className = 'status error';
      return;
    }

    status.textContent = result.ack?.message || 'Added.';
    status.className = 'status ok';
    document.getElementById('text').value = '';
    document.getElementById('occurredOn').value = '';
    document.getElementById('split').checked = false;
    document.getElementById('splitRatio').value = '';
  if (document.getElementById('splitWith')) document.getElementById('splitWith').value = '';
  if (document.getElementById('splitWithName')) document.getElementById('splitWithName').value = '';
  if (document.getElementById('splitWithMore')) document.getElementById('splitWithMore').value = '';
    if (document.getElementById('forOther')) document.getElementById('forOther').checked = false;
    if (document.getElementById('forOtherPerson')) {
      document.getElementById('forOtherPerson').value = '';
      document.getElementById('forOtherPerson').style.display = 'none';
    }
    if (document.getElementById('forOtherName')) {
      document.getElementById('forOtherName').value = '';
      document.getElementById('forOtherName').style.display = 'none';
    }
    if (document.getElementById('paidBy')) document.getElementById('paidBy').value = 'me';
    if (document.getElementById('otherParty')) document.getElementById('otherParty').value = '';

    await refresh();
  });

  for (const btn of document.querySelectorAll('[data-range]')) {
    btn.addEventListener('click', async () => {
      selectedRange = btn.dataset.range;
      for (const b of document.querySelectorAll('[data-range]')) b.classList.remove('active');
      btn.classList.add('active');

      const monthPicker = document.getElementById('monthPicker');
      if (monthPicker) monthPicker.style.display = selectedRange === 'month' ? 'flex' : 'none';
      const customRange = document.getElementById('customRange');
      if (customRange) customRange.style.display = selectedRange === 'custom' ? 'flex' : 'none';
      await refresh();
    });

    const ledgerForm = document.getElementById('ledgerForm');
    if (ledgerForm) {
      ledgerForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const status = document.getElementById('ledgerStatus');
        if (status) status.textContent = '';

        const text = String(document.getElementById('ledgerText')?.value || '').trim();
        const type = String(document.getElementById('ledgerType')?.value || 'income').trim();
        const occurredOn = String(document.getElementById('ledgerOccurredOn')?.value || '').trim();

        if (!text) {
          if (status) status.textContent = 'Enter a message first.';
          return;
        }

        const parts = [text, `type:${type}`];
        if (occurredOn) parts.push(occurredOn);
        const textWithMeta = parts.join(' ').trim();

        try {
          const result = await fetchJson('/api/ledger', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: textWithMeta, source: 'web' }),
          });
          if (result?.ok === false) throw new Error(result?.error || 'Request failed');

          if (status) status.textContent = 'Added.';
          const textEl = document.getElementById('ledgerText');
          if (textEl) textEl.value = '';
          await refresh();
        } catch (err) {
          if (status) status.textContent = err?.message || String(err);
        }
      });
    }
  }

  // Money is a full tab now, so money tools are always visible inside that panel.

  const recvForm = document.getElementById('recvForm');
  if (recvForm) {
    recvForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const status = document.getElementById('recvStatus');
      if (status) status.textContent = '';

      const action = String(document.getElementById('recvAction')?.value || 'took');
      const person = String(document.getElementById('recvPerson')?.value || '').trim();
      const amount = String(document.getElementById('recvAmount')?.value || '').trim();

      if (!person) {
        if (status) status.textContent = 'Enter a person.';
        return;
      }
      if (!amount || Number(amount) <= 0) {
        if (status) status.textContent = 'Enter a positive amount.';
        return;
      }

      // Map UX actions to direction semantics.
      // - took from kevin => i_borrowed (I owe Kevin)
      // - gave to kevin => i_lent (Kevin owes me)
      // - returned to kevin => repay (reduces what I owe)
      // - got back from kevin => collect (reduces what Kevin owes)
      const map = {
        took: { dir: 'i_borrowed', verb: 'Took' },
        gave: { dir: 'i_lent', verb: 'Gave' },
        return: { dir: 'repay', verb: 'Returned' },
        got: { dir: 'collect', verb: 'Got back' },
      };
      const m = map[action] || map.took;
      const msg = `${m.verb} ${amount} receivable type:receivable counterparty:${nicePersonLabel(person)} direction:${m.dir}`;

      try {
        const result = await fetchJson('/api/ledger', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: msg, source: 'web' }),
        });
        if (result?.ok === false) throw new Error(result?.error || 'Request failed');
        if (status) status.textContent = 'Added.';
        await refresh();
      } catch (err) {
        if (status) status.textContent = err?.message || String(err);
      }
    });
  }
}

renderShell();
  
  // Tabs
  const tabSummary = document.getElementById('tabSummary');
  const tabExpenses = document.getElementById('tabExpenses');
  const tabMoney = document.getElementById('tabMoney');
  const tabSettings = document.getElementById('tabSettings');
  const panelSummary = document.getElementById('panelSummary');
  const panelExpenses = document.getElementById('panelExpenses');
  const panelMoney = document.getElementById('panelMoney');
  const panelSettings = document.getElementById('panelSettings');
  
  const setActive = (which) => {
    if (panelSummary) panelSummary.style.display = which === 'summary' ? 'block' : 'none';
    if (panelExpenses) panelExpenses.style.display = which === 'expenses' ? 'block' : 'none';
    if (panelMoney) panelMoney.style.display = which === 'money' ? 'block' : 'none';
    if (panelSettings) panelSettings.style.display = which === 'settings' ? 'block' : 'none';

    for (const [btn, name] of [
      [tabSummary, 'summary'],
      [tabExpenses, 'expenses'],
      [tabMoney, 'money'],
      [tabSettings, 'settings'],
    ]) {
      if (!btn) continue;
      if (which === name) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  };
  
  if (tabSummary) tabSummary.onclick = () => setActive('summary');
  if (tabExpenses) tabExpenses.onclick = () => setActive('expenses');
  if (tabMoney) tabMoney.onclick = () => setActive('money');
  if (tabSettings) tabSettings.onclick = () => setActive('settings');
  
  // Default tab
  setActive('summary');
wireEvents();
refresh();
