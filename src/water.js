import * as THREE from 'three';

export const GLSL_COMMON = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.,3.); a*=.5;} return s; }
float floorY(vec2 p, float beachX){
  float base = -3.8*(1.-smoothstep(28., beachX, p.x));
  float lump = fbm(p*0.06);
  base += 1.6*smoothstep(0.52,0.82,lump) * smoothstep(-30.,20.,p.x);
  base += 0.5*(fbm(p*0.4)-0.5);
  return base;
}
`;

const waterVert = /* glsl */ `
attribute float aThick; attribute float aFoam; attribute float aTip;
varying vec3 vWPos; varying vec3 vN; varying float vThick; varying float vFoam; varying float vTip;
void main(){
  vec4 wp = modelMatrix*vec4(position,1.);
  vWPos = wp.xyz; vN = normalize(mat3(modelMatrix)*normal);
  vThick=aThick; vFoam=aFoam; vTip=aTip;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;

const seaVert = /* glsl */ `
varying vec3 vWPos; varying vec3 vN; varying float vThick; varying float vFoam; varying float vTip;
void main(){
  vec4 wp = modelMatrix*vec4(position,1.);
  vWPos = wp.xyz; vN = vec3(0.,1.,0.); vThick=1.6; vFoam=0.; vTip=-1.;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;

const waterFrag = /* glsl */ `
uniform vec3 uCam; uniform float uTime; uniform vec2 uFlow;
uniform vec3 uSunDir, uSunCol, uSkyTop, uSkyMid, uSkyHor, uDeep, uShallow, uSSS, uFoamCol, uFog;
uniform float uFogD, uSunI, uNight, uIsSea, uBeachX, uUnder, uStars, uDebug;
varying vec3 vWPos; varying vec3 vN; varying float vThick; varying float vFoam; varying float vTip;
${GLSL_COMMON}
vec3 skyCol(vec3 d){
  float h = clamp(d.y,0.,1.);
  vec3 c = mix(uSkyHor, uSkyMid, smoothstep(0.,.25,h));
  c = mix(c, uSkyTop, smoothstep(.2,.9,h));
  float sd = max(dot(d,uSunDir),0.);
  c += uSunCol*(pow(sd,6.)*0.12 + pow(sd,200.)*2.0)*uSunI;
  return c;
}
float ripple(vec2 p){ return fbm(p) ; }
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vWPos);
  bool back = !gl_FrontFacing;
  if(back) N = -N;
  float dist = length(uCam - vWPos);
  // ondulações: ruído em xz e em (z,y) para faces verticais
  vec2 p = vWPos.xz + uFlow;
  float e = 0.12;
  float r0 = ripple(p*0.55 + vec2(uTime*0.15,0.)); 
  float rx = ripple((p+vec2(e,0.))*0.55 + vec2(uTime*0.15,0.));
  float rz = ripple((p+vec2(0.,e))*0.55 + vec2(uTime*0.15,0.));
  vec2 g = vec2(rx-r0, rz-r0)/e;
  vec2 q = vec2(vWPos.z*0.6, vWPos.y*2.2 + uTime*0.4);
  float s0 = ripple(q), s1 = ripple(q+vec2(e,0.)), s2 = ripple(q+vec2(0.,e));
  vec2 g2 = vec2(s1-s0, s2-s0)/e;
  float wallness = 1. - abs(N.y);
  float amp = 0.55 * (1. - smoothstep(25., 160., dist));
  vec3 pert = vec3(g.x, 0., g.y)*amp*(1.-wallness) + vec3(0.,g2.y,g2.x)*amp*0.35*wallness;
  N = normalize(N + pert - N*dot(N,pert));
  float fres = 0.02 + 0.98*pow(1.-clamp(dot(N,V),0.,1.),5.);
  vec3 R = reflect(-V,N);
  R.y = abs(R.y)*0.92 + 0.02;
  vec3 refl = skyCol(normalize(R));
  vec3 col;
  float alpha = 1.;
  if(back){
    // visto de baixo (submerso)
    float win = smoothstep(0.2, 0.9, 1.-length(vWPos.xz-uCam.xz)*0.0);
    vec3 sky = skyCol(normalize(vec3(0.,1.,0.)+V*0.0));
    float rays = fbm(vWPos.xz*0.3 + uTime*0.1);
    col = mix(uDeep*1.3, uShallow*1.1 + sky*0.25, 0.55+0.35*rays);
    col += uSunCol*uSunI*pow(max(dot(-V,uSunDir)*-1.,0.),4.)*0.2;
  } else {
    float thick = vThick;
    float depthMix = smoothstep(0.15, 6.0, thick);
    vec3 body = mix(uShallow*1.05, uDeep, depthMix);
    float ndl = max(dot(N,uSunDir),0.);
    float amb = 0.30 + 0.25*max(N.y,0.);
    vec3 diffuse = body*(amb*(0.55+0.45*uSunI) + 0.55*uSunI*ndl*uSunCol);
    // transmissão: luz atravessando o lábio fino
    float vs = max(dot(-V,uSunDir),0.);
    float sss = (pow(vs,2.2)*0.9 + 0.25)*exp(-thick*0.55);
    vec3 scatter = uSSS*uSunCol*sss*(0.9+1.4*uSunI)*(0.5+0.5*clamp(-N.y*0.5+0.5,0.,1.));
    // brilho sutil de face (retroiluminação suave)
    scatter += uSSS*0.18*exp(-thick*0.25)*(0.4+uSunI*0.4);
    col = diffuse + scatter;
    col = mix(col, refl, fres*0.92);
    col += uSunCol*uSunI*pow(max(dot(R,uSunDir),0.),900.)*2.4;
    col += uSunCol*uSunI*pow(max(dot(R,uSunDir),0.),60.)*0.12;
    // bioluminescência
    col += uNight*uSSS*0.9*smoothstep(0.35,0.9,vFoam+max(vTip,0.)*0.5)*0.55;
    // profundidade / rasos (mar aberto)
    if(uIsSea>0.5){
      float fy = floorY(vWPos.xz + uFlow, uBeachX);
      float depth = max(-fy, 0.);
      alpha = clamp(0.55 + 0.45*(1.-exp(-depth*0.9)), 0., 1.);
      col = mix(uShallow*1.15, col, clamp(0.55+0.45*(1.-exp(-depth*0.6)),0.,1.));
    }
    // espuma
    vec2 fp = vWPos.xz*0.9 + uFlow*0.5;
    float fn = fbm(fp*1.3 + vec2(uTime*0.12,0.))*0.65 + fbm(fp*4.1 - uTime*0.2)*0.35;
    float tipv = max(vTip, 0.);
    float foamIn = vFoam*1.25 + tipv*0.5;
    float fm = smoothstep(0.52, 0.72, foamIn + fn*0.7 - 0.28);
    // espuma de borda de rasos
    if(uIsSea>0.5){
      float fy2 = floorY(vWPos.xz + uFlow, uBeachX);
      float shore = smoothstep(0.9, 0.0, -fy2) * 0.9;
      fm = max(fm, smoothstep(0.45,0.7, shore + fn*0.5 - 0.2));
    }
    vec3 foamCol = uFoamCol*(0.50+0.55*clamp(N.y*0.5+0.55,0.,1.)*(0.35+0.65*uSunI)) + uNight*uSSS*0.25;
    col = mix(col, foamCol, fm);
    alpha = max(alpha, fm);
    if(uIsSea<0.5){
      // trecho plano (x>0): funde com o mar que fica por baixo
      float isFlat = step(vTip, -0.5);
      float far = smoothstep(6., 28., vWPos.x) * isFlat;
      alpha = mix(alpha, fm*0.92, far);
    }
  }
  float fogF = 1. - exp(-uFogD*uFogD*dist*dist);
  vec3 fogc = uFog;
  if(uUnder>0.5){ fogF = 1.-exp(-dist*0.035); fogc = uDeep*0.9+uShallow*0.25; }
  col = mix(col, fogc, fogF);
  if(uDebug>0.5 && uDebug<1.5) col = vec3(vThick/6.);
  if(uDebug>1.5 && uDebug<2.5) col = N*0.5+0.5;
  if(uDebug>2.5 && uDebug<3.5) col = vec3(vFoam, max(vTip,0.), back?1.:0.);
  if(uDebug>3.5) col = vec3(alpha);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeUniforms(env) {
  const C = (h) => new THREE.Color(h);
  return {
    uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uFlow: { value: new THREE.Vector2() },
    uSunDir: { value: new THREE.Vector3(...env.sunDir).normalize() }, uSunCol: { value: C(env.sunColor) },
    uSkyTop: { value: C(env.skyTop) }, uSkyMid: { value: C(env.skyMid) }, uSkyHor: { value: C(env.skyHor) },
    uDeep: { value: C(env.deep) }, uShallow: { value: C(env.shallow) }, uSSS: { value: C(env.sss) },
    uFoamCol: { value: C(env.foam) }, uFog: { value: C(env.fog) },
    uFogD: { value: env.fogD }, uSunI: { value: env.sunI }, uNight: { value: env.night || 0 },
    uIsSea: { value: 0 }, uBeachX: { value: env.land.beachX }, uUnder: { value: 0 }, uStars: { value: env.stars || 0 }, uDebug: { value: 0 },
  };
}

export function setEnvUniforms(u, env) {
  const C = (h) => new THREE.Color(h);
  u.uSunDir.value.set(...env.sunDir).normalize(); u.uSunCol.value.copy(C(env.sunColor));
  u.uSkyTop.value.copy(C(env.skyTop)); u.uSkyMid.value.copy(C(env.skyMid)); u.uSkyHor.value.copy(C(env.skyHor));
  u.uDeep.value.copy(C(env.deep)); u.uShallow.value.copy(C(env.shallow)); u.uSSS.value.copy(C(env.sss));
  u.uFoamCol.value.copy(C(env.foam)); u.uFog.value.copy(C(env.fog));
  u.uFogD.value = env.fogD; u.uSunI.value = env.sunI; u.uNight.value = env.night || 0;
  u.uBeachX.value = env.land.beachX; u.uStars.value = env.stars || 0;
}

export function makeWaterMaterial(uniforms, isSea) {
  const u = {};
  for (const k in uniforms) u[k] = uniforms[k];
  u.uIsSea = { value: isSea ? 1 : 0 };
  return new THREE.ShaderMaterial({
    uniforms: u, vertexShader: isSea ? seaVert : waterVert, fragmentShader: waterFrag,
    side: THREE.DoubleSide, transparent: true, depthWrite: true,
  });
}
