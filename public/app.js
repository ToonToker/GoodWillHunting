const battleMap = document.getElementById('battleMap');
const accountsNode = document.getElementById('accounts');
const alertsNode = document.getElementById('alerts');
const latencyInfo = document.getElementById('latencyInfo');
const heartbeatsNode = document.getElementById('heartbeats');

let targets = [];
let accounts = [];
let assignments = {};

try {
  const persistedAccounts = localStorage.getItem('accounts');
  if (persistedAccounts) {
    const parsed = JSON.parse(persistedAccounts);
    const fakePattern = /^(2|sdafdafs|test|fake|dummy)$/i;
    const hasInvalid = Array.isArray(parsed)
      ? parsed.some((entry) => {
          const candidate = String(entry?.username ?? entry?.email ?? entry?.id ?? '').trim();
          return !candidate.includes('@') || fakePattern.test(candidate);
        })
      : true;
    if (hasInvalid) localStorage.removeItem('accounts');
  }
} catch {
  localStorage.removeItem('accounts');
}

function formatCountdown(endTimeMs) {
  const ms = endTimeMs - Date.now();
  if (ms <= 0) return '00:00.000';
  const totalSec = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  const millis = String(ms % 1000).padStart(3, '0');
  return `${minutes}:${seconds}.${millis}`;
}

function formatEndTime(endTimeMs) {
  return new Date(endTimeMs).toLocaleString();
}


function getAccountTruth(account) {
  const isConnected = account?.connected === 1 || account?.connected === true;
  const tokenLength = Number(account?.tokenLength ?? 0);
  const hasValidToken = tokenLength > 50;

  if (isConnected && hasValidToken) {
    return { label: 'ONLINE', color: 'bg-emerald-900 text-emerald-300', icon: '✅' };
  }
  if (account?.lastError) {
    return { label: 'ERROR', color: 'bg-rose-900 text-rose-300', icon: '⚠️' };
  }
  return { label: 'OFFLINE', color: 'bg-slate-700 text-slate-300', icon: '⚪' };
}

function statusBadge(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'unconfirmed') return '<span class="px-2 py-1 rounded text-xs font-semibold bg-amber-900 text-amber-300">UNCONFIRMED</span>';
  if (key === 'confirmed') return '<span class="px-2 py-1 rounded text-xs font-semibold bg-emerald-900 text-emerald-300">CONFIRMED</span>';
  if (key === 'ended') return '<span class="px-2 py-1 rounded text-xs font-semibold bg-rose-900 text-rose-300">ENDED</span>';
  if (key === 'win') return '<span class="px-2 py-1 rounded text-xs font-semibold bg-emerald-700 text-emerald-100">WIN</span>';
  if (key === 'failed') return '<span class="px-2 py-1 rounded text-xs font-semibold bg-rose-800 text-rose-200">FAILED</span>';
  if (key === 'sniping') return '<span class="px-2 py-1 rounded text-xs font-semibold bg-indigo-900 text-indigo-300">SNIPING</span>';
  return `<span class="px-2 py-1 rounded text-xs font-semibold bg-slate-700 text-slate-200">${status}</span>`;
}

function renderHeartbeats() {
  heartbeatsNode.innerHTML = accounts
    .map(
      (a) => {
        const status = getAccountTruth(a);
        return `<div class="bg-slate-800 border border-slate-700 rounded p-3">
        <div class="flex justify-between items-center">
          <div class="font-medium">${a.id}</div>
          <span class="text-xs px-2 py-0.5 rounded ${status.color}">${status.icon} ${status.label}</span>
        </div>
        <div class="text-xs text-slate-400 mt-1">${a.username}</div>
        <div class="text-xs text-slate-500 mt-1">Token: ${new Date(a.refreshedAt).toLocaleTimeString()}</div>
        ${a.lastError ? `<div class="text-xs text-rose-400 mt-1">${a.lastError}</div>` : ''}
      </div>`;
      }
    )
    .join('');
}

function renderQueryAccounts() {
  const queryAccount = document.getElementById('queryAccount');
  if (!queryAccount) return;
  const selected = queryAccount.value;
  const options = ['<option value="">Auto account</option>'];
  for (const acc of accounts) {
    options.push(`<option value="${acc.id}" ${selected === acc.id ? 'selected' : ''}>${acc.id}</option>`);
  }
  queryAccount.innerHTML = options.join('');
}

function renderAccounts() {
  accountsNode.innerHTML = accounts
    .map(
      (a) => `<li class="bg-slate-800 border border-slate-700 rounded p-2 flex items-center justify-between gap-2">
        <div class="font-medium">${a.id}</div>
        <button data-id="${a.id}" class="removeAccount text-xs bg-rose-600 hover:bg-rose-500 px-2 py-1 rounded">Remove</button>
      </li>`
    )
    .join('');

  document.querySelectorAll('.removeAccount').forEach((btn) => {
    btn.onclick = async () => {
      await fetch(`/api/accounts/${btn.dataset.id}`, { method: 'DELETE' });
      await fetchState();
    };
  });

  renderHeartbeats();
  renderQueryAccounts();
}

function assignmentOptions(itemId) {
  const current = assignments[itemId] || '';
  const opts = ['<option value="">auto</option>'];
  for (const acc of accounts) {
    opts.push(`<option value="${acc.id}" ${current === acc.id ? 'selected' : ''}>${acc.id}</option>`);
  }
  return opts.join('');
}

function renderBattleMap() {
  battleMap.innerHTML = targets
    .map(
      (t) => `<tr class="border-b border-slate-800">
        <td class="py-2 font-mono">#${t.itemId}</td>
        <td class="py-2">${t.accountId || 'AUTO'}</td>
        <td class="py-2">
          <select data-item-id="${t.itemId}" class="assignSelect bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs">
            ${assignmentOptions(t.itemId)}
          </select>
        </td>
        <td class="py-2">$${Number(t.currentPrice || 0).toFixed(2)}</td>
        <td class="py-2">
          <input data-max-item-id="${t.itemId}" value="${t.maxBid ?? ''}" ${t.status === 'ended' ? 'disabled' : ''} class="maxBidInput w-28 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs" placeholder="max" />
        </td>
        <td class="py-2 text-xs text-slate-300">${formatEndTime(t.endTimeMs)}</td>
        <td class="py-2 font-mono">${formatCountdown(t.endTimeMs)}</td>
        <td class="py-2">${statusBadge(t.status)}</td>
        <td class="py-2">
          <button data-lock-item-id="${t.itemId}" ${t.status === 'ended' ? 'disabled' : ''} class="lockBtn px-3 py-1.5 rounded font-semibold text-xs bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-slate-700">LOCK</button>
        </td>
      </tr>`
    )
    .join('');

  document.querySelectorAll('.assignSelect').forEach((sel) => {
    sel.onchange = async () => {
      const itemId = Number(sel.dataset.itemId);
      const accountId = sel.value;
      await fetch('/api/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId, accountId })
      });
      assignments[itemId] = accountId;
    };
  });

  document.querySelectorAll('.lockBtn').forEach((btn) => {
    btn.onclick = async () => {
      const itemId = Number(btn.dataset.lockItemId);
      const maxInput = document.querySelector(`[data-max-item-id="${itemId}"]`);
      const maxBid = Number(maxInput?.value);
      const res = await fetch('/api/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId, maxBid })
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.message || 'Could not confirm item');
        return;
      }
      await fetchState();
    };
  });
}

function render() {
  renderBattleMap();
}
setInterval(render, 120);

let stateBackoffMs = 3000;
let stateTimer = null;

async function fetchState() {
  const res = await fetch('/api/state');
  const data = await res.json();
  targets = data.targets ?? [];
  accounts = data.accounts ?? [];
  assignments = data.assignments ?? {};
  latencyInfo.textContent = `Latency audit RTT: ${Number(data.avgRttMs ?? 0).toFixed(1)}ms | Trigger adjust: ${data.triggerAdjustMs ?? 0}ms`;
  renderAccounts();
  stateBackoffMs = data.activeSession ? 3000 : Math.min(stateBackoffMs * 2, 30000);
}

function scheduleStateSync() {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(async () => {
    try {
      await fetchState();
    } catch {
      stateBackoffMs = Math.min(stateBackoffMs * 2, 30000);
    }
    scheduleStateSync();
  }, stateBackoffMs);
}

document.getElementById('queryItem').onclick = async () => {
  const query = document.getElementById('itemQuery').value.trim();
  const account = document.getElementById('queryAccount')?.value || '';
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, account })
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.message || 'Failed to query item');
    return;
  }
  await fetchState();
};

document.getElementById('refreshAccounts').onclick = async () => {
  await fetch('/api/accounts/refresh', { method: 'POST' });
  await fetchState();
};

document.getElementById('addAccountForm').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.target;
  const id = document.getElementById('accId').value.trim();
  const username = document.getElementById('accUser').value.trim();
  const password = document.getElementById('accPass').value;
  const res = await fetch('/api/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, username, password })
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.message || 'Failed to add account');
    return;
  }
  form.reset();
  await fetchState();
};

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'state') targets = msg.payload;
  if (msg.type === 'accounts') {
    accounts = msg.payload;
    renderAccounts();
  }
  if (msg.type === 'alert') {
    const li = document.createElement('li');
    li.className = 'text-emerald-400';
    li.textContent = `${new Date().toLocaleTimeString()} - ${msg.payload.message}`;
    alertsNode.prepend(li);
    while (alertsNode.children.length > 30) alertsNode.removeChild(alertsNode.lastChild);
  }
};

fetchState().finally(scheduleStateSync);
