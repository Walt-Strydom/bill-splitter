// ============================================================
//  Bill Splitter ZAR – Main Application
//  Vanilla JS SPA, no build tools required.
// ============================================================

'use strict';

/* ── State ─────────────────────────────────────────────────── */
const state = {
  user:        null,   // { user_id, name, email, picture_url } or null (anon)
  party:       null,   // party object
  guest:       null,   // current guest record
  items:       [],     // party items from server
  mySelections:{},     // { [item_id]: quantity }
  validation:  null,   // latest party_validation_view result
  guests:      [],     // all party guests
  pollTimer:   null,
  myTotals: {
    subtotal_cents: 0,
    tip_cents:      0,
    total_due_cents:0,
    amount_paid_cents: 0
  }
};

/* ── Helpers ────────────────────────────────────────────────── */
const N8N = () => window.CONFIG.N8N_URL;

function zarFormat(cents) {
  return 'R' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${N8N()}/webhook/${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/* ── Toast ──────────────────────────────────────────────────── */
function toast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

/* ── View Router ────────────────────────────────────────────── */
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');
}

/* ── Persistence ────────────────────────────────────────────── */
function saveSession() {
  try {
    localStorage.setItem('bs_session', JSON.stringify({
      user:  state.user,
      party: state.party,
      guest: state.guest
    }));
  } catch (_) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem('bs_session');
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.user  = saved.user  || null;
    state.party = saved.party || null;
    state.guest = saved.guest || null;
  } catch (_) {}
}

function clearSession() {
  state.user  = null;
  state.party = null;
  state.guest = null;
  state.items = [];
  state.mySelections = {};
  state.validation   = null;
  state.guests       = [];
  try { localStorage.removeItem('bs_session'); } catch (_) {}
}

/* ── Google Sign-In ─────────────────────────────────────────── */
function initGoogleSignIn() {
  if (!window.google?.accounts?.id) return;
  google.accounts.id.initialize({
    client_id: window.CONFIG.GOOGLE_CLIENT_ID,
    callback:  handleGoogleCallback
  });
  google.accounts.id.renderButton(
    document.getElementById('google-signin-btn'),
    { theme: 'filled_blue', size: 'large', width: 280, text: 'sign_in_with_google' }
  );
}

async function handleGoogleCallback(response) {
  try {
    const result = await api('google-login', 'POST', { id_token: response.credential });
    state.user = result;
    saveSession();
    enterHome();
  } catch (err) {
    toast('Google sign-in failed: ' + err.message, 'error');
  }
}

/* ── Home ───────────────────────────────────────────────────── */
function enterHome() {
  showView('home');
  updateHomeUI();
}

function updateHomeUI() {
  const userChip    = document.getElementById('user-chip');
  const userAvatar  = document.getElementById('user-avatar');
  const userNameChip= document.getElementById('user-name-chip');
  const btnAnalytics= document.getElementById('btn-analytics');

  if (state.user) {
    userChip.classList.remove('hidden');
    userNameChip.textContent = state.user.name || state.user.email || 'User';
    if (state.user.picture_url) {
      userAvatar.src = state.user.picture_url;
      userAvatar.style.display = 'block';
    } else {
      userAvatar.style.display = 'none';
    }
    btnAnalytics.style.display = 'inline-flex';
  } else {
    userChip.classList.add('hidden');
    btnAnalytics.style.display = 'none';
  }
}

/* ── Home Tabs ──────────────────────────────────────────────── */
document.querySelectorAll('.home-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.home-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-create').style.display = tab === 'create' ? 'flex' : 'none';
    document.getElementById('tab-join').style.display   = tab === 'join'   ? 'flex' : 'none';
  });
});

/* ── Tip slider ─────────────────────────────────────────────── */
const tipInput   = document.getElementById('inp-tip');
const tipDisplay = document.getElementById('tip-display');
tipInput.addEventListener('input', () => {
  tipDisplay.textContent = tipInput.value + '%';
});

/* ── Create Party ───────────────────────────────────────────── */
document.getElementById('btn-create-party').addEventListener('click', async () => {
  const restaurantName = document.getElementById('inp-restaurant').value.trim();
  const displayName    = document.getElementById('inp-host-name').value.trim();
  const tipPercent     = parseInt(tipInput.value, 10);

  if (!displayName) { toast('Enter your display name', 'error'); return; }

  const btn = document.getElementById('btn-create-party');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating…';

  try {
    const result = await api('create-party', 'POST', {
      restaurant_name: restaurantName,
      display_name:    displayName,
      tip_percent:     tipPercent,
      user_id:         state.user?.user_id || null
    });

    state.party = result.party;
    state.guest = result.guest;
    state.mySelections = {};
    saveSession();
    enterParty();
  } catch (err) {
    toast('Failed to create party: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Party';
  }
});

/* ── Join Party ─────────────────────────────────────────────── */
document.getElementById('btn-join-party').addEventListener('click', async () => {
  const partyCode  = document.getElementById('inp-party-code').value.trim().toUpperCase();
  const displayName= document.getElementById('inp-guest-name').value.trim();

  if (!partyCode)   { toast('Enter a party code', 'error');   return; }
  if (!displayName) { toast('Enter your display name', 'error'); return; }

  const btn = document.getElementById('btn-join-party');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Joining…';

  try {
    const result = await api('join-party', 'POST', {
      party_code:   partyCode,
      display_name: displayName,
      user_id:      state.user?.user_id || null
    });

    state.party = result.party;
    state.guest = result.guest;
    state.items = result.items || [];
    state.mySelections = {};
    saveSession();
    enterParty();
  } catch (err) {
    toast('Failed to join: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Join Party';
  }
});

/* ── Party View ─────────────────────────────────────────────── */
function enterParty() {
  showView('party');
  renderPartyHeader();
  renderReceiptTab();
  startPolling();
}

function renderPartyHeader() {
  const party = state.party;
  document.getElementById('party-code-text').textContent      = party.party_code;
  document.getElementById('party-restaurant-topbar').textContent =
    party.restaurant_name || 'Party';

  // Show receipt tab only for host
  const isHost = state.guest?.role === 'host';
  const receiptTabBtn = document.getElementById('ptab-receipt-btn');
  receiptTabBtn.style.display = isHost ? 'block' : 'none';

  // Show host close section only for host
  document.getElementById('host-close-section').classList.toggle('hidden', !isHost);
}

/* ── Party Tabs ─────────────────────────────────────────────── */
document.querySelectorAll('.party-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.party-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.party-tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('ptab-' + btn.dataset.ptab).classList.add('active');
  });
});

/* Copy party code to clipboard */
document.getElementById('party-code-badge').addEventListener('click', () => {
  const code = state.party?.party_code || '';
  navigator.clipboard?.writeText(code).then(() => toast(`Code ${code} copied!`, 'success'));
});

/* ── Polling ────────────────────────────────────────────────── */
function startPolling() {
  stopPolling();
  pollNow();
  state.pollTimer = setInterval(pollNow, window.CONFIG.POLL_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

async function pollNow() {
  if (!state.party) return;
  try {
    const data = await api(`party-validate?party_id=${state.party.id}`);
    applyValidationUpdate(data);
  } catch (_) {
    // Silent fail on poll
  }
}

function applyValidationUpdate(data) {
  state.validation = data.validation;
  state.items      = data.items || [];
  state.guests     = data.guests || [];

  // Update my selections from server (all_selections keyed by guest_id)
  if (data.all_selections && state.guest) {
    const mine = data.all_selections[state.guest.id] || [];
    mine.forEach(s => { state.mySelections[s.item_id] = s.quantity; });
  }

  // Compute my totals
  if (state.validation && state.guest) {
    const me = state.guests.find(g => g.id === state.guest.id);
    if (me) {
      state.myTotals = {
        subtotal_cents:    me.subtotal_cents,
        tip_cents:         me.tip_cents,
        total_due_cents:   me.total_due_cents,
        amount_paid_cents: me.amount_paid_cents
      };
      // Update guest status in local state
      state.guest.status = me.status;
    }
  }

  renderStatusBanner();
  renderItemList();
  renderUnclaimedSection();
  renderPaymentTab();
  renderGuestsList();

  // Stop polling if party is closed
  if (data.party?.status === 'closed') {
    stopPolling();
    toast('Party has been closed.', 'info');
  }
}

/* ── Status Banner ──────────────────────────────────────────── */
function renderStatusBanner() {
  const v   = state.validation;
  const banner  = document.getElementById('status-banner');
  const icon    = document.getElementById('status-icon');
  const message = document.getElementById('status-message');

  if (!v) return;

  if (state.party?.status === 'closed') {
    banner.className = 'status-banner closed';
    icon.textContent = '✅';
    message.textContent = 'Party is closed. All done!';
    return;
  }

  if (v.party_can_pay) {
    banner.className = 'status-banner ready';
    icon.textContent = '✅';
    message.textContent = 'All items claimed! Everyone can now pay their tab.';
  } else {
    banner.className = 'status-banner pending';
    icon.textContent = '⏳';
    const lines = [];
    if (!v.bucket_empty)    lines.push('Some items are still unclaimed');
    if (!v.subtotal_match)  lines.push(`${zarFormat(v.remaining_value_cents)} still uncovered`);
    message.innerHTML = 'Waiting for all items to be claimed:<ul>'
      + lines.map(l => `<li>${l}</li>`).join('') + '</ul>';
  }
}

/* ── Item Claim List ────────────────────────────────────────── */
function renderItemList() {
  const container = document.getElementById('item-list');
  if (!state.items || state.items.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding:24px 0;">Waiting for host to upload the receipt…</p>';
    return;
  }

  container.innerHTML = '';

  state.items.forEach(item => {
    const myClaimed   = state.mySelections[item.id] || 0;
    const allClaimed  = Number(item.claimed_quantity) || 0;
    const othersQty   = allClaimed - myClaimed;
    const available   = item.total_quantity - othersQty;
    const canIncrease = myClaimed < available;
    const canDecrease = myClaimed > 0;
    const fullyDone   = Number(item.remaining_quantity) === 0;

    const row = document.createElement('div');
    row.className = 'item-row' + (fullyDone ? ' fully-claimed' : '');
    row.dataset.itemId = item.id;

    const myVal = myClaimed * item.unit_price_cents;

    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">${escHtml(item.name)}</div>
        <div class="item-price">
          ${zarFormat(item.unit_price_cents)} × ${item.total_quantity}
          = ${zarFormat(item.unit_price_cents * item.total_quantity)}
        </div>
        <div class="item-avail">
          Others: ${othersQty} &bull; Available: ${Math.max(0, available)} &bull; Mine: ${myClaimed}
          ${myVal > 0 ? `<span style="color:var(--zar); margin-left:6px;">${zarFormat(myVal)}</span>` : ''}
        </div>
      </div>
      <div class="item-controls">
        <button class="qty-btn qty-dec" data-item="${item.id}" ${canDecrease ? '' : 'disabled'}>−</button>
        <span class="qty-display">${myClaimed}</span>
        <button class="qty-btn qty-inc" data-item="${item.id}" ${canIncrease ? '' : 'disabled'}>+</button>
      </div>
    `;
    container.appendChild(row);
  });

  // Attach events
  container.querySelectorAll('.qty-inc').forEach(btn => {
    btn.addEventListener('click', () => changeQty(btn.dataset.item, 1));
  });
  container.querySelectorAll('.qty-dec').forEach(btn => {
    btn.addEventListener('click', () => changeQty(btn.dataset.item, -1));
  });
}

function changeQty(itemId, delta) {
  const item       = state.items.find(i => i.id === itemId);
  if (!item) return;
  const allClaimed = Number(item.claimed_quantity) || 0;
  const myClaimed  = state.mySelections[itemId] || 0;
  const othersQty  = allClaimed - myClaimed;
  const available  = item.total_quantity - othersQty;

  let newQty = myClaimed + delta;
  newQty = Math.max(0, Math.min(available, newQty));
  state.mySelections[itemId] = newQty;
  renderItemList();
  renderUnclaimedSection();
  renderMyTotalsLocal();
}

/* ── Unclaimed Section ──────────────────────────────────────── */
function renderUnclaimedSection() {
  const section = document.getElementById('unclaimed-section');
  const list    = document.getElementById('unclaimed-list');
  const v       = state.validation;
  if (!v || v.bucket_empty) { section.classList.add('hidden'); return; }

  const unclaimed = (state.items || []).filter(i => Number(i.remaining_quantity) > 0);
  if (!unclaimed.length) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  list.innerHTML = unclaimed.map(i => `
    <div class="unclaimed-item">
      <span class="unclaimed-name">${escHtml(i.name)}</span>
      <div class="unclaimed-meta">
        <div class="unclaimed-remaining">×${i.remaining_quantity} remaining</div>
        <div>${zarFormat(Number(i.remaining_quantity) * Number(i.unit_price_cents))}</div>
      </div>
    </div>
  `).join('');
}

/* ── Save Selections ────────────────────────────────────────── */
document.getElementById('btn-save-selections').addEventListener('click', async () => {
  if (!state.guest) { toast('Not in a party', 'error'); return; }

  const selections = Object.entries(state.mySelections).map(([item_id, quantity]) => ({
    item_id,
    quantity: parseInt(quantity, 10)
  })).filter(s => s.quantity >= 0);

  const btn = document.getElementById('btn-save-selections');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    await api('save-selections', 'POST', {
      join_token: state.guest.join_token,
      selections
    });
    toast('Selections saved!', 'success');
    await pollNow();
  } catch (err) {
    toast('Failed to save: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save My Claims';
  }
});

/* ── Payment Tab ────────────────────────────────────────────── */
function renderPaymentTab() {
  const t = state.myTotals;
  document.getElementById('my-subtotal').textContent  = zarFormat(t.subtotal_cents);
  document.getElementById('my-tip').textContent       = zarFormat(t.tip_cents);
  document.getElementById('my-total-due').textContent = zarFormat(t.total_due_cents);
  document.getElementById('tip-pct-display').textContent = state.party?.tip_percent || 0;

  const amtPaid = parseFloat(document.getElementById('inp-amount-paid').value) * 100 || 0;
  updatePayBtn(amtPaid);

  // Host close button
  const isHost    = state.guest?.role === 'host';
  const allClosed = state.guests.length > 0 && state.guests.every(g => g.status === 'closed');
  const closeBtn  = document.getElementById('btn-close-party');
  if (isHost) {
    closeBtn.disabled = !allClosed;
  }
}

function renderMyTotalsLocal() {
  // Compute locally without waiting for poll
  const partySubtotal = state.validation?.subtotal_required || 0;
  const tipPct        = state.party?.tip_percent || 0;
  const partyTipCents = Math.round(partySubtotal * tipPct / 100);
  let mySubtotal = 0;
  (state.items || []).forEach(item => {
    const qty = state.mySelections[item.id] || 0;
    mySubtotal += qty * item.unit_price_cents;
  });
  const myTip      = partySubtotal > 0
    ? Math.round((mySubtotal / partySubtotal) * partyTipCents)
    : 0;
  const myTotal    = mySubtotal + myTip;

  document.getElementById('my-subtotal').textContent  = zarFormat(mySubtotal);
  document.getElementById('my-tip').textContent       = zarFormat(myTip);
  document.getElementById('my-total-due').textContent = zarFormat(myTotal);
}

document.getElementById('inp-amount-paid').addEventListener('input', () => {
  const amtPaid = parseFloat(document.getElementById('inp-amount-paid').value) * 100 || 0;
  updatePayBtn(amtPaid);
});

function updatePayBtn(amtPaidCents) {
  const v          = state.validation;
  const isClosed   = state.guest?.status === 'closed';
  const canPayGlobal = v?.party_can_pay || false;
  const totalDue   = state.myTotals.total_due_cents;
  const sufficient = amtPaidCents >= totalDue;

  const btn = document.getElementById('btn-ive-paid');
  const msg = document.getElementById('payment-status-msg');

  if (isClosed) {
    btn.disabled = true;
    msg.textContent = 'Your tab is closed.';
    return;
  }
  if (!canPayGlobal) {
    btn.disabled = true;
    msg.textContent = 'Waiting for all items to be claimed first.';
    return;
  }
  if (!sufficient && totalDue > 0) {
    btn.disabled = true;
    msg.textContent = `Minimum: ${zarFormat(totalDue)}`;
    return;
  }
  btn.disabled = false;
  msg.textContent = '';
}

/* ── I've Paid ──────────────────────────────────────────────── */
document.getElementById('btn-ive-paid').addEventListener('click', async () => {
  const amtPaidCents = Math.round(parseFloat(document.getElementById('inp-amount-paid').value) * 100);
  if (!amtPaidCents || amtPaidCents <= 0) { toast('Enter a valid amount', 'error'); return; }

  const btn = document.getElementById('btn-ive-paid');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Processing…';

  try {
    // Save payment record
    await api('save-payment', 'POST', {
      join_token:        state.guest.join_token,
      amount_paid_cents: amtPaidCents
    });

    // Then close guest tab
    await api('close-guest', 'POST', {
      join_token: state.guest.join_token
    });

    state.guest.status = 'closed';
    saveSession();
    toast('Tab closed! You\'re all done.', 'success');
    await pollNow();
  } catch (err) {
    toast('Payment failed: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'I\'ve Paid';
  }
});

/* ── Close Party (Host) ─────────────────────────────────────── */
document.getElementById('btn-close-party').addEventListener('click', async () => {
  if (!confirm('Close the party? This cannot be undone.')) return;

  const btn = document.getElementById('btn-close-party');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Closing…';

  try {
    await api('close-party', 'POST', { join_token: state.guest.join_token });
    toast('Party closed!', 'success');
    stopPolling();
    state.party.status = 'closed';
    await pollNow();
  } catch (err) {
    toast('Failed to close party: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Close Party';
  }
});

/* ── Guests List ────────────────────────────────────────────── */
function renderGuestsList() {
  const list = document.getElementById('guests-list');
  document.getElementById('guest-count').textContent = state.guests.length;

  if (!state.guests.length) {
    list.innerHTML = '<p class="text-muted text-center" style="padding:12px 0;">No guests yet.</p>';
    return;
  }

  list.innerHTML = state.guests.map(g => `
    <div class="guest-row">
      <div class="guest-name-col">
        <div class="guest-avatar">${escHtml(g.display_name.charAt(0).toUpperCase())}</div>
        <div>
          <div class="guest-name">${escHtml(g.display_name)}
            <span class="guest-role-tag ${g.role}">${g.role}</span>
          </div>
          <div style="font-size:.78rem; color:var(--text-muted);">
            ${zarFormat(g.subtotal_cents)} + ${zarFormat(g.tip_cents)} tip = ${zarFormat(g.total_due_cents)}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-8">
        <div class="guest-status-dot ${g.status}"></div>
        <span class="chip ${g.status === 'closed' ? 'chip-green' : 'chip-yellow'}">${g.status}</span>
      </div>
    </div>
  `).join('');
}

/* ── Receipt Upload (Host) ──────────────────────────────────── */
function renderReceiptTab() {
  const isHost = state.guest?.role === 'host';
  if (!isHost) return;

  const uploadArea  = document.getElementById('upload-area');
  const fileInput   = document.getElementById('inp-receipt-file');
  const preview     = document.getElementById('upload-preview');
  const previewImg  = document.getElementById('preview-img');
  const processBtn  = document.getElementById('btn-process-receipt');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    uploadArea.classList.add('dragging');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragging'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file) handleReceiptFile(file, preview, previewImg, processBtn);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) handleReceiptFile(file, preview, previewImg, processBtn);
  });

  processBtn.addEventListener('click', () => processReceipt(fileInput.files[0]));
}

function handleReceiptFile(file, preview, previewImg, processBtn) {
  const reader = new FileReader();
  reader.onload = e => {
    previewImg.src = e.target.result;
    preview.classList.remove('hidden');
    processBtn.classList.remove('hidden');
    // Store file reference
    processBtn._fileData = e.target.result.split(',')[1]; // base64 content
  };
  reader.readAsDataURL(file);
}

async function processReceipt(file) {
  const processBtn = document.getElementById('btn-process-receipt');
  const base64     = processBtn._fileData;
  if (!base64) { toast('Select a receipt image first', 'error'); return; }

  processBtn.disabled = true;
  processBtn.innerHTML = '<span class="spinner"></span> Processing OCR…';

  try {
    const result = await api('upload-receipt', 'POST', {
      join_token:             state.guest.join_token,
      image_base64:           base64,
      google_vision_api_key:  window.CONFIG.GOOGLE_VISION_API_KEY
    });

    const items = result.items || [];
    state.items = items;
    renderParsedItems(items);
    toast(`Extracted ${items.length} items from receipt!`, 'success');
    await pollNow();
  } catch (err) {
    toast('OCR failed: ' + err.message, 'error');
  } finally {
    processBtn.disabled = false;
    processBtn.textContent = 'Process Receipt';
  }
}

function renderParsedItems(items) {
  const section = document.getElementById('parsed-items-section');
  const list    = document.getElementById('parsed-items-list');
  section.classList.remove('hidden');
  list.innerHTML = items.map(item => `
    <div class="item-row">
      <div class="item-info">
        <div class="item-name">${escHtml(item.name)}</div>
        <div class="item-price">
          ${zarFormat(item.unit_price_cents)} × ${item.total_quantity}
          = ${zarFormat(item.unit_price_cents * item.total_quantity)}
        </div>
      </div>
    </div>
  `).join('');
}

/* ── Analytics ──────────────────────────────────────────────── */
document.getElementById('btn-analytics').addEventListener('click', () => {
  showView('analytics');
  loadAnalytics();
});

document.getElementById('btn-back-from-analytics').addEventListener('click', () => {
  showView('home');
});

async function loadAnalytics() {
  if (!state.user) return;
  const userId = state.user.user_id;

  try {
    const data = await api(`analytics?user_id=${userId}`);
    renderBillingHistory(data.billing_history || []);
    renderTopRestaurants(data.top_restaurants || []);
    renderTopPeople(data.top_people || []);
  } catch (err) {
    toast('Failed to load analytics', 'error');
  }
}

function renderBillingHistory(history) {
  const list = document.getElementById('billing-history-list');
  if (!history.length) {
    list.innerHTML = '<p class="text-muted text-center" style="padding:8px 0;">No history yet.</p>';
    return;
  }
  list.innerHTML = history.map(h => `
    <div class="analytics-row">
      <div class="analytics-row-left">
        <strong>${escHtml(h.restaurant_name || 'Unknown')}</strong>
        <span>${new Date(h.party_date).toLocaleDateString('en-ZA')}</span>
      </div>
      <span class="analytics-row-right">${zarFormat(h.total_paid_cents)}</span>
    </div>
  `).join('');
}

function renderTopRestaurants(restaurants) {
  const list = document.getElementById('top-restaurants-list');
  if (!restaurants.length) {
    list.innerHTML = '<p class="text-muted text-center" style="padding:8px 0;">No data yet.</p>';
    return;
  }
  list.innerHTML = restaurants.map((r, i) => `
    <div class="analytics-row">
      <div class="analytics-row-left flex items-center">
        <div class="analytics-rank">${i + 1}</div>
        <div>
          <strong>${escHtml(r.name)}</strong>
          <span>${r.visit_count} visit${r.visit_count !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderTopPeople(people) {
  const list = document.getElementById('top-people-list');
  if (!people.length) {
    list.innerHTML = '<p class="text-muted text-center" style="padding:8px 0;">No data yet.</p>';
    return;
  }
  list.innerHTML = people.map((p, i) => `
    <div class="analytics-row">
      <div class="analytics-row-left flex items-center">
        <div class="analytics-rank">${i + 1}</div>
        <div>
          <strong>${escHtml(p.name)}</strong>
          <span>${p.shared_party_count} shared ${p.shared_party_count !== 1 ? 'parties' : 'party'}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/* ── Sign Out / Back ────────────────────────────────────────── */
document.getElementById('btn-logout').addEventListener('click', () => {
  stopPolling();
  clearSession();
  showView('login');
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
});

document.getElementById('btn-anon').addEventListener('click', () => {
  state.user = null;
  saveSession();
  enterHome();
});

document.getElementById('btn-back-home').addEventListener('click', () => {
  stopPolling();
  showView('home');
  updateHomeUI();
});

/* ── XSS helper ─────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ── Service Worker ─────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ── Boot ───────────────────────────────────────────────────── */
function boot() {
  loadSession();

  // If we have a valid party session, restore party view
  if (state.party && state.guest) {
    enterParty();
    return;
  }

  // If we have a user, go to home
  if (state.user) {
    enterHome();
    return;
  }

  // Otherwise show login
  showView('login');

  // Init Google sign-in after GSI script loads
  if (window.google?.accounts?.id) {
    initGoogleSignIn();
  } else {
    // Retry once GSI loads
    window.addEventListener('load', initGoogleSignIn);
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initGoogleSignIn, 1000);
    });
  }
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
