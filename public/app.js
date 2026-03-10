const battleMap = document.getElementById('battleMap');
const accountsNode = document.getElementById('accounts');
const alertsNode = document.getElementById('alerts');
const latencyInfo = document.getElementById('latencyInfo');

let targets = [];
let accounts = [];

function formatCountdown(endTimeMs) {
  const ms = endTimeMs - Date.now();
  if (ms <= 0) return '00:00.000';
  const totalSec = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  const millis = String(ms % 1000).padStart(3, '0');
  return `${minutes}:${seconds}.${millis}`;
}

function renderAccounts() {
  accountsNode.innerHTML = accounts
    .map(
      (a) => `<li class="bg-slate-800 border border-slate-700 rounded p-2 flex items-center justify-between gap-2">
        <div>
          <div class="font-medium">${a.id}</div>
          <div class="text-xs text-slate-400">${a.username}</div>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${a.connected ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
          <button data-id="${a.id}" class="removeAccount text-xs bg-rose-600 hover:bg-rose-500 px-2 py-1 rounded">Remove</button>
        </div>
      </li>`
    )
    .join('');

  document.querySelectorAll('.removeAccount').forEach((btn) => {
    btn.onclick = async () => {
      await fetch(`/api/accounts/${btn.dataset.id}`, { method: 'DELETE' });
      await loadInitial();
    };
  });
}

function renderBattleMap() {
  battleMap.innerHTML = targets
    .map(
      (t) => `<tr class="border-b border-slate-800">
        <td class="py-2"><img src="${t.imageUrl || 'https://via.placeholder.com/56x56?text=SGW'}" class="w-14 h-14 rounded object-cover border border-slate-700"/></td>
        <td class="py-2 font-mono">#${t.itemId}</td>
        <td class="py-2">${t.accountId}</td>
        <td class="py-2">$${Number(t.currentPrice || 0).toFixed(2)}</td>
        <td class="py-2">$${Number(t.maxBid).toFixed(2)}</td>
        <td class="py-2 font-mono">${formatCountdown(t.endTimeMs)}</td>
        <td class="py-2">${t.status}</td>
      </tr>`
    )
    .join('');
}

function render() {
  renderBattleMap();
}
setInterval(render, 80);

async function loadInitial() {
  const res = await fetch('/api/state');
  const data = await res.json();
  targets = data.targets ?? [];
  accounts = data.accounts ?? [];
  latencyInfo.textContent = `Latency audit RTT: ${Number(data.avgRttMs ?? 0).toFixed(1)}ms | Trigger adjust: ${data.triggerAdjustMs ?? 0}ms`;
  renderAccounts();
}

document.getElementById('addWatch').onclick = async () => {
  const url = document.getElementById('itemUrl').value;
  const res = await fetch('/api/watch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await res.json();
  if (!data.ok) alert(data.message || 'Failed to add watch');
};

document.getElementById('refreshAccounts').onclick = async () => {
  await fetch('/api/accounts/refresh', { method: 'POST' });
  await loadInitial();
};

document.getElementById('addAccountForm').onsubmit = async (event) => {
  event.preventDefault();
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
  event.target.reset();
  await loadInitial();
};

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'state') {
    targets = msg.payload;
  }
  if (msg.type === 'alert') {
    const li = document.createElement('li');
    li.className = 'text-emerald-400';
    li.textContent = `${new Date().toLocaleTimeString()} - ${msg.payload.message}`;
    alertsNode.prepend(li);
    while (alertsNode.children.length > 30) alertsNode.removeChild(alertsNode.lastChild);
  }
};

loadInitial();
