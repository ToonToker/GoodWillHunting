const battleMap = document.getElementById('battleMap');
const accountsNode = document.getElementById('accounts');
const alertsNode = document.getElementById('alerts');
const accountStatus = document.getElementById('accountStatus');

let targets = [];

function formatCountdown(endTimeMs) {
  const ms = endTimeMs - Date.now();
  if (ms <= 0) return '00:00.000';
  const totalSec = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  const millis = String(ms % 1000).padStart(3, '0');
  return `${minutes}:${seconds}.${millis}`;
}

function render() {
  battleMap.innerHTML = targets
    .map(
      (t) => `<tr class="border-b border-slate-800">
        <td class="py-2">${t.accountId}</td>
        <td class="py-2">#${t.itemId}</td>
        <td class="py-2">${t.title}</td>
        <td class="py-2">$${Number(t.maxBid).toFixed(2)}</td>
        <td class="py-2">${formatCountdown(t.endTimeMs)}</td>
        <td class="py-2">${t.status}</td>
      </tr>`
    )
    .join('');
}

setInterval(render, 100);

async function loadInitial() {
  const res = await fetch('/api/state');
  const data = await res.json();
  targets = data.targets ?? [];
  accountsNode.innerHTML = (data.accounts ?? [])
    .map((a) => `<li>${a.id} <span class="text-slate-500">(token: ${new Date(a.refreshedAt).toLocaleTimeString()})</span></li>`)
    .join('');
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
  accountStatus.textContent = 'Refreshing...';
  await fetch('/api/accounts/refresh', { method: 'POST' });
  accountStatus.textContent = 'Tokens refreshed';
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
