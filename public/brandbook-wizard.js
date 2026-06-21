(function(){
    // Brand Book Lab wizard — same shape as logo-wizard.js, orange accent.

    const ACCENT = '#f97316';
    const ACCENT_SOFT = 'rgba(249,115,22,0.12)';
    const ACCENT_BORDER = 'rgba(249,115,22,0.32)';
    const BB = { name: '', about: '', industry: '', website: '', values: [], voice: [], colors: [], typeface: 'Inter', logoUrl: '', logoDataUrl: '', logoIsLight: true, template: 'editorial' };

    const STEPS = [
      { key: 'bb-template', chapter: 'Style',    title: 'Pick a template' },
      { key: 'bb-name',     chapter: 'Brand',    title: 'Brand name' },
      { key: 'bb-about',    chapter: 'Brand',    title: 'About the brand' },
      { key: 'bb-values',   chapter: 'Identity', title: 'Brand values' },
      { key: 'bb-voice',    chapter: 'Identity', title: 'Tone of voice' },
      { key: 'bb-logo',     chapter: 'Visual',   title: 'Upload your logo' },
      { key: 'bb-colors',   chapter: 'Visual',   title: 'Brand colors' },
      { key: 'bb-typeface', chapter: 'Visual',   title: 'Typeface' },
      { key: 'bb-go',       chapter: 'Build',    title: 'Generate.' },
    ];
    let stepIdx = 0;

    const STYLE_CARD = 'background:linear-gradient(180deg,rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%),rgba(18,18,22,0.92);backdrop-filter:blur(24px) saturate(1.3);-webkit-backdrop-filter:blur(24px) saturate(1.3);border:1px solid rgba(255,255,255,0.09);border-radius:20px;padding:36px 40px 28px;max-width:680px;margin:0 auto;box-shadow:0 1px 0 rgba(255,255,255,0.05) inset, 0 18px 40px -22px rgba(0,0,0,0.55);';
    const STYLE_EYEBROW = `display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${ACCENT};padding:5px 12px;border-radius:999px;background:${ACCENT_SOFT};border:1px solid ${ACCENT_BORDER};`;
    const STYLE_EYEBROW_DOT = `width:6px;height:6px;border-radius:50%;background:${ACCENT};box-shadow:0 0 8px rgba(249,115,22,0.7);`;
    const STYLE_TITLE = "font-family:'Inter',sans-serif;font-size:clamp(26px,3.4vw,34px);font-weight:300;letter-spacing:-0.028em;line-height:1.1;color:#fff;margin:18px 0 10px;";
    const STYLE_HELPER = 'font-size:13.5px;color:rgba(255,255,255,0.55);margin:0 0 26px;line-height:1.55;max-width:580px;';
    const STYLE_LABEL = "font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:0.1em;display:block;margin-bottom:8px;";
    const STYLE_INPUT = 'width:100%;height:48px;padding:0 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.14);border-radius:12px;color:#fff;font-family:inherit;font-size:15px;outline:none;transition:border-color .15s, box-shadow .15s;';
    const STYLE_TEXTAREA = 'width:100%;padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.14);border-radius:12px;color:#fff;font-family:inherit;font-size:15px;line-height:1.6;outline:none;resize:vertical;min-height:130px;transition:border-color .15s, box-shadow .15s;';
    const STYLE_BTN_PRIMARY = `height:48px;padding:0 26px;background:${ACCENT};color:#0a0a0a;border:none;border-radius:999px;font-family:inherit;font-size:13.5px;font-weight:700;letter-spacing:0.04em;cursor:pointer;transition:background .15s;`;
    const STYLE_BTN_GHOST = 'height:44px;padding:0 18px;background:transparent;color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.14);border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;letter-spacing:0.02em;transition:all .15s;';
    const STYLE_BTN_LINK  = 'height:44px;padding:0 14px;background:transparent;color:rgba(255,255,255,0.5);border:0;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;letter-spacing:0.02em;';
    const STYLE_ADD = 'width:100%;height:44px;padding:0 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:12px;color:rgba(255,255,255,0.78);font-family:inherit;font-size:12.5px;font-weight:700;letter-spacing:0.04em;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;justify-content:center;gap:8px;';

    function escapeHtml(s) { return (s ?? '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function escapeAttr(s) { return escapeHtml(s); }

    function eyebrowHTML() {
      const step = STEPS[stepIdx];
      return `<span style="${STYLE_EYEBROW}"><span style="${STYLE_EYEBROW_DOT}"></span>Step ${stepIdx + 1} of ${STEPS.length} · ${step.chapter}</span>`;
    }

    function footerHTML({ skipText = 'Skip', nextText = 'Continue →', hideNext = false, hideSkip = false } = {}) {
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:32px;padding-top:22px;border-top:1px solid rgba(255,255,255,0.06);gap:10px;flex-wrap:wrap;">
          <button type="button" data-act="back" class="pkw-secondary" style="${STYLE_BTN_LINK}" ${stepIdx === 0 ? 'disabled style="visibility:hidden"' : ''}>← Back</button>
          <div style="display:flex;gap:8px;align-items:center;margin-left:auto;">
            ${hideSkip ? '' : `<button type="button" data-act="skip" class="pkw-secondary" style="${STYLE_BTN_GHOST}">${skipText}</button>`}
            ${hideNext ? '' : `<button type="button" data-act="next" class="pkw-primary" style="${STYLE_BTN_PRIMARY}">${nextText}</button>`}
          </div>
        </div>
      `;
    }

    function wireFooter(card, { onNext } = {}) {
      card.querySelector('[data-act=back]')?.addEventListener('click', back);
      card.querySelector('[data-act=skip]')?.addEventListener('click', next);
      card.querySelector('[data-act=next]')?.addEventListener('click', async () => {
        if (onNext) { const ok = await onNext(); if (ok === false) return; }
        next();
      });
    }

    function next() { goTo(stepIdx + 1); }
    function back() { goTo(stepIdx - 1); }
    function goTo(i) {
      if (i < 0 || i >= STEPS.length) return;
      stepIdx = i;
      renderProgress();
      renderStep();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderProgress() {
      const total = STEPS.length;
      const pct = Math.round(((stepIdx + 1) / total) * 100);
      const step = STEPS[stepIdx];
      document.getElementById('wizard-progress').innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.55);font-variant-numeric:tabular-nums;">
            <span style="color:${ACCENT};">${String(stepIdx + 1).padStart(2,'0')}</span>
            <span style="opacity:.5;">/ ${String(total).padStart(2,'0')}</span>
            <span style="width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,0.3);margin:0 2px;"></span>
            <span>${step.chapter}</span>
          </span>
          <span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);letter-spacing:0.06em;font-variant-numeric:tabular-nums;">${pct}%</span>
        </div>
        <div style="height:3px;width:100%;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${ACCENT},#fdba74);border-radius:999px;transition:width .35s cubic-bezier(.4,0,.2,1);"></div>
        </div>
      `;
    }

    function selectablePill({ value, label, selected }) {
      const border = selected ? `2px solid ${ACCENT}` : '1px solid rgba(255,255,255,0.14)';
      const bg = selected ? 'rgba(249,115,22,0.18)' : 'rgba(255,255,255,0.04)';
      const color = selected ? '#fff' : 'rgba(255,255,255,0.78)';
      const weight = selected ? '700' : '500';
      const ring = selected ? 'box-shadow:0 0 0 3px rgba(249,115,22,0.2);' : '';
      return `
        <button type="button" data-pill="${escapeAttr(value)}" style="padding:11px 18px;background:${bg};border:${border};border-radius:999px;color:${color};font-family:inherit;font-size:13px;font-weight:${weight};cursor:pointer;transition:all .15s;${ring}">
          ${escapeHtml(label)}
        </button>
      `;
    }

    function renderStep() {
      const step = STEPS[stepIdx];
      const stage = document.getElementById('wiz-stage');
      stage.innerHTML = '';
      const card = document.createElement('section');
      card.className = 'pkw-fadein';
      card.setAttribute('style', STYLE_CARD);
      stage.appendChild(card);

      if (step.key === 'bb-template')      renderTemplate(card);
      else if (step.key === 'bb-name')     renderName(card);
      else if (step.key === 'bb-about')    renderAbout(card);
      else if (step.key === 'bb-values')   renderValues(card);
      else if (step.key === 'bb-voice')    renderVoice(card);
      else if (step.key === 'bb-logo')     renderLogo(card);
      else if (step.key === 'bb-colors')   renderColors(card);
      else if (step.key === 'bb-typeface') renderTypeface(card);
      else if (step.key === 'bb-go')       renderGo(card);
    }

    function renderTemplate(card) {
      // Miniature real covers, one per style — actual type, not abstract bars.
      const brand = (BB.name || 'Acme').toUpperCase();
      const previews = {
        editorial: `
          <div style="aspect-ratio:4/3;background:#0a0a0a;border-radius:8px;padding:16px 14px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;">
            <div style="width:18px;height:18px;background:#fff;clip-path:polygon(0 100%, 45% 0, 75% 0, 30% 100%);margin-bottom:10px;"></div>
            <div style="font-size:13px;font-weight:700;letter-spacing:0.04em;color:#fff;line-height:1.15;">${brand}</div>
            <div style="font-size:13px;font-weight:700;letter-spacing:0.04em;color:rgba(255,255,255,0.4);line-height:1.15;">BRAND GUIDELINES</div>
          </div>`,
        corporate: `
          <div style="aspect-ratio:16/9;background:#1766e8;border-radius:8px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;">
            <div style="font-size:9px;font-weight:700;color:#fff;">${escapeHtml(BB.name || 'acme')}</div>
            <div style="font-family:'Inter',sans-serif;font-size:19px;font-weight:700;color:#fff;line-height:1.05;letter-spacing:-0.02em;">Brand<br/>Guidelines</div>
            <div style="font-size:7px;color:rgba(255,255,255,0.8);">2026</div>
          </div>`,
        urban: `
          <div style="aspect-ratio:16/9;background:#f0594e;border-radius:8px;padding:14px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;">
            <div style="font-family:'Anton',Impact,sans-serif;font-size:24px;color:#111;line-height:0.95;text-transform:uppercase;">Brand<br/>Guidelines</div>
          </div>`,
        contemporary: `
          <div style="aspect-ratio:16/9;background:#12b35f;border-radius:8px;padding:14px;position:relative;overflow:hidden;">
            <div style="position:absolute;left:-30px;bottom:-44px;width:84px;height:84px;border:6px solid rgba(0,0,0,0.22);border-radius:50%;"></div>
            <div style="position:absolute;left:6px;bottom:-70px;width:90px;height:90px;border:6px solid rgba(0,0,0,0.22);border-radius:50%;"></div>
            <div style="margin-left:42%;font-size:17px;font-weight:700;color:#fff;line-height:1.1;letter-spacing:-0.01em;">Brand<br/>Guidelines</div>
          </div>`,
      };
      const opts = [
        { value: 'editorial',    title: 'Editorial',    sub: 'Swiss black & white, landscape 4:3. The classic studio manual.' },
        { value: 'corporate',    title: 'Corporate',    sub: 'Clean 16:9 deck in your primary color. Boardroom-ready.' },
        { value: 'urban',        title: 'Urban',        sub: 'Loud condensed caps on a bold accent. Streetwear energy.' },
        { value: 'contemporary', title: 'Contemporary', sub: 'Full-color pages with playful outline circles. Startup-fresh.' },
      ];
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">Pick the book's style</h2>
        <p style="${STYLE_HELPER}">Four full templates. Color-driven ones use your first brand color across covers and dividers.</p>
        <div id="bb-tpl-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${opts.map((o) => {
            const sel = BB.template === o.value;
            return `
              <button type="button" data-tpl="${o.value}" style="text-align:left;padding:12px;background:${sel ? 'rgba(249,115,22,0.12)' : 'rgba(255,255,255,0.03)'};border:${sel ? `2px solid ${ACCENT}` : '1px solid rgba(255,255,255,0.12)'};border-radius:14px;color:#fff;font-family:inherit;cursor:pointer;transition:all .15s;${sel ? 'box-shadow:0 0 0 4px rgba(249,115,22,0.18);' : ''}">
                ${previews[o.value]}
                <div style="font-size:15px;font-weight:600;letter-spacing:-0.01em;margin:10px 0 2px;">${o.title}</div>
                <div style="font-size:11.5px;color:rgba(255,255,255,0.55);line-height:1.45;">${o.sub}</div>
              </button>
            `;
          }).join('')}
        </div>
        ${footerHTML({ hideSkip: true })}
      `;
      card.querySelector('#bb-tpl-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tpl]'); if (!b) return;
        BB.template = b.dataset.tpl;
        renderTemplate(card);
      });
      wireFooter(card);
    }

    function renderName(card) {
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">What's the brand name?</h2>
        <p style="${STYLE_HELPER}">Exactly as it should appear on the cover of your brand book.</p>
        <input id="bb-name" type="text" maxlength="80" class="pkw-input" value="${escapeAttr(BB.name)}" placeholder="e.g. Nirakara, Mattman Music, Grappes" style="${STYLE_INPUT}" autofocus />
        ${footerHTML({ hideSkip: true })}
      `;
      card.querySelector('#bb-name').addEventListener('input', (e) => { BB.name = e.target.value; });
      wireFooter(card, { onNext: async () => {
        const v = (card.querySelector('#bb-name').value || '').trim();
        if (!v) { card.querySelector('#bb-name').focus(); return false; }
        BB.name = v;
        return true;
      }});
    }

    function renderAbout(card) {
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">What does ${escapeHtml(BB.name) || 'the brand'} do?</h2>
        <p style="${STYLE_HELPER}">A few sentences in your own words. What you do, for whom, and what makes you different. The AI writes the whole book from this.</p>
        <textarea id="bb-about" maxlength="1000" class="pkw-textarea" placeholder="e.g. A boutique architecture firm specializing in sustainable, culturally reflective designs for private homes and hospitality projects." style="${STYLE_TEXTAREA}">${escapeAttr(BB.about)}</textarea>
        <label style="${STYLE_LABEL};margin-top:16px;">Industry (optional)</label>
        <input id="bb-industry" type="text" maxlength="80" class="pkw-input" value="${escapeAttr(BB.industry)}" placeholder="e.g. architecture, music, hospitality" style="${STYLE_INPUT}" />
        <label style="${STYLE_LABEL};margin-top:16px;">Website (optional)</label>
        <input id="bb-website" type="url" maxlength="200" class="pkw-input" value="${escapeAttr(BB.website)}" placeholder="e.g. https://yourbrand.com" style="${STYLE_INPUT}" />
        <p style="font-size:11.5px;color:rgba(255,255,255,0.4);margin:6px 0 0;line-height:1.5;">If you add it, we read your site and ground the book in your real story and copy.</p>
        ${footerHTML({ hideSkip: true })}
      `;
      card.querySelector('#bb-about').addEventListener('input', (e) => { BB.about = e.target.value; });
      card.querySelector('#bb-industry').addEventListener('input', (e) => { BB.industry = e.target.value; });
      card.querySelector('#bb-website').addEventListener('input', (e) => { BB.website = e.target.value; });
      wireFooter(card, { onNext: async () => {
        const v = (card.querySelector('#bb-about').value || '').trim();
        if (!v) { card.querySelector('#bb-about').focus(); return false; }
        BB.about = v;
        return true;
      }});
    }

    function renderValues(card) {
      const presets = ['Innovation', 'Craftsmanship', 'Sustainability', 'Integrity', 'Creativity', 'Precision', 'Community', 'Excellence', 'Authenticity', 'Simplicity', 'Boldness', 'Trust'];
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">What does the brand stand for?</h2>
        <p style="${STYLE_HELPER}">Pick up to 4 values, or skip and the AI derives them from your description.</p>
        <div id="bb-values-grid" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
          ${presets.map((v) => selectablePill({ value: v, label: v, selected: BB.values.includes(v) })).join('')}
        </div>
        <label style="${STYLE_LABEL}">Or add your own (comma separated)</label>
        <input id="bb-values-custom" type="text" maxlength="160" class="pkw-input" value="${escapeAttr(BB.values.filter((v) => !presets.includes(v)).join(', '))}" placeholder="e.g. Cultural integrity, Radical honesty" style="${STYLE_INPUT}" />
        ${footerHTML({ skipText: 'Let AI decide' })}
      `;
      card.querySelector('#bb-values-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pill]'); if (!b) return;
        const v = b.dataset.pill;
        if (BB.values.includes(v)) BB.values = BB.values.filter((x) => x !== v);
        else if (BB.values.length < 4) BB.values = [...BB.values, v];
        renderValues(card);
      });
      wireFooter(card, { onNext: async () => {
        const custom = (card.querySelector('#bb-values-custom').value || '').split(',').map((s) => s.trim()).filter(Boolean);
        const presetsPicked = BB.values.filter((v) => presets.includes(v));
        BB.values = [...presetsPicked, ...custom].slice(0, 4);
        return true;
      }});
    }

    function renderVoice(card) {
      const presets = ['Confident', 'Inspirational', 'Approachable', 'Knowledgeable', 'Playful', 'Bold', 'Warm', 'Minimal', 'Direct', 'Refined', 'Energetic', 'Calm'];
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">How should it sound?</h2>
        <p style="${STYLE_HELPER}">Pick up to 4 tone-of-voice adjectives, or skip and the AI decides.</p>
        <div id="bb-voice-grid" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
          ${presets.map((v) => selectablePill({ value: v, label: v, selected: BB.voice.includes(v) })).join('')}
        </div>
        ${footerHTML({ skipText: 'Let AI decide' })}
      `;
      card.querySelector('#bb-voice-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pill]'); if (!b) return;
        const v = b.dataset.pill;
        if (BB.voice.includes(v)) BB.voice = BB.voice.filter((x) => x !== v);
        else if (BB.voice.length < 4) BB.voice = [...BB.voice, v];
        renderVoice(card);
      });
      wireFooter(card);
    }

    function renderLogo(card) {
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">Upload your logo</h2>
        <p style="${STYLE_HELPER}">SVG or transparent PNG works best. We render it in monochrome across the book, exactly like a real guidelines document. Don't have one? <a href="/logo/new" style="color:${ACCENT};text-decoration:none;font-weight:600;">Make one in Logo Lab</a> first.</p>
        <div id="bb-logo-preview" style="margin-bottom:12px;"></div>
        <button type="button" id="bb-add-logo" style="${STYLE_ADD}">${BB.logoUrl ? 'Replace logo' : '+ Upload logo file'}</button>
        <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" id="bb-logo-input" style="display:none;" />
        <p id="bb-logo-err" style="display:none;font-size:12.5px;color:#ff8a8a;margin-top:8px;"></p>
        ${footerHTML({ hideSkip: true })}
      `;
      function renderPreview() {
        const wrap = card.querySelector('#bb-logo-preview');
        if (!BB.logoUrl) { wrap.innerHTML = ''; return; }
        wrap.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="background:#fafafa;border-radius:12px;aspect-ratio:2.2;display:flex;align-items:center;justify-content:center;padding:18px;">
              <img src="${BB.logoUrl}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;" />
            </div>
            <div style="background:#0a0a0a;border:1px solid rgba(255,255,255,0.12);border-radius:12px;aspect-ratio:2.2;display:flex;align-items:center;justify-content:center;padding:18px;">
              <img src="${BB.logoUrl}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;" />
            </div>
          </div>
          <p style="font-size:11.5px;color:rgba(255,255,255,0.4);margin:8px 0 0;line-height:1.5;">Your logo, exactly as uploaded. We place it on light or dark panels so it always stays visible.</p>
        `;
      }
      renderPreview();
      card.querySelector('#bb-add-logo').addEventListener('click', () => card.querySelector('#bb-logo-input').click());
      card.querySelector('#bb-logo-input').addEventListener('change', async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        const err = card.querySelector('#bb-logo-err');
        err.style.display = 'none';
        const btn = card.querySelector('#bb-add-logo');
        btn.disabled = true; btn.textContent = 'Uploading…';
        try {
          // Keep a local copy for client-side palette extraction (no CORS).
          const reader = new FileReader();
          reader.onload = () => {
            BB.logoDataUrl = reader.result;
            // Measure the mark's tone so the renderer can pick a contrasting panel.
            measureLogoTone().then((isLight) => { BB.logoIsLight = isLight; }).catch(() => {});
          };
          reader.readAsDataURL(file);

          // Same-origin multipart POST. Server stores to R2 and returns { url }.
          const fd = new FormData();
          fd.append('file', file);
          const resp = await fetch('/api/brandbook/sign-upload', { method: 'POST', body: fd });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.url) throw new Error(data.error || 'upload-failed');
          BB.logoUrl = data.url;
          renderPreview();
          btn.textContent = 'Replace logo';
        } catch (e2) {
          console.error(e2);
          err.textContent = 'Upload failed, try again.';
          err.style.display = 'block';
          btn.textContent = BB.logoUrl ? 'Replace logo' : '+ Upload logo file';
        } finally {
          btn.disabled = false;
        }
      });
      wireFooter(card, { onNext: async () => {
        if (!BB.logoUrl) {
          const err = card.querySelector('#bb-logo-err');
          err.textContent = 'The brand book is built around your logo — upload it first.';
          err.style.display = 'block';
          return false;
        }
        return true;
      }});
    }

    // Average luminance of the logo's opaque pixels → is the mark light or dark?
    function measureLogoTone() {
      return new Promise((resolve, reject) => {
        if (!BB.logoDataUrl) return reject(new Error('no-logo'));
        const img = new Image();
        img.onload = () => {
          try {
            const SIZE = 64;
            const cv = document.createElement('canvas');
            cv.width = SIZE; cv.height = SIZE;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, SIZE, SIZE);
            const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
            let sum = 0, n = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] < 140) continue;
              sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
              n++;
            }
            if (n === 0) return resolve(true); // all transparent → assume light mark
            resolve(sum / n > 0.5);
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('img-load'));
        img.src = BB.logoDataUrl;
      });
    }

    // Extract up to 3 dominant colors from the uploaded logo (local data URL).
    function extractLogoPalette() {
      return new Promise((resolve, reject) => {
        if (!BB.logoDataUrl) return reject(new Error('no-logo'));
        const img = new Image();
        img.onload = () => {
          try {
            const SIZE = 72;
            const cv = document.createElement('canvas');
            cv.width = SIZE; cv.height = SIZE;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, SIZE, SIZE);
            const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
            const buckets = new Map();
            for (let i = 0; i < data.length; i += 4) {
              const a = data[i + 3];
              if (a < 140) continue; // transparent
              const r = data[i], g = data[i + 1], b = data[i + 2];
              const key = `${r >> 4}-${g >> 4}-${b >> 4}`; // quantize to 16 levels
              const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
              cur.n++; cur.r += r; cur.g += g; cur.b += b;
              buckets.set(key, cur);
            }
            const all = [...buckets.values()]
              .map((x) => ({ n: x.n, r: x.r / x.n, g: x.g / x.n, b: x.b / x.n }))
              .sort((p, q) => q.n - p.n);
            const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
            const dist = (p, q) => Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b);
            // Prefer real colors (skip near-white/near-black); fall back if the mark is monochrome.
            let pool = all.filter((x) => lum(x) > 0.06 && lum(x) < 0.94);
            if (pool.length === 0) pool = all;
            const picked = [];
            for (const x of pool) {
              if (picked.some((p) => dist(p, x) < 90)) continue;
              picked.push(x);
              if (picked.length === 3) break;
            }
            // Order by brand vividness so the saturated mid-tone leads, not a pale tint.
            const vivid = (c) => {
              const mx = Math.max(c.r, c.g, c.b) / 255, mn = Math.min(c.r, c.g, c.b) / 255;
              const sat = mx === 0 ? 0 : (mx - mn) / mx, L = lum(c);
              return sat - Math.max(0, L - 0.72) * 1.2 - Math.max(0, 0.18 - L) * 1.2;
            };
            picked.sort((a, b) => vivid(b) - vivid(a));
            const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
            resolve(picked.map((p) => '#' + hex(p.r) + hex(p.g) + hex(p.b)));
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('img-load'));
        img.src = BB.logoDataUrl;
      });
    }

    function renderColors(card) {
      const swatch = (c, i) => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
          <span style="width:34px;height:34px;border-radius:9px;background:${c.hex};border:1px solid rgba(255,255,255,0.2);flex-shrink:0;"></span>
          <input data-label="${i}" type="text" maxlength="40" placeholder="Name (e.g. Brand Orange)" value="${escapeAttr(c.label || '')}" style="${STYLE_INPUT};height:38px;font-size:13.5px;flex:1;" />
          <button type="button" data-rm="${i}" style="width:30px;height:30px;border-radius:50%;border:0;background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font-size:14px;font-family:inherit;flex-shrink:0;">×</button>
        </div>
      `;
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">Brand colors</h2>
        <p style="${STYLE_HELPER}">White and black are always in the palette, like any serious guidelines doc. Add up to 4 brand colors, pull them straight from your logo, or skip for a pure monochrome identity.</p>
        ${BB.logoDataUrl && BB.colors.length < 4 ? `
        <button type="button" id="bb-extract" style="${STYLE_ADD};margin-bottom:10px;">
          <img src="${BB.logoDataUrl}" alt="" style="height:18px;width:auto;max-width:34px;object-fit:contain;opacity:.85;" />
          Extract colors from my logo
        </button>
        <p id="bb-extract-err" style="display:none;font-size:12px;color:#ff8a8a;margin:-4px 0 10px;"></p>` : ''}
        <div id="bb-colors-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
          ${BB.colors.map(swatch).join('')}
        </div>
        ${BB.colors.length < 4 ? `
        <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
          <input id="bb-color-pick" type="color" value="#f97316" style="width:48px;height:36px;padding:0;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:none;cursor:pointer;" />
          <span style="font-size:13px;color:rgba(255,255,255,0.78);font-weight:500;flex:1;">Pick a color</span>
          <button type="button" id="bb-color-add" style="${STYLE_BTN_GHOST};height:36px;">Add</button>
        </div>` : ''}
        ${footerHTML({ skipText: 'Black & white only' })}
      `;
      card.querySelector('#bb-extract')?.addEventListener('click', async () => {
        const btn = card.querySelector('#bb-extract');
        btn.disabled = true;
        try {
          const hexes = await extractLogoPalette();
          const existing = new Set(BB.colors.map((c) => c.hex));
          for (const hx of hexes) {
            if (BB.colors.length >= 4) break;
            if (!existing.has(hx)) BB.colors.push({ hex: hx, label: '' });
          }
          renderColors(card);
        } catch (e) {
          const err = card.querySelector('#bb-extract-err');
          if (err) {
            err.textContent = 'Could not read colors from this logo, pick them manually.';
            err.style.display = 'block';
          }
          btn.disabled = false;
        }
      });
      card.querySelector('#bb-color-add')?.addEventListener('click', () => {
        const hex = card.querySelector('#bb-color-pick').value;
        BB.colors = [...BB.colors, { hex, label: '' }];
        renderColors(card);
      });
      card.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        BB.colors = BB.colors.filter((_, j) => j !== +b.dataset.rm);
        renderColors(card);
      }));
      card.querySelectorAll('[data-label]').forEach((inp) => inp.addEventListener('input', () => {
        BB.colors[+inp.dataset.label].label = inp.value;
      }));
      wireFooter(card);
    }

    function renderTypeface(card) {
      const fonts = ['Inter', 'Archivo', 'Space Grotesk', 'Manrope', 'Work Sans', 'IBM Plex Sans', 'DM Sans', 'Sora'];
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">Pick the brand typeface</h2>
        <p style="${STYLE_HELPER}">The whole book is set in it, and it becomes your official brand font. All free for commercial use.</p>
        <div id="bb-font-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${fonts.map((f) => {
            const sel = BB.typeface === f;
            return `
              <button type="button" data-font="${f}" style="position:relative;text-align:left;padding:18px 20px;background:${sel ? 'rgba(249,115,22,0.12)' : 'rgba(255,255,255,0.03)'};border:${sel ? `2px solid ${ACCENT}` : '1px solid rgba(255,255,255,0.12)'};border-radius:14px;color:#fff;font-family:'${f}',sans-serif;cursor:pointer;transition:all .15s;${sel ? 'box-shadow:0 0 0 4px rgba(249,115,22,0.18);' : ''}">
                <div style="font-size:21px;font-weight:600;letter-spacing:-0.01em;margin-bottom:2px;">${f}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.55);">Aa Bb Cc 0123</div>
              </button>
            `;
          }).join('')}
        </div>
        ${footerHTML({ hideSkip: true })}
      `;
      card.querySelector('#bb-font-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-font]'); if (!b) return;
        BB.typeface = b.dataset.font;
        renderTypeface(card);
      });
      wireFooter(card);
    }

    function renderGo(card) {
      const summaryRow = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12.5px;"><span style="color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${k}</span><span style="color:#fff;text-align:right;max-width:60%;">${v}</span></div>`;
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">Ready — let's build the book.</h2>
        <p style="${STYLE_HELPER}">A complete brand guidelines document: intro, values, tone of voice, logo rules, colors, typography. Around 20 pages, exportable as PDF.</p>

        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:14px 18px;margin-bottom:18px;">
          ${summaryRow('Template', BB.template.charAt(0).toUpperCase() + BB.template.slice(1))}
          ${summaryRow('Brand', escapeHtml(BB.name))}
          ${summaryRow('About', escapeHtml(BB.about.length > 64 ? BB.about.slice(0, 64) + '…' : BB.about))}
          ${BB.website ? summaryRow('Website', escapeHtml(BB.website)) : ''}
          ${summaryRow('Values', BB.values.length ? escapeHtml(BB.values.join(', ')) : 'AI decides')}
          ${summaryRow('Tone', BB.voice.length ? escapeHtml(BB.voice.join(', ')) : 'AI decides')}
          ${summaryRow('Logo', BB.logoUrl ? '<span style="color:#6ee7a3;">Uploaded ✓</span>' : '—')}
          ${summaryRow('Colors', BB.colors.length ? BB.colors.map((c) => `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${c.hex};border:1px solid rgba(255,255,255,0.2);margin-left:4px;vertical-align:-1px;"></span>`).join('') + ' + B/W' : 'Black & white')}
          ${summaryRow('Typeface', escapeHtml(BB.typeface))}
        </div>

        <button type="button" id="bb-go" style="${STYLE_BTN_PRIMARY};height:54px;width:100%;font-size:14.5px;background:linear-gradient(135deg,${ACCENT} 0%, #fdba74 140%);">
          Generate my brand book
        </button>

        <div id="bb-progress" style="display:none;font-size:12.5px;color:rgba(255,255,255,0.65);margin-top:12px;">
          <div data-pstep="1" style="padding:6px 0;color:${ACCENT};">1. Writing your brand story…</div>
          <div data-pstep="2" style="padding:6px 0;color:rgba(255,255,255,0.35);">2. Laying out the pages…</div>
          <div data-pstep="3" style="padding:6px 0;color:rgba(255,255,255,0.35);">3. Saving your brand book…</div>
        </div>
        <p id="bb-error" style="display:none;font-size:12.5px;color:#ff8a8a;margin-top:8px;"></p>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:32px;padding-top:22px;border-top:1px solid rgba(255,255,255,0.06);">
          <button type="button" data-act="back" class="pkw-secondary" style="${STYLE_BTN_LINK}">← Back</button>
          <a href="/brandbook" style="font-size:11.5px;color:rgba(255,255,255,0.45);text-decoration:none;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Cancel</a>
        </div>
      `;
      card.querySelector('[data-act=back]').addEventListener('click', back);

      function setPStep(n, status) {
        card.querySelectorAll('#bb-progress [data-pstep]').forEach((el) => {
          const s = +el.dataset.pstep;
          if (s < n) { el.style.color = '#6ee7a3'; }
          else if (s === n) { el.style.color = status === 'done' ? '#6ee7a3' : ACCENT; }
          else { el.style.color = 'rgba(255,255,255,0.35)'; }
        });
      }

      card.querySelector('#bb-go').addEventListener('click', async () => {
        const goBtn = card.querySelector('#bb-go');
        const err = card.querySelector('#bb-error');
        const prog = card.querySelector('#bb-progress');
        err.style.display = 'none';
        prog.style.display = 'block';
        goBtn.disabled = true; goBtn.textContent = 'Generating…';

        setPStep(1, 'active');
        const t2 = setTimeout(() => setPStep(2, 'active'), 14000);
        const t3 = setTimeout(() => setPStep(3, 'active'), 26000);

        try {
          const r = await fetch('/api/brandbook/generate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: BB.name,
              about: BB.about,
              industry: BB.industry || undefined,
              website: BB.website || undefined,
              values: BB.values,
              voiceKeywords: BB.voice,
              colors: BB.colors,
              typeface: BB.typeface,
              logoUrl: BB.logoUrl,
              logoIsLight: BB.logoIsLight,
              template: BB.template,
            }),
          });
          const data = await r.json();
          clearTimeout(t2); clearTimeout(t3);
          if (!r.ok) {
            err.textContent = data.error || 'Generation failed.';
            err.style.display = 'block'; prog.style.display = 'none';
            goBtn.disabled = false; goBtn.textContent = 'Generate my brand book';
            return;
          }
          setPStep(3, 'done');
          window.location.href = `/brandbook/${data.id}`;
        } catch (e) {
          clearTimeout(t2); clearTimeout(t3);
          err.textContent = 'Network error.';
          err.style.display = 'block'; prog.style.display = 'none';
          goBtn.disabled = false; goBtn.textContent = 'Generate my brand book';
        }
      });
    }

    renderProgress();
    renderStep();

})();
