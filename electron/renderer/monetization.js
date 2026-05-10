const STORAGE_KEY = 'godmode.monetization.v1';
const DEFAULT_STATE = {
  enabled: false,
  budget: 100,
  spent: 0,
  costs: {
    walk: 0.01,
    jump: 0.25,
    agentPrompt: 2,
    texture2d: 5,
    model3d: 12,
    glbExport: 1.5,
  },
  transactions: [],
};

const ACTION_LABELS = {
  walk: 'Walk step',
  jump: 'Jump',
  agentPrompt: 'AI agent prompt',
  texture2d: '2D texture generation',
  model3d: '3D model generation',
  glbExport: 'GLB export/download',
};

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function clampMoney(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number * 100) / 100);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaultState();
    const parsed = JSON.parse(raw);
    return {
      ...cloneDefaultState(),
      ...parsed,
      costs: { ...DEFAULT_STATE.costs, ...(parsed.costs || {}) },
      budget: clampMoney(parsed.budget, DEFAULT_STATE.budget),
      spent: clampMoney(parsed.spent, 0),
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions.slice(0, 40) : [],
    };
  } catch {
    return cloneDefaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function remainingBudget(state) {
  return Math.max(0, clampMoney(state.budget - state.spent));
}

function platformLabel(value) {
  return String(value || '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function byAssetType(assetType) {
  return assetType === '3d' ? ['Figure', 'Keychain', 'Plushie'] : ['Sticker', 'Poster', 'T-shirt', 'Plushie'];
}

function describeAsset(description) {
  const clean = String(description || '').trim();
  return clean || 'the latest playable chaos artifact';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createStrategy({ assetType, merchType, platform, description }) {
  const label = platformLabel(platform);
  const asset = describeAsset(description);
  const is3d = assetType === '3d';
  const type = merchType || (is3d ? 'Figure' : 'Sticker');
  const priceTable = {
    Sticker: ['$4', '$8', '55-75%'],
    Poster: ['$16', '$34', '35-55%'],
    'T-shirt': ['$24', '$38', '30-48%'],
    Plushie: ['$28', '$65', '22-42%'],
    Figure: ['$35', '$95', '25-45%'],
    Keychain: ['$9', '$18', '45-65%'],
  };
  const [low, high, margin] = priceTable[type] || ['$12', '$40', '30-50%'];
  const platformNotes = {
    etsy: 'Best for handmade framing, limited drops, and search-led novelty demand.',
    shopify: 'Best when you want full control, bundles, email capture, and repeat drops.',
    gumroad: 'Best for digital extras, preorder files, and low-maintenance launch pages.',
    redbubble: 'Best for 2D print-on-demand validation before committing inventory.',
    printful: 'Best for Shopify-backed apparel and posters with reliable fulfillment.',
    kickstarter: 'Best for figures, plushies, and absurd premium tiers that need MOQ funding.',
    'tiktok-shop': 'Best when the gag reads in three seconds and ships cheaply.',
  };
  const bestPlatforms = is3d
    ? ['Kickstarter', 'Etsy', 'Shopify']
    : ['Redbubble', 'Printful', 'Shopify'];
  const marketingChannels = is3d
    ? ['TikTok build clips', 'Cults3D teaser renders', 'Discord collector polls']
    : ['Short-form reveal posts', 'Reddit devlog screenshots', 'Sticker sheet mockups'];

  return {
    priceRange: `${low}-${high}`,
    marginRange: margin,
    bestPlatforms,
    marketingChannels,
    launchAngle: `${type} drop for ${asset}: tiny proof that the game economy has escaped the screen.`,
    fulfillmentNotes: platformNotes[platform] || `Use ${label} for validation, then move winners into a repeatable fulfillment flow.`,
    risks: is3d
      ? ['Print tolerances can punish skinny silhouettes.', 'Shipping can eat margin on bulky rewards.', 'Licensing must be clear before paid drops.']
      : ['Color matching varies across POD vendors.', 'Simple silhouettes sell faster than muddy screenshots.', 'Avoid over-ordering before the first signal.'],
    nextSteps: [
      'Create one clean hero mockup.',
      'Set a small launch quantity or preorder cap.',
      'Post the first offer as a playable artifact, not generic merch.',
    ],
  };
}

function createLaunchCopy({ assetType, merchType, platform, description }, strategy) {
  const asset = describeAsset(description);
  const type = merchType || (assetType === '3d' ? 'Figure' : 'Sticker');
  const platformName = platformLabel(platform);
  return {
    title: `${asset} ${type}`,
    description: `A limited ${type.toLowerCase()} spawned from GodMode's latest experiment. Built for players who think inventory screens should have consequences.`,
    captions: [
      `The ${type.toLowerCase()} drop is live: ${asset}, now available outside the game loop.`,
      `Sin of Greed approved this merch SKU and immediately charged itself a fee.`,
      `Prototype energy, collector artifact, ${platformName} listing. The economy is behaving normally.`,
    ],
    hashtags: ['#GodMode', '#IndieGameDev', '#GameMerch', '#MadeWithAI', '#Devlog'],
    cta: `Claim the ${type.toLowerCase()} before the next build mutates it.`,
    strategyPrice: strategy?.priceRange,
  };
}

function renderList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderStrategy(strategy) {
  return `
    <div class="monetization-output-grid">
      <div><span>Price</span><strong>${escapeHtml(strategy.priceRange)}</strong></div>
      <div><span>Margin</span><strong>${escapeHtml(strategy.marginRange)}</strong></div>
    </div>
    <div class="monetization-copy-block"><strong>Best platforms</strong>${renderList(strategy.bestPlatforms)}</div>
    <div class="monetization-copy-block"><strong>Marketing channels</strong>${renderList(strategy.marketingChannels)}</div>
    <div class="monetization-copy-block"><strong>Launch angle</strong><p>${escapeHtml(strategy.launchAngle)}</p></div>
    <div class="monetization-copy-block"><strong>Fulfillment notes</strong><p>${escapeHtml(strategy.fulfillmentNotes)}</p></div>
    <div class="monetization-copy-block"><strong>Risks</strong>${renderList(strategy.risks)}</div>
    <div class="monetization-copy-block"><strong>Next steps</strong>${renderList(strategy.nextSteps)}</div>
  `;
}

function renderLaunchCopy(copy) {
  return `
    <div class="monetization-copy-block">
      <strong>${escapeHtml(copy.title)}</strong>
      <p>${escapeHtml(copy.description)}</p>
      ${renderList(copy.captions)}
      <p>${escapeHtml(copy.hashtags.join(' '))}</p>
      <p>${escapeHtml(copy.cta)}</p>
    </div>
  `;
}

export function initMonetization({ setPassthrough } = {}) {
  const els = {
    button: document.getElementById('monetization-btn'),
    modal: document.getElementById('monetization-modal'),
    close: document.getElementById('monetization-close-btn'),
    tabs: Array.from(document.querySelectorAll('.monetization-tab')),
    sections: Array.from(document.querySelectorAll('.monetization-section')),
    enabled: document.getElementById('greed-enabled'),
    budget: document.getElementById('greed-budget'),
    remaining: document.getElementById('greed-remaining'),
    spent: document.getElementById('greed-spent'),
    warning: document.getElementById('greed-warning'),
    log: document.getElementById('greed-log'),
    reset: document.getElementById('greed-reset'),
    notice: document.getElementById('monetization-notice'),
    assetType: document.getElementById('merch-asset-type'),
    merchType: document.getElementById('merch-type'),
    platform: document.getElementById('merch-platform'),
    description: document.getElementById('merch-description'),
    strategyBtn: document.getElementById('merch-generate-strategy'),
    copyBtn: document.getElementById('merch-draft-copy'),
    strategyOutput: document.getElementById('merch-strategy-output'),
    copyOutput: document.getElementById('merch-copy-output'),
  };
  els.costInputs = Array.from(document.querySelectorAll('[data-greed-cost]'));

  let state = loadState();
  let latestStrategy = null;

  function showNotice(message, tone = 'normal') {
    if (!els.notice) return;
    els.notice.textContent = message;
    els.notice.className = `monetization-notice ${tone}`;
  }

  function renderCosts() {
    els.costInputs.forEach((input) => {
      const key = input.dataset.greedCost;
      input.value = state.costs[key] ?? 0;
    });
  }

  function renderLog() {
    if (!els.log) return;
    if (!state.transactions.length) {
      els.log.innerHTML = '<div class="greed-empty">No charges yet. The altar is hungry.</div>';
      return;
    }
    els.log.innerHTML = state.transactions
      .slice(0, 12)
      .map((item) => `
        <div class="greed-log-row">
          <span>${item.label}</span>
          <strong>${MONEY.format(item.amount)}</strong>
        </div>
      `)
      .join('');
  }

  function renderState() {
    if (els.enabled) els.enabled.checked = Boolean(state.enabled);
    if (els.budget) els.budget.value = state.budget.toFixed(2);
    if (els.remaining) els.remaining.textContent = MONEY.format(remainingBudget(state));
    if (els.spent) els.spent.textContent = MONEY.format(state.spent);
    if (els.modal) {
      els.modal.classList.toggle('bankrupt', state.enabled && remainingBudget(state) <= 0);
      els.modal.classList.toggle('low-funds', state.enabled && remainingBudget(state) > 0 && remainingBudget(state) <= state.budget * 0.15);
    }
    if (els.warning) {
      if (!state.enabled) {
        els.warning.textContent = 'Sin of Greed is sleeping. No actions are charged.';
      } else if (remainingBudget(state) <= 0) {
        els.warning.textContent = 'BANKRUPT: the game refuses paid actions.';
      } else if (remainingBudget(state) <= state.budget * 0.15) {
        els.warning.textContent = 'Low funds. Every click now sounds expensive.';
      } else {
        els.warning.textContent = 'Greed enabled. Prototype charges apply before paid actions start.';
      }
    }
    renderCosts();
    renderLog();
    saveState(state);
  }

  function setOpen(open) {
    if (!els.modal) return;
    els.modal.classList.toggle('visible', open);
    els.modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) setPassthrough?.(false);
  }

  function chargeAction(action) {
    if (!state.enabled) return true;
    const amount = clampMoney(state.costs[action] ?? 0);
    if (amount <= 0) return true;
    const remaining = remainingBudget(state);
    if (remaining < amount) {
      showNotice('Sin of Greed denied this action. You are broke.', 'danger');
      setOpen(true);
      return false;
    }
    state.spent = clampMoney(state.spent + amount);
    state.transactions.unshift({
      action,
      label: ACTION_LABELS[action] || action,
      amount,
      at: new Date().toISOString(),
    });
    state.transactions = state.transactions.slice(0, 40);
    showNotice(`${ACTION_LABELS[action] || action} charged ${MONEY.format(amount)}.`, 'success');
    renderState();
    return true;
  }

  function populateMerchTypes() {
    if (!els.merchType) return;
    const current = els.merchType.value;
    const options = byAssetType(els.assetType?.value);
    els.merchType.innerHTML = options.map((option) => `<option value="${option}">${option}</option>`).join('');
    if (options.includes(current)) els.merchType.value = current;
  }

  function currentMerchInput() {
    return {
      assetType: els.assetType?.value || '2d',
      merchType: els.merchType?.value || 'Sticker',
      platform: els.platform?.value || 'etsy',
      description: els.description?.value || '',
    };
  }

  els.button?.addEventListener('mouseenter', () => setPassthrough?.(false));
  els.button?.addEventListener('mouseleave', () => setPassthrough?.(true));
  els.modal?.addEventListener('mouseenter', () => setPassthrough?.(false));
  els.modal?.addEventListener('mouseleave', () => setPassthrough?.(true));
  els.button?.addEventListener('click', () => setOpen(true));
  els.close?.addEventListener('click', () => setOpen(false));
  els.modal?.addEventListener('click', (event) => {
    if (event.target === els.modal) setOpen(false);
  });
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.monetizationTab;
      els.tabs.forEach((item) => item.classList.toggle('active', item === tab));
      els.sections.forEach((section) => section.classList.toggle('active', section.dataset.monetizationSection === target));
    });
  });
  els.enabled?.addEventListener('change', () => {
    state.enabled = els.enabled.checked;
    renderState();
  });
  els.budget?.addEventListener('input', () => {
    state.budget = clampMoney(els.budget.value, DEFAULT_STATE.budget);
    renderState();
  });
  els.costInputs.forEach((input) => {
    input.addEventListener('input', () => {
      state.costs[input.dataset.greedCost] = clampMoney(input.value, DEFAULT_STATE.costs[input.dataset.greedCost] || 0);
      renderState();
    });
  });
  els.reset?.addEventListener('click', () => {
    state.spent = 0;
    state.transactions = [];
    showNotice('Budget reset. Greed looks disappointed.', 'success');
    renderState();
  });
  els.assetType?.addEventListener('change', populateMerchTypes);
  els.strategyBtn?.addEventListener('click', () => {
    latestStrategy = createStrategy(currentMerchInput());
    if (els.strategyOutput) els.strategyOutput.innerHTML = renderStrategy(latestStrategy);
    if (els.copyOutput) els.copyOutput.innerHTML = '';
    if (els.copyBtn) els.copyBtn.disabled = false;
  });
  els.copyBtn?.addEventListener('click', () => {
    if (!latestStrategy) return;
    const copy = createLaunchCopy(currentMerchInput(), latestStrategy);
    if (els.copyOutput) els.copyOutput.innerHTML = renderLaunchCopy(copy);
  });

  populateMerchTypes();
  renderState();

  return {
    chargeAction,
    isMonetizationElement: (target) => Boolean(els.modal?.contains(target) || els.button?.contains(target)),
  };
}
