async function fetchJson(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeToQuery(range) {
  const now = new Date();
  if (range === 'week') {
    const dow = (now.getDay() + 6) % 7; // Mon=0
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    return { from: toYmd(start), to: toYmd(now) };
  }
  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toYmd(start), to: toYmd(now) };
  }
  if (range === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: toYmd(start), to: toYmd(now) };
  }
  return {};
}

let selectedRange = 'month';

function formatMoney(currency, amount) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // fallback when currency code isn't supported
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

async function refresh() {
  const summary = await fetchJson('/api/summary');
  const q = rangeToQuery(selectedRange);
  const query = new URLSearchParams({ limit: '50', ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) });
  const expenses = await fetchJson(`/api/expenses?${query.toString()}`);

  const currency = summary.currency || 'INR';
  document.getElementById('weekTotal').textContent = formatMoney(currency, summary.week.total);
  document.getElementById('monthTotal').textContent = formatMoney(currency, summary.month.total);
  document.getElementById('ytdTotal').textContent = formatMoney(currency, summary.ytd.total);
  document.getElementById('allTotal').textContent = formatMoney(currency, summary.allTime.total);

  const root = document.getElementById('expenses');
  root.innerHTML = '';

  for (const e of expenses.expenses) {
    const div = document.createElement('div');
    div.className = 'expense';

    const left = document.createElement('div');
    left.className = 'left';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = e.category ? `${e.category}` : (e.note || 'expense');

    const meta = document.createElement('div');
    meta.className = 'meta';
    const dt = new Date(e.createdAt);
    meta.textContent = `${dt.toLocaleString()} • ${e.rawText}`;

    left.appendChild(title);
    left.appendChild(meta);

    const amt = document.createElement('div');
    amt.className = 'amount';
    amt.textContent = formatMoney(e.currency || currency, e.amount);

    div.appendChild(left);
    div.appendChild(amt);

    root.appendChild(div);
  }
}

document.getElementById('ingestForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const status = document.getElementById('status');
  status.textContent = '';

  const text = document.getElementById('text').value;
  const from = document.getElementById('from').value;

  const result = await fetchJson('/api/ingest-message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, from: from || undefined, source: 'web' }),
  });

  if (!result.ok) {
    status.textContent = result.error || 'Failed.';
    status.className = 'status error';
    return;
  }

  status.textContent = (result.ack && result.ack.message) ? result.ack.message : 'Added.';
  status.className = 'status ok';
  document.getElementById('text').value = '';

  await refresh();
});

refresh();

for (const btn of document.querySelectorAll('[data-range]')) {
  btn.addEventListener('click', async () => {
    selectedRange = btn.dataset.range;
    for (const b of document.querySelectorAll('[data-range]')) b.classList.remove('active');
    btn.classList.add('active');
    await refresh();
  });
}
