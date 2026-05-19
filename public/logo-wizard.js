(function(){
    // a brand-name step (since there is no kit name to fall back on).

    const ACCENT = '#a78bfa';
    const LG = { name: '', type: 'icon', mood: '', desc: '', style: '', primaryColor: null, refs: [] };

    const STEPS = [
      { key: 'logo-name',  chapter: 'Brand', title: 'Brand name' },
      { key: 'logo-type',  chapter: 'Brand', title: 'What kind of logo?' },
      { key: 'logo-vibe',  chapter: 'Brand', title: 'What should it feel like?' },
      { key: 'logo-desc',  chapter: 'Brand', title: 'What should appear in it?' },
      { key: 'logo-refs',  chapter: 'Brand', title: 'Any visual references?' },
      { key: 'logo-color', chapter: 'Brand', title: 'A specific color in mind?' },
      { key: 'logo-go',    chapter: 'Brand', title: 'Generate.' },
    ];
    let stepIdx = 0;

    const STYLE_CARD = 'background:linear-gradient(180deg,rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%),rgba(18,18,22,0.92);backdrop-filter:blur(24px) saturate(1.3);-webkit-backdrop-filter:blur(24px) saturate(1.3);border:1px solid rgba(255,255,255,0.09);border-radius:20px;padding:36px 40px 28px;max-width:680px;margin:0 auto;box-shadow:0 1px 0 rgba(255,255,255,0.05) inset, 0 18px 40px -22px rgba(0,0,0,0.55);';
    const STYLE_EYEBROW = 'display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#a78bfa;padding:5px 12px;border-radius:999px;background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.32);';
    const STYLE_EYEBROW_DOT = 'width:6px;height:6px;border-radius:50%;background:#a78bfa;box-shadow:0 0 8px rgba(167,139,250,0.7);';
    const STYLE_TITLE = "font-family:'Inter',sans-serif;font-size:clamp(26px,3.4vw,34px);font-weight:300;letter-spacing:-0.028em;line-height:1.1;color:#fff;margin:18px 0 10px;";
    const STYLE_HELPER = 'font-size:13.5px;color:rgba(255,255,255,0.55);margin:0 0 26px;line-height:1.55;max-width:580px;';
    const STYLE_LABEL = "font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:0.1em;display:block;margin-bottom:8px;";
    const STYLE_INPUT = 'width:100%;height:48px;padding:0 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.14);border-radius:12px;color:#fff;font-family:inherit;font-size:15px;outline:none;transition:border-color .15s, box-shadow .15s;';
    const STYLE_TEXTAREA = 'width:100%;padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.14);border-radius:12px;color:#fff;font-family:inherit;font-size:15px;line-height:1.6;outline:none;resize:vertical;min-height:130px;transition:border-color .15s, box-shadow .15s;';
    const STYLE_BTN_PRIMARY = 'height:48px;padding:0 26px;background:#a78bfa;color:#0a0a0a;border:none;border-radius:999px;font-family:inherit;font-size:13.5px;font-weight:700;letter-spacing:0.04em;cursor:pointer;transition:background .15s;';
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
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${ACCENT},#c4b5fd);border-radius:999px;transition:width .35s cubic-bezier(.4,0,.2,1);"></div>
        </div>
      `;
    }

    function selectableTile({ value, title, sub, selected }) {
      const border = selected ? `2px solid ${ACCENT}` : '1px solid rgba(255,255,255,0.12)';
      const bg = selected ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.03)';
      const ring = selected ? 'box-shadow:0 0 0 4px rgba(167,139,250,0.18);' : '';
      const dot = selected
        ? `<span style="position:absolute;top:14px;right:14px;width:18px;height:18px;border-radius:50%;background:${ACCENT};display:inline-flex;align-items:center;justify-content:center;color:#0a0a0a;font-size:11px;font-weight:900;">&#10003;</span>`
        : '';
      return `
        <button type="button" data-tile="${value}" style="position:relative;text-align:left;padding:22px 22px 20px;background:${bg};border:${border};border-radius:16px;color:#fff;font-family:inherit;cursor:pointer;transition:all .15s;${ring}">
          ${dot}
          <div style="font-size:16px;font-weight:600;letter-spacing:-0.01em;margin-bottom:4px;color:#fff;">${title}</div>
          <div style="font-size:12.5px;color:rgba(255,255,255,0.6);line-height:1.5;">${sub}</div>
        </button>
      `;
    }

    function selectablePill({ value, label, selected }) {
      const border = selected ? `2px solid ${ACCENT}` : '1px solid rgba(255,255,255,0.14)';
      const bg = selected ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.04)';
      const color = selected ? '#fff' : 'rgba(255,255,255,0.78)';
      const weight = selected ? '700' : '500';
      const ring = selected ? 'box-shadow:0 0 0 3px rgba(167,139,250,0.2);' : '';
      return `
        <button type="button" data-pill="${value}" style="padding:11px 18px;background:${bg};border:${border};border-radius:999px;color:${color};font-family:inherit;font-size:13px;font-weight:${weight};cursor:pointer;transition:all .15s;${ring}">
          ${label}
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

      if (step.key === 'logo-name')       renderLogoName(card);
      else if (step.key === 'logo-type')  renderLogoType(card);
      else if (step.key === 'logo-vibe')  renderLogoVibe(card);
      else if (step.key === 'logo-desc')  renderLogoDesc(card);
      else if (step.key === 'logo-refs')  renderLogoRefs(card);
      else if (step.key === 'logo-color') renderLogoColor(card);
      else if (step.key === 'logo-go')    renderLogoGo(card);
    }

    function renderLogoName(card) {
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">What's the brand name?</h2>
        <p style="${STYLE_HELPER}">The name we'll build the logo around. Doesn't need to be final — you can generate another later.</p>
        <input id="lg-name" type="text" maxlength="80" class="pkw-input" value="${escapeAttr(LG.name)}" placeholder="e.g. Mattman Music, Ana Pop, EdiP" style="${STYLE_INPUT}" autofocus />
        ${footerHTML({ hideSkip: true, nextText: 'Continue →' })}
      `;
      card.querySelector('#lg-name').addEventListener('input', (e) => { LG.name = e.target.value; });
      wireFooter(card, { onNext: async () => {
        const v = (card.querySelector('#lg-name').value || '').trim();
        if (!v) { card.querySelector('#lg-name').focus(); return false; }
        LG.name = v;
        return true;
      }});
    }

    function renderLogoType(card) {
      const opts = [
        { value: 'icon',        title: 'Just an icon', sub: 'A symbol or mark on its own. Cleanest at small sizes — favicons, app icons.' },
        { value: 'wordmark',    title: 'A wordmark',   sub: `Your brand name ("${escapeHtml(LG.name) || 'your brand'}") as the whole logo, in a strong custom letterform.` },
        { value: 'combination', title: 'Icon + text',  sub: `An icon next to "${escapeHtml(LG.name) || 'your brand'}", working together as one mark.` },
      ];
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">What kind of logo do you want?</h2>
        <p style="${STYLE_HELPER}">Pick the shape. We'll figure out the details together over the next few questions.</p>
        <div id="lg-type-grid" style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:8px;">
          ${opts.map(o => selectableTile({ ...o, selected: LG.type === o.value })).join('')}
        </div>
        ${footerHTML({ hideSkip: true, nextText: 'Continue →' })}
      `;
      card.querySelector('#lg-type-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tile]'); if (!b) return;
        LG.type = b.dataset.tile;
        renderLogoType(card);
      });
      wireFooter(card);
    }

    function renderLogoVibe(card) {
      const moods = [
        ['minimal','Minimal · clean'], ['bold','Bold · loud'], ['editorial','Editorial · refined'],
        ['geometric','Geometric'], ['organic','Organic · flowing'], ['playful','Playful'],
        ['hand-drawn','Hand-drawn'], ['brutalist','Brutalist'], ['modernist','Modernist · swiss'],
        ['retro','Retro · vintage'], ['futuristic','Futuristic'], ['luxury','Luxury'],
      ];
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">What should it feel like?</h2>
        <p style="${STYLE_HELPER}">Pick one vibe. This becomes the mood the AI aims for.</p>
        <div id="lg-vibe-grid" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
          ${moods.map(([v,l]) => selectablePill({ value: v, label: l, selected: LG.mood === v })).join('')}
        </div>
        ${footerHTML({ skipText: 'Skip vibe', nextText: 'Continue →' })}
      `;
      card.querySelector('#lg-vibe-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pill]'); if (!b) return;
        LG.mood = LG.mood === b.dataset.pill ? '' : b.dataset.pill;
        renderLogoVibe(card);
      });
      wireFooter(card);
    }

    function renderLogoDesc(card) {
      const subTitle = LG.type === 'wordmark'
        ? `Anything you want us to know about the wordmark? (e.g. "all-caps, geometric sans, single weight")`
        : LG.type === 'combination'
          ? `Describe the icon that should sit next to "${escapeHtml(LG.name)}". Name the motif, shape, or concept.`
          : `Describe the icon. Name the motif, shape, or concept — be specific so the AI uses it.`;
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">What should appear in it?</h2>
        <p style="${STYLE_HELPER}">${subTitle}</p>
        <textarea id="lg-desc" maxlength="500" class="pkw-textarea" placeholder="${LG.type === 'wordmark' ? 'e.g. all-caps geometric sans, tight tracking, single weight, sharp terminals' : 'e.g. an abstract snowflake fused with the letter A — single line, sharp, geometric'}" style="${STYLE_TEXTAREA};min-height:130px;">${escapeAttr(LG.desc || '')}</textarea>
        <p style="font-size:11.5px;color:rgba(255,255,255,0.4);margin:6px 0 14px;line-height:1.5;">The AI takes this <b style="color:rgba(255,255,255,0.7);font-weight:600;">literally</b>. Whatever you name here will land in the logo.</p>
        <label style="${STYLE_LABEL};margin-top:6px;">Extra style keywords (optional)</label>
        <input id="lg-style" type="text" maxlength="120" class="pkw-input" value="${escapeAttr(LG.style || '')}" placeholder="e.g. monogram, single line, swiss, art deco" style="${STYLE_INPUT}" />
        ${footerHTML({ skipText: 'Skip details', nextText: 'Continue →' })}
      `;
      card.querySelector('#lg-desc').addEventListener('input', (e) => { LG.desc = e.target.value; });
      card.querySelector('#lg-style').addEventListener('input', (e) => { LG.style = e.target.value; });
      wireFooter(card);
    }

    function renderLogoRefs(card) {
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">Any visual references?</h2>
        <p style="${STYLE_HELPER}">Up to 3 photos of logos / styles you'd like ours to <em>feel like</em> (not copy). Optional.</p>
        <div id="lg-refs" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px;"></div>
        <button type="button" id="lg-add-ref" style="${STYLE_ADD}">+ Add reference photo</button>
        <input type="file" accept="image/*" id="lg-ref-input" style="display:none;" />
        ${footerHTML({ skipText: 'Skip references', nextText: 'Continue →' })}
      `;
      function renderRefs() {
        const wrap = card.querySelector('#lg-refs');
        if (LG.refs.length === 0) { wrap.innerHTML = ''; return; }
        wrap.innerHTML = LG.refs.map((u, i) => `
          <div style="position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);">
            <img src="${u}" alt="" style="width:100%;height:100%;object-fit:cover;" />
            <button type="button" data-rm-ref="${i}" style="position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;border:0;background:rgba(0,0,0,0.75);color:#fff;cursor:pointer;font-size:13px;font-family:inherit;">×</button>
          </div>
        `).join('');
        wrap.querySelectorAll('[data-rm-ref]').forEach(b => b.addEventListener('click', () => {
          const idx = +b.dataset.rmRef;
          LG.refs = LG.refs.filter((_, j) => j !== idx);
          renderRefs();
        }));
      }
      renderRefs();
      card.querySelector('#lg-add-ref').addEventListener('click', () => {
        if (LG.refs.length >= 3) return;
        card.querySelector('#lg-ref-input').click();
      });
      // Reference photos for Logo Lab: until we ship a Logo-Lab specific upload
      // endpoint we read as data URLs and POST those to Recraft via reference
      // images URL field. Recraft requires HTTP(S) URLs — so we upload to Blob
      // through a tiny client-side import.
      card.querySelector('#lg-ref-input').addEventListener('change', async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        try {
          const { upload } = await import('https://esm.sh/@vercel/blob@2.3.3/client');
          const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: `/api/logo/sign-upload` });
          LG.refs = [...LG.refs, blob.url];
          renderRefs();
        } catch (err) {
          console.error(err);
          alert('Upload failed.');
        }
      });
      wireFooter(card);
    }

    function renderLogoColor(card) {
      const presets = ['#0f5132','#6b1d1d','#1d2bd1','#e25822','#1e3a8a','#b65238','#5a6b2f','#0b1f3a','#c97064','#7a8b6f','#0a0a0a','#fafafa'];
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">A specific color in mind?</h2>
        <p style="${STYLE_HELPER}">Skip and we'll pick a bold accent automatically.</p>
        <div id="lg-color-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px;">
          ${presets.map(h => `
            <button type="button" data-color="${h}" title="${h}" style="aspect-ratio:1;border-radius:12px;background:${h};border:${LG.primaryColor === h ? '3px solid #fff' : '1px solid rgba(255,255,255,0.12)'};cursor:pointer;position:relative;${LG.primaryColor === h ? 'box-shadow:0 0 0 3px rgba(167,139,250,0.45);' : ''}"></button>
          `).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
          <input id="lg-custom-color" type="color" value="${LG.primaryColor || '#a78bfa'}" style="width:48px;height:36px;padding:0;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:none;cursor:pointer;" />
          <span style="font-size:13px;color:rgba(255,255,255,0.78);font-weight:500;">Or pick any custom color</span>
          ${LG.primaryColor ? `<button type="button" id="lg-clear-color" style="margin-left:auto;height:32px;padding:0 14px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.75);border:1px solid rgba(255,255,255,0.14);border-radius:999px;font-family:inherit;font-size:11.5px;font-weight:600;cursor:pointer;">Clear</button>` : ''}
        </div>
        ${footerHTML({ skipText: 'Skip color', nextText: 'Continue →' })}
      `;
      card.querySelector('#lg-color-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]'); if (!b) return;
        LG.primaryColor = LG.primaryColor === b.dataset.color ? null : b.dataset.color;
        renderLogoColor(card);
      });
      card.querySelector('#lg-custom-color').addEventListener('input', (e) => {
        LG.primaryColor = e.target.value;
        renderLogoColor(card);
      });
      card.querySelector('#lg-clear-color')?.addEventListener('click', () => {
        LG.primaryColor = null;
        renderLogoColor(card);
      });
      wireFooter(card);
    }

    function renderLogoGo(card) {
      const typeLabel = ({ icon: 'Icon only', wordmark: 'Wordmark', combination: 'Icon + text' })[LG.type] || LG.type;
      const summaryRow = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12.5px;"><span style="color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${k}</span><span style="color:#fff;text-align:right;max-width:60%;">${v}</span></div>`;
      card.innerHTML = `
        ${eyebrowHTML()}
        <h2 style="${STYLE_TITLE}">Ready — let's generate it.</h2>
        <p style="${STYLE_HELPER}">Quick recap of your answers, then we'll create your logo.</p>

        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:14px 18px;margin-bottom:18px;">
          ${summaryRow('Brand name', escapeHtml(LG.name))}
          ${summaryRow('Type', typeLabel)}
          ${summaryRow('Vibe', LG.mood || '—')}
          ${summaryRow('Description', LG.desc ? (LG.desc.length > 64 ? escapeHtml(LG.desc.slice(0, 64)) + '…' : escapeHtml(LG.desc)) : '—')}
          ${summaryRow('Style keywords', LG.style ? escapeHtml(LG.style) : '—')}
          ${summaryRow('References', LG.refs.length > 0 ? LG.refs.length + ' photo' + (LG.refs.length === 1 ? '' : 's') : '—')}
          ${summaryRow('Color', LG.primaryColor ? `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:12px;border-radius:3px;background:${LG.primaryColor};border:1px solid rgba(255,255,255,0.2);"></span>${LG.primaryColor}</span>` : 'Auto')}
        </div>

        <button type="button" id="lg-go" style="${STYLE_BTN_PRIMARY};height:54px;width:100%;font-size:14.5px;background:linear-gradient(135deg,${ACCENT} 0%, #c4b5fd 140%);">
          Generate my logo
        </button>

        <div id="lg-progress" style="display:none;font-size:12.5px;color:rgba(255,255,255,0.65);margin-top:12px;">
          <div data-pstep="1" style="padding:6px 0;color:${ACCENT};">1. Generating with AI…</div>
          <div data-pstep="2" style="padding:6px 0;color:rgba(255,255,255,0.35);">2. Vectorizing to SVG…</div>
          <div data-pstep="3" style="padding:6px 0;color:rgba(255,255,255,0.35);">3. Saving to your library…</div>
        </div>
        <p id="lg-error" style="display:none;font-size:12.5px;color:#ff8a8a;margin-top:8px;"></p>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:32px;padding-top:22px;border-top:1px solid rgba(255,255,255,0.06);">
          <button type="button" data-act="back" class="pkw-secondary" style="${STYLE_BTN_LINK}">← Back</button>
          <a href="/logo" style="font-size:11.5px;color:rgba(255,255,255,0.45);text-decoration:none;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Cancel</a>
        </div>
      `;
      card.querySelector('[data-act=back]').addEventListener('click', back);

      function setPStep(n, status) {
        card.querySelectorAll('#lg-progress [data-pstep]').forEach(el => {
          const s = +el.dataset.pstep;
          if (s < n) { el.style.color = '#6ee7a3'; }
          else if (s === n) { el.style.color = status === 'done' ? '#6ee7a3' : ACCENT; }
          else { el.style.color = 'rgba(255,255,255,0.35)'; }
        });
      }

      card.querySelector('#lg-go').addEventListener('click', async () => {
        const goBtn = card.querySelector('#lg-go');
        const err = card.querySelector('#lg-error');
        const prog = card.querySelector('#lg-progress');
        err.style.display = 'none';
        prog.style.display = 'block';
        goBtn.disabled = true; goBtn.textContent = 'Generating…';

        setPStep(1, 'active');
        const t2 = setTimeout(() => setPStep(2, 'active'), 9000);
        const t3 = setTimeout(() => setPStep(3, 'active'), 18000);

        try {
          const r = await fetch('/api/logo/generate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              brandName: LG.name,
              description: LG.desc || undefined,
              style: LG.style || undefined,
              primaryColor: LG.primaryColor || undefined,
              referenceImages: LG.refs,
              logoType: LG.type,
              mood: LG.mood || undefined,
            }),
          });
          const data = await r.json();
          clearTimeout(t2); clearTimeout(t3);
          if (!r.ok) {
            err.textContent = data.error || 'Generation failed.';
            err.style.display = 'block'; prog.style.display = 'none';
            goBtn.disabled = false; goBtn.textContent = 'Generate my logo';
            return;
          }
          setPStep(3, 'done');
          window.location.href = `/logo/${data.id}`;
        } catch (e) {
          clearTimeout(t2); clearTimeout(t3);
          err.textContent = 'Network error.';
          err.style.display = 'block'; prog.style.display = 'none';
          goBtn.disabled = false; goBtn.textContent = 'Generate my logo';
        }
      });
    }

    renderProgress();
    renderStep();

})();
