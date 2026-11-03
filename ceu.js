// Panorâmicas 360° reais do CT Salim (Three.js). Uma esfera vista por dentro, com um shader de
// "luz primeiro": com uLuz baixo só os pixels mais claros (LEDs, neon) aparecem; em 1, a foto inteira.
// O index.html controla a interface (abertura, tour, foco); aqui fica só a cena.
import * as THREE from 'three';

const VERT = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = `precision highp float;
uniform sampler2D uTex;
uniform float uLuz;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float t = 1.0 - uLuz * 1.3;
  float k = smoothstep(t, t + 0.3, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const rad = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;

export function suportaWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

function animar(alvo, props, dur, ease = 'power2.inOut') {
  return new Promise((ok) => {
    if (!window.gsap || dur <= 0) { Object.assign(alvo, props); ok(); return; }
    window.gsap.to(alvo, { ...props, duration: dur, ease, overwrite: 'auto', onComplete: ok });
  });
}

export class Esfera {
  constructor(canvas, { fov = 66, latMin = -32, latMax = 72, giro = 0, cursor = false, dprMax = 1.5 } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // as fotos já estão em sRGB: passa direto
    this.renderer.setClearColor(0x05070d, 1);
    this.dprMax = dprMax;
    this.cena = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
    const geo = new THREE.SphereGeometry(10, 96, 64);
    geo.scale(-1, 1, 1);
    this.u = { uTex: { value: null }, uLuz: { value: 1 } };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, depthWrite: false });
    this.cena.add(new THREE.Mesh(geo, mat));

    // Estado que o GSAP anima de fora: lon/lat em graus (lon = 180 + yaw do ffmpeg v360), luz de 0 a 1
    this.v = { lon: 270, lat: 2, luz: 1, fov };
    this.latMin = latMin; this.latMax = latMax;
    this.giro = giro;              // graus por segundo quando ninguém arrasta
    this.usaCursor = cursor;
    this.extra = { lon: 0, lat: 0 }; this.alvoExtra = { lon: 0, lat: 0 };
    this.vel = 0; this.arrastando = false; this.pausaGiro = 0;
    this.texturas = new Map();
    this.trocas = 0;               // conta os pedidos de troca de lugar; só o último vale
    this.visivel = true; this.ligado = false; this.ultimo = 0;
    this.loader = new THREE.TextureLoader();

    this._tamanho();
    this.ro = new ResizeObserver(() => this._tamanho());
    this.ro.observe(canvas);
    this._eventos();
    this._loop = this._loop.bind(this);
  }

  _tamanho() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprMax, 2560 / Math.max(1, window.innerWidth)));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _eventos() {
    const c = this.canvas;
    let x0 = 0, y0 = 0, t0 = 0, id = null;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = performance.now();
      this.arrastando = true; this.vel = 0;
      c.classList.add('arrastando');
      try { c.setPointerCapture(id); } catch (err) { /* sem captura */ }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.arrastando || e.pointerId !== id) return;
      const k = this.camera.fov / (c.clientHeight || 600);   // graus por pixel, igual ao zoom atual
      const dx = e.clientX - x0, dy = e.clientY - y0;
      const agora = performance.now(), dt = Math.max(1, agora - t0);
      this.v.lon -= dx * k;
      this.v.lat = clamp(this.v.lat + dy * k, this.latMin, this.latMax);
      this.vel = (-dx * k) / dt * 16;
      x0 = e.clientX; y0 = e.clientY; t0 = agora;
    });
    const soltar = (e) => {
      if (!this.arrastando || (e && e.pointerId !== id)) return;
      this.arrastando = false; this.pausaGiro = 2.5;
      c.classList.remove('arrastando');
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);
    c.addEventListener('lostpointercapture', soltar);
    if (this.usaCursor) {
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        this.alvoExtra.lon = (e.clientX / innerWidth - 0.5) * 7;
        this.alvoExtra.lat = (e.clientY / innerHeight - 0.5) * -4;
      }, { passive: true });
    }
  }

  textura(url) {
    if (this.texturas.has(url)) return this.texturas.get(url);
    const p = new Promise((ok, falha) => {
      this.loader.load(url, (t) => {
        t.colorSpace = THREE.NoColorSpace;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        ok(t);
      }, undefined, (erro) => { this.texturas.delete(url); falha(erro); }); // sem cache do erro: dá para tentar de novo
    });
    this.texturas.set(url, p);
    return p;
  }

  // Mantém na memória só as texturas em uso (as de 4096 px pesam ~32 MB cada na placa de vídeo)
  limpar(manter) {
    for (const [url, p] of this.texturas) {
      if (manter.includes(url)) continue;
      p.then((t) => { if (this.u.uTex.value !== t) t.dispose(); }).catch(() => {});
      this.texturas.delete(url);
    }
  }

  async usar(url) {
    const t = await this.textura(url);
    this.u.uTex.value = t;
    return t;
  }

  // Troca de lugar: as luzes apagam por último, o novo lugar acende pelas luzes primeiro
  async mostrar(url, lon, lat) {
    const vez = ++this.trocas;
    const t = this.textura(url);
    if (this.u.uTex.value) await animar(this.v, { luz: 0 }, 0.4, 'power1.in');
    else this.v.luz = 0;
    const tex = await t;
    if (vez !== this.trocas) return false; // outro lugar foi pedido no meio do caminho
    this.u.uTex.value = tex;
    this.v.lon = lon; this.v.lat = lat; this.vel = 0;
    await animar(this.v, { luz: 1 }, 1.0, 'power2.out');
    return true;
  }

  ligar() { if (this.ligado) return; this.ligado = true; this.ultimo = performance.now(); requestAnimationFrame(this._loop); }
  desligar() { this.ligado = false; }

  _loop(agora) {
    if (!this.ligado) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (agora - this.ultimo) / 1000);
    this.ultimo = agora;
    if (document.hidden || !this.visivel || !this.u.uTex.value || !this.canvas.clientWidth) return;
    if (!this.arrastando) {
      if (Math.abs(this.vel) > 0.002) { this.v.lon += this.vel; this.vel *= 0.92; }
      if (this.pausaGiro > 0) this.pausaGiro -= dt;
      else if (this.giro) this.v.lon += this.giro * dt;
    }
    this.extra.lon += (this.alvoExtra.lon - this.extra.lon) * 0.05;
    this.extra.lat += (this.alvoExtra.lat - this.extra.lat) * 0.05;
    const lon = rad(this.v.lon + this.extra.lon);
    const lat = rad(clamp(this.v.lat + this.extra.lat, this.latMin - 4, this.latMax + 4));
    if (this.camera.fov !== this.v.fov) { this.camera.fov = this.v.fov; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat));
    this.u.uLuz.value = this.v.luz;
    this.renderer.render(this.cena, this.camera);
  }

  zoom(delta) { this.v.fov = clamp(this.v.fov + delta, 38, 84); }

  destruir() {
    this.desligar(); this.ro.disconnect();
    this.limpar([]);
    this.renderer.dispose();
  }
}
