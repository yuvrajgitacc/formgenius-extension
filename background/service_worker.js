// service_worker.js — FormGenius Background Engine v1.2.0
// Universal AI Client with zero CORS restrictions (Gemini / Groq / Grok / OpenAI)

function detectProvider(apiKey, preferredProvider = 'auto') {
  const cleanKey = String(apiKey || '').trim();
  if (cleanKey.startsWith('gsk_')) return 'groq';
  if (cleanKey.startsWith('xai-') || cleanKey.startsWith('xai_')) return 'grok';
  if (cleanKey.startsWith('AIza') || cleanKey.startsWith('AQ') || cleanKey.startsWith('AQ.')) return 'gemini';
  if (cleanKey.startsWith('sk-or-')) return 'openrouter';
  if (cleanKey.startsWith('sk-')) return 'openai';

  if (preferredProvider && preferredProvider !== 'auto') {
    return preferredProvider;
  }
  return 'gemini';
}

async function handleUniversalAICall(options) {
  const { apiKey, provider = 'auto', prompt, isJson = false } = options || {};
  if (!apiKey) throw new Error('API Key is missing');

  const resolved = detectProvider(apiKey, provider);

  if (resolved === 'groq') {
    return await callGroqAPI(apiKey, prompt, isJson);
  } else if (resolved === 'grok') {
    return await callGrokAPI(apiKey, prompt, isJson);
  } else if (resolved === 'openai' || resolved === 'openrouter') {
    const isRouter = resolved === 'openrouter' || (apiKey && apiKey.startsWith('sk-or-'));
    return await callOpenAICompatible(apiKey, prompt, isJson, isRouter);
  } else {
    return await callGeminiUniversal(apiKey, prompt, isJson);
  }
}

// ── Google Gemini API (Dynamic Discovery + Dual Key Auth + No Deprecated Models) ──
let cachedGeminiModelSW = null;

async function getBestGeminiModelSW(cleanKey) {
  // Never use a stale cache — always re-discover to avoid dead model errors
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': cleanKey,
        'Content-Type': 'application/json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      const models = (data?.models || [])
        .filter(m => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => (m.name || '').replace(/^models\//, ''));

      // ONLY current active models - no decommissioned or retired models
      const preferred = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-pro'
      ];

      for (const p of preferred) {
        if (models.includes(p)) {
          cachedGeminiModelSW = p;
          return p;
        }
      }

      const flash = models.find(m => m.includes('flash') && !m.includes('8b') && !m.includes('1.5'));
      if (flash) {
        cachedGeminiModelSW = flash;
        return flash;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message;
      if (msg && (msg.includes('API key not valid') || msg.includes('PERMISSION_DENIED') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded'))) {
        throw new Error(`Gemini: ${msg}`);
      }
    }
  } catch (err) {
    if (err.message && err.message.startsWith('Gemini:')) throw err;
  }

  return 'gemini-2.5-flash';
}

async function callGeminiUniversal(apiKey, prompt, isJson = false) {
  const cleanKey = String(apiKey || '').replace(/["'`\s]/g, '').trim();
  if (!cleanKey) throw new Error('Gemini: API key is empty');

  const dynamicModel = await getBestGeminiModelSW(cleanKey);

  // Strictly active production models only
  const candidateModels = [
    dynamicModel,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;

  for (const model of candidateModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const payload = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: isJson ? 350 : 1500
          }
        };

        if (isJson) {
          payload.generationConfig.responseMimeType = 'application/json';
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;
        let response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok && isJson && response.status === 400) {
          delete payload.generationConfig.responseMimeType;
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': cleanKey
            },
            body: JSON.stringify(payload)
          });
        }

        if (response.status === 429) {
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          throw new Error(`Gemini (${model}): Rate limit / quota reached. Please wait a moment before trying again.`);
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${response.status}`;
          lastError = new Error(`Gemini (${model}): ${errMsg}`);

          if (errMsg.includes('API key not valid') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota exceeded')) {
            throw lastError;
          }
          // Clear bad cached model so next call re-discovers
          if (cachedGeminiModelSW === model) cachedGeminiModelSW = null;
          break; // Try next model
        }

        const data = await response.json();
        const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (!text) throw new Error(`Empty response from Gemini (${model})`);
        cachedGeminiModelSW = model;
        return text;
      } catch (err) {
        lastError = err;
        if (err.message && (err.message.includes('API key not valid') || err.message.includes('PERMISSION_DENIED') || err.message.includes('Rate limit') || err.message.includes('RESOURCE_EXHAUSTED'))) {
          throw err;
        }
      }
    }
  }

  throw lastError || new Error('Gemini API request failed. Please check your key at aistudio.google.com');
}

// ── Groq API (Dynamic Model Discovery + Fallbacks) ──
let cachedGroqModelSW = null;

async function getBestGroqModelSW(apiKey) {
  if (cachedGroqModelSW) return cachedGroqModelSW;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      }
    });
    if (res.ok) {
      const data = await res.json();
      const list = (data.data || []).map(m => m.id);
      
      // ONLY active production models - NO decommissioned gemma or mixtral
      if (list.includes('llama-3.3-70b-versatile')) {
        cachedGroqModelSW = 'llama-3.3-70b-versatile';
        return 'llama-3.3-70b-versatile';
      }
      if (list.includes('llama-3.1-8b-instant')) {
        cachedGroqModelSW = 'llama-3.1-8b-instant';
        return 'llama-3.1-8b-instant';
      }
      const textModel = list.find(id => id.startsWith('llama-3') && !id.includes('guard'));
      if (textModel) {
        cachedGroqModelSW = textModel;
        return textModel;
      }
    }
  } catch (_) {}
  return 'llama-3.3-70b-versatile';
}

async function callGroqAPI(apiKey, prompt, isJson = false) {
  const cleanKey = String(apiKey || '').trim();
  const dynamicModel = await getBestGroqModelSW(apiKey);

  // ONLY verified active Groq production models - no gemma, no mixtral, no llama3-8b-8192
  const models = [
    dynamicModel,
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const payload = {
          model,
          messages: [
            {
              role: 'system',
              content: isJson
                ? 'You are an expert exam solver. You MUST output ONLY valid JSON matching the exact requested format. Do NOT wrap in markdown fences. No explanations outside JSON.'
                : 'You are an elite competitive programmer. Output ONLY pure, valid code with no markdown fences and no explanations.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: isJson ? 2048 : 1500
        };

        if (isJson) {
          payload.response_format = { type: 'json_object' };
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleanKey}`
          },
          body: JSON.stringify(payload)
        });

        if (response.status === 429) {
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          throw new Error(`Groq (${model}): Rate limit reached (TPM/RPM exceeded). Please wait a few seconds before continuing.`);
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${response.status} ${response.statusText}`;

          if (response.status === 401 || response.status === 403) {
            throw new Error(`Groq: Invalid or expired API key (${errMsg})`);
          }

          lastError = new Error(`Groq (${model}): ${errMsg}`);
          break; // Surface the real error from Groq immediately, don't mask it
        }

        const data = await response.json();
        const text = (data?.choices?.[0]?.message?.content || '').trim();
        if (!text) {
          throw new Error(`Empty response from Groq (${model})`);
        }
        cachedGroqModelSW = model;
        return text;
      } catch (err) {
        lastError = err;
        if (err.message && (err.message.includes('Invalid') || err.message.includes('Rate limit'))) {
          throw err;
        }
      }
    }
  }

  throw lastError || new Error('Groq request failed. Please verify your API key at console.groq.com');
}

// ── xAI Grok API (Dynamic Model Discovery + Fallbacks) ──
let cachedGrokModelSW = null;

async function getBestGrokModelSW(apiKey) {
  if (cachedGrokModelSW) return cachedGrokModelSW;
  try {
    const res = await fetch('https://api.x.ai/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      }
    });
    if (res.ok) {
      const data = await res.json();
      const list = (data.data || []).map(m => m.id);
      const textModels = list.filter(id => !id.includes('image') && !id.includes('stt') && !id.includes('video'));
      const preferred =
        textModels.find(id => id.includes('grok-4')) ||
        textModels.find(id => id.includes('grok-2-latest')) ||
        textModels.find(id => id.includes('grok-2')) ||
        textModels.find(id => id.includes('grok-beta')) ||
        textModels[0];
      if (preferred) {
        cachedGrokModelSW = preferred;
        return preferred;
      }
    }
  } catch (_) {}
  return 'grok-2-latest';
}

async function callGrokAPI(apiKey, prompt, isJson = false) {
  const cleanKey = String(apiKey || '').trim();
  const dynamicModel = await getBestGrokModelSW(apiKey);

  const candidateModels = [
    dynamicModel,
    'grok-4.7',
    'grok-4.6',
    'grok-2-latest',
    'grok-2',
    'grok-beta'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;

  for (let idx = 0; idx < candidateModels.length; idx++) {
    const targetModel = candidateModels[idx];
    try {
      const payload = {
        model: targetModel,
        messages: [
          {
            role: 'system',
            content: isJson
              ? 'You are an expert exam solver. Output ONLY valid JSON matching the format. No markdown fences or explanations.'
              : 'You are an elite competitive programmer. Output ONLY pure executable code without markdown or explanation.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1
      };

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `HTTP ${response.status} ${response.statusText}`;

        if (response.status === 401 || response.status === 403) {
          throw new Error(`xAI Grok: Invalid or expired API key (${errMsg})`);
        }
        if (response.status === 429) {
          throw new Error(`xAI Grok: Rate limit or credits exhausted (${errMsg})`);
        }

        lastError = new Error(`Grok (${targetModel}): ${errMsg}`);
        continue;
      }

      const data = await response.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new Error(`Empty response from Grok (${targetModel})`);
      cachedGrokModelSW = targetModel;
      return text;
    } catch (err) {
      lastError = err;
      if (err.message && (err.message.includes('Invalid') || err.message.includes('Rate limit'))) {
        throw err;
      }
      continue;
    }
  }

  throw lastError || new Error('All Grok model endpoints failed');
}

// ── OpenAI / OpenRouter API ──
async function callOpenAICompatible(apiKey, prompt, isJson = false, isRouter = false) {
  const url = isRouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const targetModel = isRouter ? 'meta-llama/llama-3.3-70b-instruct' : 'gpt-4o-mini';

  const payload = {
    model: targetModel,
    messages: [
      {
        role: 'system',
        content: isJson
          ? 'You are an expert exam solver. Return ONLY valid JSON with no markdown and no conversational text.'
          : 'You are an elite competitive programmer. Return ONLY raw executable code with no markdown and no explanation.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey.trim()}`
  };

  if (isRouter) {
    headers['HTTP-Referer'] = 'https://formgenius.ai';
    headers['X-Title'] = 'FormGenius';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`AI Provider: ${errData?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('AI returned an empty response');
  return text;
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
  } catch (_) {
    return null;
  }
}

// ── Keyboard Shortcuts (Alt+Shift+S for Form/MCQ, Alt+Shift+C for Code) ──
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'solve-form' || command === 'solve-code') {
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
        return;
      }

      const { apiKey, aiProvider } = await chrome.storage.sync.get(['apiKey', 'aiProvider']);
      if (!apiKey) return;

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

      const action = (command === 'solve-code') ? 'SOLVE_CODE' : 'SOLVE_FORM';
      await chrome.tabs.sendMessage(tab.id, { action, apiKey, provider: aiProvider || 'auto' });

    } catch (_) {}
  }
});

// ── Message Listener ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'CALL_UNIVERSAL_AI') {
    handleUniversalAICall(message.payload)
      .then(text => sendResponse({ success: true, text }))
      .catch(err => sendResponse({ success: false, error: err.message || 'AI request failed' }));
    return true; // Keep message channel open for async response
  }

  if (message && message.action === 'UPDATE_STATS') {
    chrome.storage.sync.get(['solvedForms', 'totalQuestions'], (data) => {
      const newForms = (data.solvedForms || 0) + 1;
      const newQuestions = (data.totalQuestions || 0) + (message.questionsCount || 1);
      chrome.storage.sync.set({ solvedForms: newForms, totalQuestions: newQuestions });
    });
    return true;
  }
  return true;
});
