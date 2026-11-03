function detectProviderFromKey(key) {
  const clean = String(key || '').replace(/["'`\s]/g, '').trim();
  if (clean.startsWith('gsk_')) return 'groq';
  if (clean.startsWith('xai-') || clean.startsWith('xai_')) return 'grok';
  if (clean.startsWith('AIza') || clean.startsWith('AQ') || clean.startsWith('AQ.')) return 'gemini';
  if (clean.startsWith('sk-or-')) return 'openrouter';
  if (clean.startsWith('sk-')) return 'openai';
  return null;
}

function getFriendlyProviderName(key, provider) {
  const detected = detectProviderFromKey(key);
  const p = detected || provider;
  if (p === 'groq') return 'Groq (Ultra-Fast)';
  if (p === 'grok') return 'xAI Grok';
  if (p === 'openai') return 'OpenAI';
  if (p === 'openrouter') return 'OpenRouter';
  return 'Google Gemini';
}

// popup.js — FormGenius Extension Popup Logic v1.2.0

const apiKeyInput = document.getElementById('apiKey');
const providerSelect = document.getElementById('providerSelect');

apiKeyInput.addEventListener('input', () => {
  const val = apiKeyInput.value.trim();
  if (providerSelect) {
    if (val.startsWith('gsk_')) {
      providerSelect.value = 'groq';
    } else if (val.startsWith('xai-') || val.startsWith('xai_')) {
      providerSelect.value = 'grok';
    } else if (val.startsWith('sk-or-')) {
      providerSelect.value = 'openai';
    } else if (val.startsWith('sk-')) {
      providerSelect.value = 'openai';
    } else if (val.startsWith('AIza') || val.startsWith('AQ')) {
      providerSelect.value = 'gemini';
    }
  }
});

const toggleKeyBtn = document.getElementById('toggleKey');
const solveBtn = document.getElementById('solveBtn');
const solveCodeBtn = document.getElementById('solveCodeBtn');
const saveBtn = document.getElementById('saveBtn');
const statusDot = document.getElementById('statusDot');
const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');
const solvedCount = document.getElementById('solvedCount');
const questionsCount = document.getElementById('questionsCount');

// ── Toast Notification ──
function showToast(message, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── Safe Active Tab Finder ──
async function getActiveTab() {
  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs[0];
    }
    return tab;
  } catch (e) {
    return null;
  }
}

// ── Load saved data ──
async function init() {
  const data = await chrome.storage.sync.get(['apiKey', 'aiProvider', 'solvedForms', 'totalQuestions']);

  if (data.apiKey) {
    apiKeyInput.value = data.apiKey;
  }
  if (data.aiProvider && providerSelect) {
    providerSelect.value = data.aiProvider;
  }

  solvedCount.textContent = data.solvedForms || 0;
  questionsCount.textContent = data.totalQuestions || 0;

  // Check active tab
  try {
    const tab = await getActiveTab();

    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:') || tab.url.startsWith('edge://')) {
      statusDot.className = 'status-dot inactive';
      statusBanner.className = 'status-card status-banner';
      statusText.textContent = 'Open a Form or Test to solve';
      solveBtn.disabled = true; if (solveCodeBtn) solveCodeBtn.disabled = true;
      return;
    }

    // Active web page (Google Form or Test/Exam Portal like Between, etc.)
    statusDot.className = 'status-dot active';
    statusBanner.className = 'status-card status-banner detected';
    solveBtn.disabled = false; if (solveCodeBtn) solveCodeBtn.disabled = false;

    if (tab.url.includes('docs.google.com/forms')) {
      statusText.textContent = 'Google Form detected! Ready to solve.';
    } else {
      statusText.textContent = 'Portal detected! Ready to solve.';
    }

    // Query content script for live detection
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'DETECT_QUESTIONS' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        if (res.hasPendingSolution) {
          statusText.textContent = 'Code ready in memory! (Alt+Shift+S to inject)';
        } else if (res.count > 0) {
          const detail = res.alreadyAnswered > 0 ? ` (${res.count} left, ${res.alreadyAnswered} solved)` : ` (${res.count} question${res.count > 1 ? 's' : ''})`;
          if (res.isGoogleForm || tab.url.includes('docs.google.com/forms') || tab.url.includes('forms.gle')) {
            statusText.textContent = `Google Form ready${detail}`;
          } else {
            statusText.textContent = `Quiz detected${detail}`;
          }
        } else if (res.alreadyAnswered > 0) {
          statusText.textContent = `All ${res.alreadyAnswered} questions already solved!`;
        }
      });
    } catch (_) {}

  } catch (e) {
    statusText.textContent = 'AI Form Solver Ready';
    solveBtn.disabled = false; if (solveCodeBtn) solveCodeBtn.disabled = false;
  }
}

// ── Toggle API Key visibility ──
toggleKeyBtn.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleKeyBtn.textContent = '🙈';
  } else {
    apiKeyInput.type = 'password';
    toggleKeyBtn.textContent = '👁';
  }
});

// ── Save API Key & Provider ──
saveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.replace(/["'`\s]/g, '').trim();
  if (!key) {
    showToast('❌ Please enter an API key', 'error');
    return;
  }
  const detected = detectProviderFromKey(key);
  const provider = detected || (providerSelect ? providerSelect.value : 'auto');
  if (providerSelect && detected) providerSelect.value = detected;
  await chrome.storage.sync.set({ apiKey: key, aiProvider: provider });
  const name = getFriendlyProviderName(key, provider);
  showToast(`✅ Key saved! Active: ${name}`, 'success');
});

if (providerSelect) {
  providerSelect.addEventListener('change', async () => {
    await chrome.storage.sync.set({ aiProvider: providerSelect.value });
  });
}

// ── Solve Form Button ──
solveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.replace(/["'`\s]/g, '').trim();
  if (!key) {
    showToast('❌ Please enter & save your API key first', 'error');
    return;
  }

  const detected = detectProviderFromKey(key);
  const provider = detected || (providerSelect ? providerSelect.value : 'auto');
  if (providerSelect && detected) providerSelect.value = detected;
  // Save both sanitized key and detected provider
  await chrome.storage.sync.set({ apiKey: key, aiProvider: provider });

  solveBtn.disabled = true; if (solveCodeBtn) solveCodeBtn.disabled = true;
  solveBtn.innerHTML = `<span class="spinner"></span><span>Solving...</span>`;

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      showToast('❌ No active tab found', 'error');
      return;
    }

    // Auto-inject content script if tab was opened before extension was loaded
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
    } catch (_) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content.js']
        });
      } catch (_) {}
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'SOLVE_FORM',
      apiKey: key,
      provider: provider
    });

    if (response && response.success) {
      if (response.mode === 'solution_ready') {
        showToast('💡 Code ready! Click editor & press Alt+Shift+S', 'success');
        statusText.textContent = 'Code ready in memory! (Alt+Shift+S to inject)';
      } else if (response.mode === 'code_injected') {
        showToast('🚀 Code injected into editor!', 'success');
        statusText.textContent = 'Code injected successfully!';
      } else {
        const q = response.questionsAnswered || 0;
        showToast(`✅ ${q} question${q !== 1 ? 's' : ''} answered!`, 'success');
        statusText.textContent = `All ${q} questions answered successfully!`;
      }

      // Update stats
      const data = await chrome.storage.sync.get(['solvedForms', 'totalQuestions']);
      const newForms = (data.solvedForms || 0) + 1;
      const newQuestions = (data.totalQuestions || 0) + (response.questionsAnswered || 1);
      await chrome.storage.sync.set({ solvedForms: newForms, totalQuestions: newQuestions });
      solvedCount.textContent = newForms;
      questionsCount.textContent = newQuestions;
    } else {
      showToast(`❌ ${response?.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showToast('❌ Could not connect to form. Reload the page.', 'error');
  } finally {
    solveBtn.disabled = false; if (solveCodeBtn) solveCodeBtn.disabled = false;
    solveBtn.innerHTML = `<span class="btn-icon">⚡</span><span>Solve Form Now</span>`;
  }
});

// Live progress listener
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.action === 'PROGRESS_UPDATE') {
    if (statusText) statusText.textContent = `Solving: ${msg.current}/${msg.total} questions answered...`;
    if (solveBtn && solveBtn.disabled) {
      solveBtn.innerHTML = `<span class="spinner"></span><span>${msg.current}/${msg.total}...</span>`;
    }
  }
});


// ── Solve Code Button (Technical Coding Solver) ──
if (solveCodeBtn) {
  solveCodeBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showToast('❌ Please enter & save your API key first', 'error');
      return;
    }

    await chrome.storage.sync.set({ apiKey: key });

    solveCodeBtn.disabled = true;
    solveCodeBtn.innerHTML = `<span class="spinner"></span><span>Writing...</span>`;

    try {
      const tab = await getActiveTab();
      if (!tab || !tab.id) {
        showToast('❌ No active tab found', 'error');
        return;
      }

      // Auto-inject if needed
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
      } catch (_) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['content/content.js']
          });
        } catch (_) {}
      }

      const data = await chrome.storage.sync.get(['aiProvider']);
      const provider = data.aiProvider || (providerSelect ? providerSelect.value : 'auto');

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'SOLVE_CODE',
        apiKey: key,
        provider: provider
      });

      if (response && response.success) {
        if (response.mode === 'code_injected') {
          showToast('🚀 Code injected into editor!', 'success');
          statusText.textContent = 'Code injected successfully!';
        } else {
          showToast('💡 Code ready in memory! Click inside editor and press Alt+Shift+C', 'success');
          statusText.textContent = 'Code ready in memory! (Alt+Shift+C to type)';
        }

        const data = await chrome.storage.sync.get(['solvedForms', 'totalQuestions']);
        const newForms = (data.solvedForms || 0) + 1;
        const newQuestions = (data.totalQuestions || 0) + 1;
        await chrome.storage.sync.set({ solvedForms: newForms, totalQuestions: newQuestions });
        solvedCount.textContent = newForms;
        questionsCount.textContent = newQuestions;
      } else {
        showToast(`❌ ${response?.error || 'Could not solve code'}`, 'error');
      }
    } catch (err) {
      showToast('❌ Please refresh (F5) the test tab first!', 'error');
    } finally {
      solveCodeBtn.disabled = false;
      solveCodeBtn.innerHTML = `<span class="btn-icon">💻</span><span>Solve Code</span>`;
    }
  });
}

// ── Initialize ──
init();
