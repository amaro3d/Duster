// Áudio 100% procedural (WebAudio): mar, vento, prancha na água, rumor do tubo, splash.
export class GameAudio {
  constructor() { this.ok = false; }
  init() {
    if (this.ok) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    const sr = ctx.sampleRate;
    const mkNoise = (sec, pink) => {
      const b = ctx.createBuffer(1, sr * sec, sr), d = b.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (pink) { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
        else d[i] = w;
      }
      return b;
    };
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const nWhite = mkNoise(3, false), nPink = mkNoise(4, true);
    // reverb sintético (tubo)
    const irLen = sr * 2.2, ir = ctx.createBuffer(2, irLen, sr);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2); }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const convG = this.convG = ctx.createGain(); convG.gain.value = 0.0; conv.connect(convG); convG.connect(master);
    // mar (rumor distante)
    const sea = loop(nPink), seaF = ctx.createBiquadFilter(); seaF.type = 'lowpass'; seaF.frequency.value = 420;
    const seaG = this.seaG = ctx.createGain(); seaG.gain.value = 0.35; sea.connect(seaF); seaF.connect(seaG); seaG.connect(master);
    this.seaF = seaF;
    // ondulação lenta no mar
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lg = ctx.createGain(); lg.gain.value = 0.12; lfo.connect(lg); lg.connect(seaG.gain); lfo.start();
    // vento
    const wind = loop(nWhite), windF = ctx.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 900; windF.Q.value = 0.6;
    const windG = this.windG = ctx.createGain(); windG.gain.value = 0; wind.connect(windF); windF.connect(windG); windG.connect(master); this.windF = windF;
    // prancha na água (chiado)
    const hiss = loop(nWhite), hissF = ctx.createBiquadFilter(); hissF.type = 'bandpass'; hissF.frequency.value = 2400; hissF.Q.value = 0.5;
    const hissG = this.hissG = ctx.createGain(); hissG.gain.value = 0; hiss.connect(hissF); hissF.connect(hissG); hissG.connect(master); hissG.connect(conv); this.hissF = hissF;
    // rumor do tubo
    const rum = loop(nPink), rumF = ctx.createBiquadFilter(); rumF.type = 'lowpass'; rumF.frequency.value = 160;
    const rumG = this.rumG = ctx.createGain(); rumG.gain.value = 0; rum.connect(rumF); rumF.connect(rumG); rumG.connect(master); rumG.connect(conv);
    // quebra da onda (atrás)
    const crash = loop(nPink), crashF = ctx.createBiquadFilter(); crashF.type = 'lowpass'; crashF.frequency.value = 700;
    const crashG = this.crashG = ctx.createGain(); crashG.gain.value = 0; crash.connect(crashF); crashF.connect(crashG); crashG.connect(master); crashG.connect(conv);
    this.crashF = crashF;
    this.nWhite = nWhite; this.nPink = nPink;
    this.ok = true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  set(p) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, s = 0.08;
    const sp = p.speed || 0;
    this.windG.gain.setTargetAtTime(Math.min(0.5, sp * 0.028) * (p.air ? 0.7 : 1) * (p.under ? 0 : 1), t, s);
    this.windF.frequency.setTargetAtTime(500 + sp * 70, t, s);
    this.hissG.gain.setTargetAtTime(p.riding ? Math.min(0.5, sp * 0.03) * (0.5 + p.carve * 0.8) : 0, t, s);
    this.hissF.frequency.setTargetAtTime(1500 + sp * 120, t, s);
    this.rumG.gain.setTargetAtTime(p.tube * 0.55 + (p.under ? 0.5 : 0), t, 0.2);
    this.convG.gain.setTargetAtTime(0.35 + p.tube * 0.7, t, 0.2);
    this.crashG.gain.setTargetAtTime(p.crash * 0.55, t, 0.15);
    this.seaG.gain.setTargetAtTime(p.under ? 0.12 : 0.3, t, 0.2);
    this.seaF.frequency.setTargetAtTime(p.under ? 160 : 420, t, 0.2);
  }
  burst(kind) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.nWhite;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    let dur = 0.6, f0 = 1800, f1 = 300, vol = 0.7;
    if (kind === 'splash') { dur = 1.6; f0 = 3000; f1 = 200; vol = 1.0; }
    if (kind === 'pop') { dur = 0.35; f0 = 1200; f1 = 3500; vol = 0.4; }
    if (kind === 'land') { dur = 0.5; f0 = 2200; f1 = 400; vol = 0.6; }
    if (kind === 'trick') { dur = 0.4; f0 = 800; f1 = 2400; vol = 0.25; }
    f.type = 'bandpass'; f.Q.value = 0.7; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 1.5, dur + 0.1);
  }
}
