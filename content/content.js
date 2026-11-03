// content.js — FormGenius v1.2.0 (Stealth + Universal + Google Forms Multi-Pass Engine)
// Works on Google Forms, Between, LeetCode, HackerRank, CodeChef, Moodle, and any custom portal.

(function () {
  'use strict';

  // State
  let pendingSolution = null;
  let isSolving = false;
  let _s = null, _st = null;

  // ═══════════════════════════════════════════
  //  SETTINGS & STORAGE
  // ═══════════════════════════════════════════

  async function getStoredSettings() {
    try {
      const data = await chrome.storage.sync.get(['apiKey', 'aiProvider']);
      return {
        apiKey: (data.apiKey || '').trim(),
        provider: data.aiProvider || 'auto'
      };
    } catch (_) {
      return { apiKey: '', provider: 'auto' };
    }
  }

  // ═══════════════════════════════════════════
  //  NORMALIZERS & PARSERS
  // ═══════════════════════════════════════════

  function normalizeAnswers(parsed) {
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.answers)) return parsed.answers;
    if (Array.isArray(parsed.questions)) return parsed.questions;
    if (Array.isArray(parsed.data)) return parsed.data;

    // If an object with index keys: { "0": "A", "1": "B" }
    const answers = [];
    Object.keys(parsed).forEach(k => {
      const val = parsed[k];
      if (/^\d+$/.test(k)) {
        if (typeof val === 'object' && val !== null && val.answer !== undefined) {
          answers.push({ index: parseInt(k, 10), ...val });
        } else {
          answers.push({ index: parseInt(k, 10), answer: val, type: Array.isArray(val) ? 'checkbox' : 'multiple_choice' });
        }
      } else if (val && typeof val === 'object' && val.index !== undefined) {
        answers.push(val);
      }
    });

    if (answers.length > 0) return answers;
    if (parsed.answer !== undefined || parsed.letter !== undefined) {
      return [{ index: 0, answer: parsed.answer || parsed.letter, type: 'multiple_choice' }];
    }
    return [];
  }

  function safeParseJSON(raw) {
    if (!raw) return null;
    let str = String(raw).trim();

    try {
      return JSON.parse(str);
    } catch (_) {}

    const codeBlockMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch (_) {}
    }

    const firstBracket = str.indexOf('[');
    const lastBracket = str.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(str.slice(firstBracket, lastBracket + 1));
      } catch (_) {}
    }

    const firstBrace = str.indexOf('{');
    const lastBrace = str.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(str.slice(firstBrace, lastBrace + 1));
      } catch (_) {}
    }

    if (firstBracket !== -1) {
      let partial = str.slice(firstBracket).trim();
      const attempts = [partial + '"]}]', partial + '"}]', partial + '}]', partial + ']'];
      for (const att of attempts) {
        try { return JSON.parse(att); } catch (_) {}
      }
    }

    if (firstBrace !== -1) {
      let partial = str.slice(firstBrace).trim();
      const attempts = [partial + '"}', partial + '}'];
      for (const att of attempts) {
        try { return JSON.parse(att); } catch (_) {}
      }
    }

    const answers = [];
    const itemRegex = /{\s*"index"\s*:\s*(\d+)[\s\S]*?"answer"\s*:\s*("[^"]*"|\[[^\]]*\])/g;
    let m;
    while ((m = itemRegex.exec(str)) !== null) {
      try {
        const idx = parseInt(m[1], 10);
        const ansVal = JSON.parse(m[2]);
        answers.push({ index: idx, answer: ansVal, type: Array.isArray(ansVal) ? 'checkbox' : 'multiple_choice' });
      } catch (_) {}
    }
    if (answers.length > 0) return answers;

    const ansMatch = str.match(/"answer"\s*:\s*"([^"]+)"/i) || str.match(/answer\s*[:=]\s*"?([^"\r\n\r,]+)"?/i);
    const letMatch = str.match(/"letter"\s*:\s*"([A-D])"/i) || str.match(/letter\s*[:=]\s*"?([A-D])"?/i);
    if (ansMatch || letMatch) {
      return {
        answer: ansMatch ? ansMatch[1].trim() : '',
        letter: letMatch ? letMatch[1].trim().toUpperCase() : ''
      };
    }

    return null;
  }

  // ═══════════════════════════════════════════
  //  STEALTH STATUS INDICATOR
  // ═══════════════════════════════════════════

  function showStealth(state = 'working') {
    clearTimeout(_st);
    if (!_s) {
      _s = document.createElement('div');
      _s.id = '_fg_stealth_dot';
      document.body.appendChild(_s);
    }
    const colors = {
      working: '#6c63ff',
      ready: '#06b6d4',
      done: '#22c55e',
      error: '#ef4444'
    };
    const c = colors[state] || '#6c63ff';
    const anim = (state === 'working')
      ? 'animation:_fp 0.9s ease-in-out infinite;'
      : (state === 'ready' ? 'animation:_fp 1.4s ease-in-out infinite;' : '');

    _s.setAttribute('style',
      'position:fixed!important;bottom:14px!important;right:14px!important;' +
      'z-index:2147483647!important;pointer-events:none!important;' +
      'opacity:1!important;transition:opacity 0.6s!important;'
    );
    _s.innerHTML = `<span style="display:block;width:9px;height:9px;border-radius:50%;background:${c};box-shadow:0 0 8px ${c};${anim}"></span>`;

    if (!document.getElementById('_fgkf')) {
      const st = document.createElement('style');
      st.id = '_fgkf';
      st.textContent = '@keyframes _fp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.35;transform:scale(0.85)}}';
      document.head.appendChild(st);
    }

    if (state === 'done' || state === 'error') {
      _st = setTimeout(() => {
        if (_s) {
          _s.style.opacity = '0';
          setTimeout(() => { _s?.remove(); _s = null; }, 600);
        }
      }, 1500);
    }
  }

  // ═══════════════════════════════════════════
  //  ACTIVE EDITABLE & CODE INJECTION
  // ═══════════════════════════════════════════

  function getActiveEditable() {
    const active = document.activeElement;

    if (active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'submit', 'hidden'].includes(active.type)))) {
      return active;
    }

    if (active && (active.isContentEditable || active.getAttribute('contenteditable') === 'true')) {
      return active;
    }

    const monacoActive = document.querySelector('.monaco-editor.focused textarea, .monaco-editor textarea:focus');
    if (monacoActive) return monacoActive;

    const aceActive = document.querySelector('.ace_editor.ace_focus textarea, .ace_editor textarea:focus');
    if (aceActive) return aceActive;

    const cmActive = document.querySelector('.CodeMirror-focused textarea, .cm-editor [contenteditable="true"]');
    if (cmActive) return cmActive;

    const anyEditor = document.querySelector('.monaco-editor textarea, .ace_editor textarea, .CodeMirror textarea, .cm-content');
    if (anyEditor) return anyEditor;

    const textareas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
    if (textareas.length === 1) return textareas[0];

    return null;
  }

  function injectCodeIntoElement(el, code) {
    if (!el) return false;
    try {
      el.focus();
      let cleanCode = code.replace(/^```[a-zA-Z]*\r\n?/gm, '').replace(/```$/gm, '').trim();

      let success = false;
      try {
        success = document.execCommand('insertText', false, cleanCode);
      } catch (_) {}

      if (!success || (el.value !== undefined && !el.value.includes(cleanCode.slice(0, 20)))) {
        if (el.isContentEditable) {
          el.innerText = cleanCode;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          el.value = cleanCode;
          triggerEvents(el);
        }
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  // ═══════════════════════════════════════════
  //  UNIVERSAL AI CLIENT (Gemini / Groq / Grok / OpenAI)
  // ═══════════════════════════════════════════

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

  async function callUniversalAI(options) {
    // Priority 1: Execute via Background Service Worker (Bypasses webpage CORS)
    try {
      const bgResult = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({ success: false, error: 'Background timeout' });
        }, 18000);

        chrome.runtime.sendMessage({ action: 'CALL_UNIVERSAL_AI', payload: options }, (res) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false, error: 'No response from background' });
          }
        });
      });

      if (bgResult && bgResult.success && bgResult.text) {
        return bgResult.text;
      }
      if (bgResult && bgResult.error && !bgResult.error.includes('Could not establish connection') && !bgResult.error.includes('timeout')) {
        throw new Error(bgResult.error);
      }
    } catch (e) {
      if (e.message && !e.message.includes('Could not establish connection') && !e.message.includes('timeout')) {
        throw e;
      }
    }

    // Priority 2: Direct execution fallback
    return await executeDirectUniversalAI(options);
  }

  async function executeDirectUniversalAI(options) {
    const { apiKey, provider = 'auto', prompt, isJson = false } = options || {};
    const resolved = detectProvider(apiKey, provider);

    if (resolved === 'groq') {
      return await callGroqDirect(apiKey, prompt, isJson);
    } else if (resolved === 'grok') {
      return await callGrokDirect(apiKey, prompt, isJson);
    } else if (resolved === 'openai' || resolved === 'openrouter') {
      const isRouter = resolved === 'openrouter' || (apiKey && apiKey.startsWith('sk-or-'));
      return await callOpenAIDirect(apiKey, prompt, isJson, isRouter);
    } else {
      return await callGeminiDirect(apiKey, prompt, isJson);
    }
  }

  // ── Gemini Direct (Dynamic Discovery + Dual Key Auth + No Deprecated Models) ──
  let cachedGeminiModelDirect = null;

  async function getBestGeminiModelDirect(cleanKey) {
    if (cachedGeminiModelDirect) return cachedGeminiModelDirect;
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
        const preferred = ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro'];
        for (const p of preferred) {
          if (models.includes(p)) { cachedGeminiModelDirect = p; return p; }
        }
        const flash = models.find(m => m.includes('flash'));
        if (flash) { cachedGeminiModelDirect = flash; return flash; }
      }
    } catch (_) {}
    return 'gemini-1.5-flash';
  }

  async function callGeminiDirect(apiKey, prompt, isJson = false) {
    const cleanKey = String(apiKey || '').replace(/["'`\s]/g, '').trim();
    if (!cleanKey) throw new Error('Gemini: API key is empty');

    const dynamicModel = await getBestGeminiModelDirect(cleanKey);
    const candidateModels = [
      dynamicModel,
      'gemini-1.5-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash-8b'
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    let lastError = null;

    for (const model of candidateModels) {
      try {
        const payload = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: isJson ? 800 : 2048
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

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${response.status}`;
          lastError = new Error(`Gemini (${model}): ${errMsg}`);
          if (errMsg.includes('API key not valid') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('Quota exceeded')) {
            throw lastError;
          }
          continue;
        }

        const data = await response.json();
        const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (!text) throw new Error(`Empty response from Gemini (${model})`);
        cachedGeminiModelDirect = model;
        return text;
      } catch (err) {
        lastError = err;
        if (err.message && (err.message.includes('API key not valid') || err.message.includes('PERMISSION_DENIED') || err.message.includes('Quota exceeded'))) {
          throw err;
        }
        continue;
      }
    }

    throw lastError || new Error('Gemini API request failed. Please check your API key at aistudio.google.com');
  }

  // ── Groq Direct (Dynamic Model Discovery + Fallbacks) ──
  let cachedGroqModelDirect = null;

  async function getBestGroqModelDirect(apiKey) {
    if (cachedGroqModelDirect) return cachedGroqModelDirect;
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
        const textModels = list.filter(id => !id.includes('whisper') && !id.includes('guard'));
        const preferred =
          textModels.find(id => id.includes('llama-3.3-70b')) ||
          textModels.find(id => id.includes('llama-3.1-70b')) ||
          textModels.find(id => id.includes('llama3-70b')) ||
          textModels.find(id => id.includes('llama-3.1-8b')) ||
          textModels.find(id => id.includes('llama3-8b')) ||
          textModels.find(id => id.includes('mixtral')) ||
          textModels.find(id => id.includes('deepseek-r1')) ||
          textModels.find(id => id.includes('gemma')) ||
          textModels[0];

        if (preferred) {
          cachedGroqModelDirect = preferred;
          return preferred;
        }
      }
    } catch (_) {}
    return 'llama-3.3-70b-versatile';
  }

  async function callGroqDirect(apiKey, prompt, isJson = false) {
    const cleanKey = String(apiKey || '').trim();
    const dynamicModel = await getBestGroqModelDirect(apiKey);

    const models = [
      dynamicModel,
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
      'gemma2-9b-it'
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    let lastError = null;

    for (const model of models) {
      try {
        const payload = {
          model,
          messages: [
            {
              role: 'system',
              content: isJson
                ? 'You are an expert exam solver. Output ONLY valid JSON array with no markdown.'
                : 'You are an elite competitive programmer. Output ONLY pure executable code.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: isJson ? 800 : 2048
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
          lastError = new Error(`Groq (${model}): Rate limit reached, trying next model...`);
          continue;
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${response.status}`;
          if (response.status === 401 || response.status === 403) {
            throw new Error(`Groq: Invalid or expired API key (${errMsg})`);
          }
          lastError = new Error(`Groq (${model}): ${errMsg}`);
          continue;
        }

        const data = await response.json();
        const text = (data?.choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error(`Empty response from Groq (${model})`);
        cachedGroqModelDirect = model;
        return text;
      } catch (err) {
        lastError = err;
        if (err.message && (err.message.includes('Invalid or expired') || err.message.includes('Rate limit reached'))) throw err;
        continue;
      }
    }
    throw lastError || new Error('Groq API request failed');
  }

  // ── Grok Direct (Dynamic Model Discovery + Fallbacks) ──
  let cachedGrokModelDirect = null;

  async function getBestGrokModelDirect(apiKey) {
    if (cachedGrokModelDirect) return cachedGrokModelDirect;
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
          cachedGrokModelDirect = preferred;
          return preferred;
        }
      }
    } catch (_) {}
    return 'grok-2-latest';
  }

  async function callGrokDirect(apiKey, prompt, isJson = false) {
    const dynamicModel = await getBestGrokModelDirect(apiKey);
    const candidateModels = [
      dynamicModel,
      'grok-4.7',
      'grok-4.6',
      'grok-2-latest',
      'grok-2',
      'grok-beta'
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    let lastError = null;
    for (const targetModel of candidateModels) {
      try {
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify({
            model: targetModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1
          })
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          lastError = new Error(`xAI Grok (${targetModel}): ${err?.error?.message || response.statusText}`);
          continue;
        }
        const data = await response.json();
        const text = (data?.choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error(`Empty response from Grok (${targetModel})`);
        cachedGrokModelDirect = targetModel;
        return text;
      } catch (err) {
        lastError = err;
        continue;
      }
    }
    throw lastError || new Error('xAI Grok request failed');
  }

  // ── OpenAI Direct ──
  async function callOpenAIDirect(apiKey, prompt, isJson = false, isRouter = false) {
    const url = isRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: isRouter ? 'meta-llama/llama-3.3-70b-instruct' : 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenAI: ${err?.error?.message || response.statusText}`);
    }
    const data = await response.json();
    return (data?.choices?.[0]?.message?.content || '').trim();
  }

  // ═══════════════════════════════════════════
  //  PERSONAL FIELD FILTER
  // ═══════════════════════════════════════════

  const EXACT_PERSONAL_LABELS = [
    'name', 'full name', 'your name', 'first name', 'last name', 'surname',
    'roll no', 'roll number', 'roll no.', 'enrollment no', 'enrollment number',
    'student id', 'college id', 'university id', 'registration no', 'reg no',
    'email', 'email id', 'email address', 'your email',
    'phone', 'phone number', 'mobile', 'mobile number', 'contact number', 'your phone',
    'date of birth', 'dob', 'gender', 'age', 'address', 'signature'
  ];

  function isPersonalField(questionText) {
    const lower = (questionText || '').toLowerCase().trim();
    if (!lower) return false;

    // Strict exact check on short labels
    if (lower.length <= 40) {
      const isExact = EXACT_PERSONAL_LABELS.some(label => {
        return lower === label || lower === label + ':' || lower === label + '*' || lower === label + ' *';
      });
      if (isExact) return true;
    }

    // Only skip if starts with explicit user command: "enter your name", "type your roll"
    const personalPrefixes = ['enter your', 'write your', 'type your', 'provide your', 'fill your name', 'fill your email'];
    if (personalPrefixes.some(p => lower.startsWith(p))) return true;

    // Academic questions are NEVER personal fields!
    return false;
  }

    function isAlreadyFilled(container) {
    if (!container) return false;

    // 1. Radio button checked
    const checkedRadio = container.querySelector(
      '[role="radio"][aria-checked="true"], [role="radio"].N2x2Cc, [role="radio"].isChecked, input[type="radio"]:checked, [data-value][aria-checked="true"], [aria-checked="true"]'
    );
    if (checkedRadio) return true;

    // 2. Checkbox checked
    const checkedBox = container.querySelector(
      '[role="checkbox"][aria-checked="true"], [role="checkbox"].N2x2Cc, [role="checkbox"].isChecked, input[type="checkbox"]:checked'
    );
    if (checkedBox) return true;

    // 3. Dropdown selected
    const selectedOption = container.querySelector(
      '[role="option"][aria-selected="true"], .quantumWizMenuPaperselectOption[aria-selected="true"], select:not([value=""]) option:checked:not([value=""])'
    );
    if (selectedOption && (selectedOption.textContent || '').trim() !== 'Choose') return true;

    // 4. Text / number / email / textarea inputs with non-empty content
    const inputs = container.querySelectorAll(
      'input.whsOnd, input[type="text"], input[type="email"], input[type="number"], textarea.KHxj8b, textarea'
    );
    for (const inp of inputs) {
      if (inp.value && inp.value.trim().length > 0) return true;
    }

    return false;
  }

  // ═══════════════════════════════════════════
  //  GOOGLE FORMS PARSER & FILLER
  // ═══════════════════════════════════════════

  function parseGoogleForm() {
    const questions = [];

    // Modern Google Forms containers
    let containers = Array.from(document.querySelectorAll('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBaseRoot'));
    if (containers.length === 0) {
      containers = Array.from(document.querySelectorAll('[data-item-id]'));
    }

    containers.forEach((container, index) => {
      try {
        const titleEl = container.querySelector(
          '.M7eMe, [role="heading"], .freebirdFormviewerComponentsQuestionBaseTitle, span.F9EgHc, [data-item-id]'
        );
        const questionText = (titleEl?.textContent || '').trim();
        if (!questionText) return;

        if (isPersonalField(questionText)) {
          questions.push({ index, questionText, type: 'skip', options: [], skip: true, reason: 'personal', _container: container });
          return;
        }

        // Skip questions that are ALREADY ANSWERED (Preserves quota & avoids re-selecting!)
        if (isAlreadyFilled(container)) {
          questions.push({ index, questionText, type: 'skip', options: [], skip: true, reason: 'already_answered', _container: container });
          return;
        }

        const hasRadio = container.querySelectorAll('[role="radio"], input[type="radio"]').length > 0;
        const hasCheckbox = container.querySelectorAll('[role="checkbox"], input[type="checkbox"]').length > 0;
        const hasInput = container.querySelector('input.whsOnd, input[type="text"], input[type="email"], input[type="number"]');
        const hasTextarea = container.querySelector('textarea.KHxj8b, textarea');
        const hasDropdown = container.querySelector('[role="listbox"], select');

        let type = 'unknown', options = [];

        if (hasDropdown) {
          type = 'dropdown';
          container.querySelectorAll('[role="option"], select option').forEach(el => {
            const t = (el.textContent || el.value || '').trim();
            if (t && t !== 'Choose') options.push(t);
          });
        } else if (hasRadio) {
          type = 'multiple_choice';
          container.querySelectorAll('[role="radio"], input[type="radio"]').forEach(r => {
            const p = r.closest('[data-value]') || r.closest('.docssharedWizToggleLabeledContainer') || r.parentElement;
            const t = (
              r.getAttribute('data-value') ||
              r.getAttribute('aria-label') ||
              p?.querySelector('.aDTYNe, .vd3tt, .nWQGrd, .docssharedWizToggleLabeledLabelText, .bz0duf')?.textContent ||
              p?.textContent || ''
            ).trim();
            if (t && !options.includes(t)) options.push(t);
          });
        } else if (hasCheckbox) {
          type = 'checkbox';
          container.querySelectorAll('[role="checkbox"], input[type="checkbox"]').forEach(cb => {
            const p = cb.closest('[data-value]') || cb.closest('.docssharedWizToggleLabeledContainer') || cb.parentElement;
            const t = (
              cb.getAttribute('data-value') ||
              cb.getAttribute('aria-label') ||
              p?.querySelector('.aDTYNe, .vd3tt, .nWQGrd, .docssharedWizToggleLabeledLabelText')?.textContent ||
              p?.textContent || ''
            ).trim();
            if (t && !options.includes(t)) options.push(t);
          });
        } else if (hasTextarea) {
          type = 'paragraph';
        } else if (hasInput) {
          type = 'short_answer';
        }

        questions.push({ index, questionText, type, options, skip: false, _container: container });
      } catch (_) {}
    });

    return questions;
  }

  async function fillGoogleForm(answers, allQuestions) {
    let filled = 0;

    for (const answer of answers) {
      const q = allQuestions.find(item => item.index === answer.index);
      if (!q || q.skip) continue;

      // Use stored container reference directly!
      const container = q._container || document.querySelectorAll('.Qr7Oae')[q.index] || document.querySelectorAll('[role="listitem"]')[q.index];
      if (!container) continue;

      try {
        const { type, answer: ans } = answer;
        if (type === 'multiple_choice') filled += await fillGFMCQ(container, ans);
        else if (type === 'checkbox') filled += await fillGFCheckbox(container, ans);
        else if (type === 'short_answer') filled += fillGFText(container, ans);
        else if (type === 'paragraph') filled += fillGFTextarea(container, ans);
        else if (type === 'dropdown') filled += await fillGFDropdown(container, ans);
        await sleep(80);
      } catch (_) {}
    }
    return filled;
  }

  async function simulateGoogleClick(targetEl, parentEl) {
    const el = parentEl || targetEl;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await sleep(40);

    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    events.forEach(type => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    if (typeof el.click === 'function') el.click();

    if (targetEl && targetEl !== el) {
      events.forEach(type => {
        targetEl.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      if (typeof targetEl.click === 'function') targetEl.click();
    }
    await sleep(40);
  }

  async function fillGFMCQ(container, answerText) {
    if (!container || isAlreadyFilled(container)) return 0;
    if (answerText === undefined || answerText === null) return 0;
    const target = String(answerText).trim().toLowerCase();
    if (!target) return 0;

    const radios = Array.from(container.querySelectorAll('[role="radio"]'));
    if (radios.length === 0) return 0;

    // 1. Exact match on label or data-value
    for (const radio of radios) {
      const parent = radio.closest('[data-value]') || radio.closest('.docssharedWizToggleLabeledContainer') || radio.parentElement;
      const val = (radio.getAttribute('data-value') || '').trim().toLowerCase();
      const lbl = (parent?.querySelector('.aDTYNe, .vd3tt, .nWQGrd, .docssharedWizToggleLabeledLabelText, .bz0duf')?.textContent || parent?.textContent || '').trim().toLowerCase();

      const cleanTarget = target.replace(/^\(?[a-d]\)?[\).\s:-]+/, '').trim();
      const cleanLbl = lbl.replace(/^\(?[a-d]\)?[\).\s:-]+/, '').trim();

      if (val === target || lbl === target || (cleanTarget && cleanLbl === cleanTarget) || (cleanTarget && (cleanLbl.includes(cleanTarget) || cleanTarget.includes(cleanLbl)))) {
        await simulateGoogleClick(radio, parent);
        return 1;
      }
    }

    // 2. Letter match fallback (e.g. "B")
    const letterMatch = target.match(/^[a-d]$/i) || target.match(/^option\s+([a-d])$/i);
    if (letterMatch) {
      const letter = (letterMatch[1] || letterMatch[0]).toUpperCase();
      const idx = letter.charCodeAt(0) - 65;
      if (radios[idx]) {
        const radio = radios[idx];
        const parent = radio.closest('[data-value]') || radio.parentElement;
        await simulateGoogleClick(radio, parent);
        return 1;
      }
    }

    return 0;
  }

  async function fillGFCheckbox(container, answers) {
    if (!container || isAlreadyFilled(container)) return 0;
    if (!answers) return 0;
    const ansList = (Array.isArray(answers) ? answers : [answers]).map(a => String(a).trim().toLowerCase());
    const checkboxes = Array.from(container.querySelectorAll('[role="checkbox"]'));
    let clicked = 0;

    for (const cb of checkboxes) {
      const parent = cb.closest('[data-value]') || cb.closest('.docssharedWizToggleLabeledContainer') || cb.parentElement;
      const val = (cb.getAttribute('data-value') || '').trim().toLowerCase();
      const lbl = (parent?.querySelector('.aDTYNe, .vd3tt, .nWQGrd, .docssharedWizToggleLabeledLabelText')?.textContent || parent?.textContent || '').trim().toLowerCase();
      const cleanLbl = lbl.replace(/^\(?[a-d]\)?[\).\s:-]+/, '').trim();

      const shouldCheck = ansList.some(target => {
        const cleanTarget = target.replace(/^\(?[a-d]\)?[\).\s:-]+/, '').trim();
        return val === target || lbl === target || (cleanTarget && cleanLbl === cleanTarget) || (cleanTarget && cleanLbl.includes(cleanTarget));
      });

      if (shouldCheck && cb.getAttribute('aria-checked') !== 'true') {
        await simulateGoogleClick(cb, parent);
        clicked++;
      }
    }

    return clicked > 0 ? 1 : 0;
  }

  function fillGFText(container, text) {
    const inp = container.querySelector('input.whsOnd, input[type="text"], input[type="email"], input[type="number"], input:not([type="hidden"])');
    if (!inp || text === undefined || text === null) return 0;
    fillGoogleTextInput(inp, String(text));
    return 1;
  }

  function fillGFTextarea(container, text) {
    const ta = container.querySelector('textarea.KHxj8b, textarea');
    if (!ta || text === undefined || text === null) return 0;
    fillGoogleTextInput(ta, String(text));
    return 1;
  }

  function fillGoogleTextInput(el, text) {
    el.focus();
    let ok = false;
    try {
      el.select();
      ok = document.execCommand('insertText', false, text);
    } catch (_) {}

    if (!ok || el.value !== text) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, text);
      } else {
        el.value = text;
      }
    }

    ['input', 'change', 'blur'].forEach(ev => {
      el.dispatchEvent(new Event(ev, { bubbles: true }));
    });
  }

  async function fillGFDropdown(container, answerText) {
    if (!container || isAlreadyFilled(container)) return 0;
    if (!answerText) return 0;
    const target = String(answerText).trim().toLowerCase();

    const trigger = container.querySelector('[role="listbox"], .MocG8c');
    if (trigger) {
      await simulateGoogleClick(trigger);
      await sleep(350);

      const options = Array.from(document.querySelectorAll('[role="option"]'));
      for (const opt of options) {
        const t = (opt.textContent || '').trim().toLowerCase();
        if (t === target || t.includes(target) || target.includes(t)) {
          await simulateGoogleClick(opt);
          await sleep(100);
          return 1;
        }
      }
    }
    return 0;
  }

  // ═══════════════════════════════════════════
  //  UNIVERSAL / CUSTOM PORTAL PARSER
  // ═══════════════════════════════════════════

  function parseUniversalForm() {
    const questions = [];
    let index = 0;

    const radioGroups = {};
    document.querySelectorAll('input[type="radio"]').forEach(r => {
      const name = r.name || r.getAttribute('name') || `rg_${index}`;
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(r);
    });

    Object.entries(radioGroups).forEach(([name, radios]) => {
      const firstRadio = radios[0];
      const container = firstRadio.closest('fieldset,tr,div[class*="question"],li,section,.q-text,.question') || firstRadio.parentElement?.parentElement;
      const questionText = findQuestionText(container, firstRadio);

      if (!questionText || isPersonalField(questionText)) return;
      if (radios.some(r => r.checked)) return;

      const options = radios.map(r => {
        const label = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
        return (label?.textContent || r.value || '').trim().replace(/^\s*[○●•]\s*/, '');
      }).filter(Boolean);

      questions.push({ index: index++, questionText, type: 'multiple_choice', options, skip: false, _radios: radios });
    });

    const checkGroups = {};
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const name = cb.name || `cg_${index}`;
      if (!checkGroups[name]) checkGroups[name] = [];
      checkGroups[name].push(cb);
    });

    Object.entries(checkGroups).forEach(([name, cbs]) => {
      if (cbs.length < 2) return;
      const container = cbs[0].closest('fieldset,div[class*="question"],li,.question') || cbs[0].parentElement?.parentElement;
      const questionText = findQuestionText(container, cbs[0]);
      if (!questionText || isPersonalField(questionText)) return;
      if (cbs.some(c => c.checked)) return;

      const options = cbs.map(cb => {
        const label = document.querySelector(`label[for="${cb.id}"]`) || cb.closest('label') || cb.parentElement;
        return (label?.textContent || cb.value || '').trim();
      }).filter(Boolean);

      questions.push({ index: index++, questionText, type: 'checkbox', options, skip: false, _checkboxes: cbs });
    });

    document.querySelectorAll('input[type="text"],input[type="email"],textarea').forEach(el => {
      if (el.value && el.value.trim()) return;
      const container = el.closest('fieldset,div[class*="question"],li,.question,tr') || el.parentElement;
      const questionText = findQuestionText(container, el);
      if (!questionText || isPersonalField(questionText)) return;

      const type = el.tagName === 'TEXTAREA' ? 'paragraph' : 'short_answer';
      questions.push({ index: index++, questionText, type, options: [], skip: false, _input: el });
    });

    return questions;
  }

  function parseCustomPortalQuestions(startIndex = 0) {
    const list = [];
    let idx = startIndex;

    const letterBadges = Array.from(document.querySelectorAll('*')).filter(el => {
      if (el.children.length > 0) return false;
      const t = el.textContent.trim();
      return ['A', 'B', 'C', 'D'].includes(t);
    });

    if (letterBadges.length >= 2) {
      const optionRows = [];
      const seen = new Set();
      for (const badge of letterBadges) {
        let row = badge.closest('li, button, [role="button"], [role="radio"]') || badge.parentElement;
        if (row && row.textContent.trim().length <= 2 && row.parentElement) {
          row = row.parentElement;
        }
        if (row && !seen.has(row) && row !== document.body) {
          seen.add(row);
          optionRows.push({ el: row, badge: badge.textContent.trim() });
        }
      }

      if (optionRows.length >= 2 && optionRows.length <= 8) {
        const qText = findQuestionForOptionGroup(optionRows.map(o => o.el));
        if (qText && !isPersonalField(qText)) {
          const optionsMap = [];
          const optionStrings = [];
          optionRows.forEach(item => {
            const raw = item.el.textContent.trim().replace(/\s+/g, ' ');
            let clean = raw.replace(new RegExp('\\b' + item.badge + '\\b', 'g'), '').trim();
            if (!clean) clean = raw;
            optionsMap.push({ text: clean, rawText: raw, letter: item.badge, el: item.el });
            optionStrings.push(clean);
          });

          list.push({
            index: idx++,
            questionText: qText,
            type: 'multiple_choice',
            options: optionStrings,
            _optionsMap: optionsMap,
            skip: false
          });
          return list;
        }
      }
    }

    return list;
  }

  function findQuestionForOptionGroup(optionEls) {
    if (!optionEls || optionEls.length === 0) return '';
    const isOptionRelated = (el) => {
      return optionEls.some(opt => opt === el || opt.contains(el) || el.contains(opt));
    };

    const firstOpt = optionEls[0];
    let curr = firstOpt.parentElement;
    for (let step = 0; step < 6 && curr && curr !== document.body; step++) {
      const candidates = Array.from(curr.querySelectorAll('h1, h2, h3, h4, h5, p, [class*="question" i], [class*="title" i], [class*="prompt" i], div')).filter(el => {
        if (isOptionRelated(el)) return false;
        if (el.tagName === 'DIV' && el.children.length > 2) return false;
        const t = el.textContent.trim().replace(/\s+/g, ' ');
        if (t.length < 8 || t.length > 600 || isPersonalField(t)) return false;
        if (/^(question|problems list|mock practice|round|section|aptitude|submit|next|previous)\s*$/i.test(t)) return false;
        return t.endsWith('?') || /^(what|which|how|calculate|find|solve|where|when|who|why|if|evaluate|in|a|the|select|choose)\b/i.test(t);
      });

      if (candidates.length > 0) {
        return candidates[candidates.length - 1].textContent.trim().replace(/\s+/g, ' ');
      }
      curr = curr.parentElement;
    }

    return '';
  }

  function findQuestionText(container, fallbackEl) {
    if (!container) return '';
    const legend = container.querySelector('legend');
    if (legend) return legend.textContent.trim();
    const qEl = container.querySelector(
      '.question-text,.qtext,.stem,.prompt,h3,h4,.title,[class*="question-title"],[class*="qtitle"],[class*="q-stem"]'
    );
    if (qEl) return qEl.textContent.trim();
    const allText = container.textContent.trim().split('\r\n')[0].trim();
    if (allText.length > 5 && allText.length < 500) return allText;
    return '';
  }

  async function fillUniversal(answers, questions) {
    let filled = 0;
    for (const answer of answers) {
      const q = questions.find(q => q.index === answer.index);
      if (!q || q.skip) continue;
      try {
        const { type, answer: ans } = answer;
        if (type === 'multiple_choice') {
          if (q._radios) {
            for (const r of q._radios) {
              const lbl = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
              const txt = (lbl?.textContent || r.value || '').trim();
              if (txt.toLowerCase() === ans.toLowerCase() || r.value?.toLowerCase() === ans.toLowerCase()) {
                r.click(); await sleep(80); filled++; break;
              }
            }
          } else if (q._optionsMap) {
            const match = findBestOptionMatch(q._optionsMap, ans);
            if (match && match.el) {
              await clickOption(match.el);
              filled++;
            }
          }
        } else if (type === 'checkbox' && q._checkboxes) {
          for (const cb of q._checkboxes) {
            const lbl = document.querySelector(`label[for="${cb.id}"]`) || cb.closest('label') || cb.parentElement;
            const txt = (lbl?.textContent || cb.value || '').trim();
            const should = (Array.isArray(ans) ? ans : [ans]).some(a => String(a).toLowerCase() === txt.toLowerCase());
            if (should && !cb.checked) { cb.click(); await sleep(60); }
          }
          filled++;
        }
        await sleep(100);
      } catch (_) {}
    }
    return filled;
  }

  function findBestOptionMatch(optionsMap, ans) {
    if (!optionsMap || optionsMap.length === 0) return null;
    const a = String(ans || '').trim().toLowerCase();

    for (const opt of optionsMap) {
      if (opt.text.toLowerCase() === a) return opt;
    }
    for (const opt of optionsMap) {
      if (opt.letter && (a === opt.letter.toLowerCase() || a === 'option ' + opt.letter.toLowerCase())) {
        return opt;
      }
    }
    for (const opt of optionsMap) {
      if (opt.text.toLowerCase().includes(a) || a.includes(opt.text.toLowerCase())) return opt;
    }
    return optionsMap[0] || null;
  }

  async function clickOption(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await sleep(40);
    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    events.forEach(type => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
    if (typeof el.click === 'function') el.click();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function triggerEvents(el) {
    ['input', 'change', 'blur'].forEach(e => el.dispatchEvent(new Event(e, { bubbles: true })));
  }

  function isGoogleForm() {
    return window.location.hostname === 'docs.google.com' && window.location.pathname.includes('/forms/');
  }

  // ═══════════════════════════════════════════
  //  AI BATCH CALLER (QUOTA OPTIMIZED)
  // ═══════════════════════════════════════════

    async function callAIBatch(apiKey, provider = 'auto', batchQuestions = []) {
    if (!batchQuestions || batchQuestions.length === 0) return [];

    const cleanQ = batchQuestions.map((q, idx) => ({
      batchIndex: idx,
      originalIndex: q.index,
      questionText: String(q.questionText || '').replace(/\s+/g, ' ').trim(),
      type: q.type,
      options: (q.options || []).map(o => String(o).replace(/\s+/g, ' ').trim())
    }));

    const prompt = `You are an expert exam solver. Solve ALL the questions below accurately.

RULES:
1. "multiple_choice" -> exact text of correct option.
2. "checkbox" -> JSON array of exact text of correct options.
3. "short_answer" -> concise 1-sentence answer.
4. "paragraph" -> concise 2-sentence answer.
5. "dropdown" -> exact text of correct option.
6. Return ONLY a valid JSON array. No markdown fences.

QUESTIONS:
${JSON.stringify(cleanQ, null, 2)}

OUTPUT FORMAT (JSON array):
[
  {"batchIndex": 0, "type": "multiple_choice", "answer": "Exact Option Text"},
  {"batchIndex": 1, "type": "checkbox", "answer": ["Option A"]}
]`;

    const rawText = await callUniversalAI({ apiKey, provider, prompt, isJson: true });
    const parsed = safeParseJSON(rawText);

    if (!parsed || !Array.isArray(parsed)) {
      throw new Error('AI returned an unparseable response');
    }

    const result = [];
    for (let i = 0; i < batchQuestions.length; i++) {
      const q = batchQuestions[i];
      const ansObj = parsed.find(a => a.originalIndex === q.index) ||
                     parsed.find(a => a.batchIndex === i) ||
                     parsed.find(a => a.index === q.index) ||
                     parsed.find(a => a.index === i) ||
                     parsed[i];

      if (ansObj && ansObj.answer !== undefined) {
        result.push({
          index: q.index,
          type: q.type,
          answer: ansObj.answer
        });
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════
  //  TEXT-EXTRACTION FALLBACK SOLVER
  // ═══════════════════════════════════════════

  async function solvePageViaTextExtraction(apiKey, provider = "auto") {
    let container = document.querySelector('main, [role="main"], article, section, [class*="quiz" i], [class*="test" i], [class*="interview" i]');
    if (!container) container = document.body;

    const visibleText = (container.innerText || document.body.innerText || '').slice(0, 3500);
    if (!visibleText || visibleText.length < 20) {
      throw new Error('Not enough text on page to analyze');
    }

    const prompt = `Solve the active question from this exam screen text:
---
${visibleText}
---
Output strict JSON:
{
  "question": "Question text",
  "answer": "Exact text of correct option",
  "letter": "A, B, C, or D"
}`;

    const rawText = await callUniversalAI({ apiKey, provider, prompt, isJson: true });
    const parsed = safeParseJSON(rawText);

    if (!parsed) throw new Error('Could not parse question solution');

    const ansText = (parsed.answer || '').trim();
    const letter = (parsed.letter || '').trim();

    const clicked = await clickMatchingOptionOnPage(ansText, letter);
    if (clicked) {
      return { type: 'mcq_clicked', answer: ansText, letter };
    }

    throw new Error('Could not find matching button on screen');
  }

  async function clickMatchingOptionOnPage(ansText, letter) {
    const candidates = Array.from(document.querySelectorAll('button, li, [role="button"], [role="radio"], [class*="option" i], div, p, span')).filter(el => {
      const t = el.textContent.trim();
      return t.length > 0 && t.length < 300 && el.offsetParent !== null;
    });

    if (ansText) {
      const aLower = ansText.toLowerCase();
      for (const el of candidates) {
        if (el.textContent.trim().toLowerCase() === aLower) {
          await clickOption(el);
          return true;
        }
      }
    }

    if (letter) {
      const badges = candidates.filter(el => el.textContent.trim() === letter && el.children.length === 0);
      for (const b of badges) {
        let row = b.closest('button, li, [role="button"], [role="radio"]') || b.parentElement;
        if (row) {
          await clickOption(row);
          return true;
        }
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════
  //  TECHNICAL CODING SOLVER (Alt + Shift + C)
  // ═══════════════════════════════════════════

  function detectProgrammingLanguage() {
    const langSelect = document.querySelector('select[class*="lang" i], select[name*="lang" i], [data-cy="lang-select"] select');
    if (langSelect && langSelect.options && langSelect.selectedIndex >= 0) {
      return langSelect.options[langSelect.selectedIndex].text.trim();
    }
    const monacoMode = document.querySelector('[data-mode-id]')?.getAttribute('data-mode-id');
    if (monacoMode && monacoMode !== 'text') return monacoMode;

    const langBtn = Array.from(document.querySelectorAll('button[class*="active" i], [role="tab"][aria-selected="true"]')).find(el => {
      return ['python', 'python 3', 'java', 'c++', 'cpp', 'javascript', 'typescript'].includes(el.textContent.trim().toLowerCase());
    });
    if (langBtn) return langBtn.textContent.trim();

    return 'Python 3';
  }

  function getStarterCode(editorEl) {
    if (!editorEl) return '';
    try {
      const container = editorEl.closest('.monaco-editor, .ace_editor, .CodeMirror, .cm-editor') || editorEl;
      const text = (container.innerText || editorEl.value || '').trim();
      if (text.length > 5 && text.length < 1500) return text;
    } catch (_) {}
    return '';
  }

  function extractCodingProblemFromDOM(activeEditor) {
    const isEditorNode = (el) => activeEditor && (el === activeEditor || activeEditor.contains(el) || el.contains(activeEditor));

    const specificSelectors = [
      '[data-track-load*="description"]',
      '[class*="problem-description"]',
      '[class*="description__"]',
      '[class*="problem-statement"]',
      '[class*="question-description"]',
      '.coding-description',
      '.problem-body'
    ];

    for (const sel of specificSelectors) {
      const el = document.querySelector(sel);
      if (el && !isEditorNode(el)) {
        const t = (el.innerText || '').trim();
        if (t.length > 25) return t.slice(0, 4000);
      }
    }

    const leftPanels = Array.from(document.querySelectorAll('div[class*="left" i], div[class*="pane" i], section, main')).filter(el => {
      if (isEditorNode(el)) return false;
      const text = el.innerText || '';
      return text.length > 50 && /(problem|example|constraints|input|output|task)/i.test(text);
    });

    if (leftPanels.length > 0) return leftPanels[0].innerText.trim().slice(0, 4000);
    return (document.body.innerText || '').slice(0, 3500);
  }

  async function solveCodingProblem(apiKey, provider = "auto") {
    if (isSolving) return { success: false, error: 'Solver is currently running' };
    isSolving = true;

    try {
      showStealth('working');

      const targetEditor = getActiveEditable();
      let problemText = window.getSelection().toString().trim();
      if (!problemText || problemText.length < 15) {
        problemText = extractCodingProblemFromDOM(targetEditor);
      }

      if (!problemText || problemText.length < 15) {
        showStealth('error');
        return { success: false, error: 'Could not detect problem description' };
      }

      const lang = detectProgrammingLanguage();
      const starterCode = getStarterCode(targetEditor);

      const prompt = `You are an elite competitive programmer. Solve this coding problem optimally in ${lang}.

PROBLEM:
${problemText}

${starterCode ? `STARTER CODE:\r\n${starterCode}\r\n` : ''}

RULES:
1. Output ONLY pure executable code in ${lang}.
2. NO markdown code blocks (no \`\`\`).
3. NO conversational greeting or explanation.`;

      const generated = await callUniversalAI({ apiKey, provider, prompt, isJson: false });
      let cleanCode = generated.replace(/^```[a-zA-Z]*\r\n?/gm, '').replace(/```$/gm, '').trim();

      if (targetEditor) {
        const injected = injectCodeIntoElement(targetEditor, cleanCode);
        if (injected) {
          pendingSolution = null;
          showStealth('done');
          chrome.runtime.sendMessage({ action: 'UPDATE_STATS', questionsCount: 1 });
          return { success: true, mode: 'code_injected' };
        }
      }

      pendingSolution = cleanCode;
      showStealth('ready');
      return { success: true, mode: 'solution_ready' };

    } catch (err) {
      showStealth('error');
      return { success: false, error: err.message };
    } finally {
      isSolving = false;
    }
  }

  // ═══════════════════════════════════════════
  //  MAIN FORM SOLVER (Alt + Shift + S)
  // ═══════════════════════════════════════════

  async function solveForm(apiKey, provider = "auto") {
    if (isSolving) return { success: false, error: 'Solver is currently running' };
    isSolving = true;

    try {
      showStealth('working');

      // 1. Pending code injection
      const editable = getActiveEditable();
      if (pendingSolution && editable) {
        const injected = injectCodeIntoElement(editable, pendingSolution);
        if (injected) {
          pendingSolution = null;
          showStealth('done');
          chrome.runtime.sendMessage({ action: 'UPDATE_STATS', questionsCount: 1 });
          return { success: true, mode: 'code_injected', questionsAnswered: 1 };
        }
      }

      // 2. Structured form parsing
      const gform = isGoogleForm();
      let questions = [];
      if (gform) {
        questions = parseGoogleForm();
      }
      if (questions.length === 0) {
        questions = parseUniversalForm();
      }
      if (questions.length === 0 && !gform) {
        questions = parseCustomPortalQuestions(0);
      }

      const toSolve = questions.filter(q => !q.skip);

      if (toSolve.length > 0) {
        try {
          // If 15 questions or fewer, solve in 1 SINGLE API call! (Saves quota & ultra-fast)
          const BATCH_SIZE = 10;
          let totalFilled = 0;

          for (let i = 0; i < toSolve.length; i += BATCH_SIZE) {
            const batch = toSolve.slice(i, i + BATCH_SIZE);
            const batchAnswers = await callAIBatch(apiKey, provider, batch);

            const batchFilled = gform
              ? await fillGoogleForm(batchAnswers, questions)
              : await fillUniversal(batchAnswers, questions);

            totalFilled += batchFilled;

            if (i + BATCH_SIZE < toSolve.length) {
              await sleep(100);
            }
          }

          showStealth('done');
          chrome.runtime.sendMessage({ action: 'UPDATE_STATS', questionsCount: totalFilled });
          return { success: true, questionsAnswered: totalFilled };
        } catch (apiErr) {
          showStealth('error');
          return { success: false, error: apiErr.message || 'AI solver error' };
        }
      }

      // 3. Fallback: Page Text Extraction
      try {
        const fallbackRes = await solvePageViaTextExtraction(apiKey, provider);
        showStealth('done');
        chrome.runtime.sendMessage({ action: 'UPDATE_STATS', questionsCount: 1 });
        return { success: true, questionsAnswered: 1 };
      } catch (fbErr) {
        showStealth('error');
        return { success: false, error: 'No questions detected on this page' };
      }

    } catch (err) {
      showStealth('error');
      return { success: false, error: err.message };
    } finally {
      isSolving = false;
    }
  }

  // ═══════════════════════════════════════════
  //  KEYBOARD SHORTCUTS (Alt + Shift + S / Alt + Shift + C)
  // ═══════════════════════════════════════════

  window.addEventListener('keydown', async (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'S' || e.key === 's' || e.code === 'KeyS')) {
      e.preventDefault();
      e.stopPropagation();
      if (isSolving) return;
      const settings = await getStoredSettings();
      if (settings.apiKey) solveForm(settings.apiKey, settings.provider);
    } else if (e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.code === 'KeyC')) {
      e.preventDefault();
      e.stopPropagation();
      if (isSolving) return;
      const settings = await getStoredSettings();
      if (settings.apiKey) solveCodingProblem(settings.apiKey, settings.provider);
    }
  }, true);

  // ═══════════════════════════════════════════
  //  MESSAGE LISTENER
  // ═══════════════════════════════════════════

  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
        if (msg.action === 'DETECT_QUESTIONS') {
      try {
        const gform = isGoogleForm();
        const questions = gform ? parseGoogleForm() : parseUniversalForm();
        const unanswered = questions.filter(q => !q.skip);
        const answered = questions.filter(q => q.skip && q.reason === 'already_answered');
        sendResponse({
          isGoogleForm: gform,
          count: unanswered.length,
          total: questions.length,
          alreadyAnswered: answered.length,
          hasPendingSolution: !!pendingSolution
        });
      } catch (_) {
        sendResponse({ isGoogleForm: false, count: 0, hasPendingSolution: !!pendingSolution });
      }
      return true;
    }

    if (msg.action === 'SOLVE_FORM') {
      if (!msg.apiKey) {
        sendResponse({ success: false, error: 'No API key provided' });
        return true;
      }
      solveForm(msg.apiKey, msg.provider || 'auto').then(sendResponse);
      return true;
    }

    if (msg.action === 'SOLVE_CODE') {
      if (!msg.apiKey) {
        sendResponse({ success: false, error: 'No API key provided' });
        return true;
      }
      solveCodingProblem(msg.apiKey, msg.provider || 'auto').then(sendResponse);
      return true;
    }

    if (msg.action === 'PING') {
      sendResponse({ alive: true });
      return true;
    }
  });

  console.log('[FormGenius] Content script v1.2.0 initialized (Universal AI Engine) ✦');
})();
