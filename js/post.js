import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The stock bloom blends its result back into the multisampled scene buffer: one more full-screen draw
// into a 4x HDR target and a second resolve. This one stops after the composite; the output pass adds it.
export class BloomPass extends UnrealBloomPass {
  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    const draw = (material, target) => {
      this.fsQuad.material = material;
      renderer.setRenderTarget(target);
      renderer.clear();
      this.fsQuad.render(renderer);
    };

    this.highPassUniforms.tDiffuse.value = readBuffer.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    draw(this.materialHighPassFilter, this.renderTargetBright);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      draw(blur, this.renderTargetsHorizontal[i]);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      draw(blur, this.renderTargetsVertical[i]);
      input = this.renderTargetsVertical[i];
    }

    const c = this.compositeMaterial.uniforms;
    c.bloomStrength.value = this.strength;
    c.bloomRadius.value = this.radius;
    c.bloomTintColors.value = this.bloomTintColors;
    draw(this.compositeMaterial, this.renderTargetsHorizontal[0]);

    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }

  get texture() {
    return this.renderTargetsHorizontal[0].texture;
  }
}

// Tone mapping and sRGB, plus the bloom added like the stock additive blend did it (rgb * alpha).
export function makeOutputPass(bloom) {
  const pass = new OutputPass();
  pass.uniforms.tBloom = { value: bloom.texture };
  pass.uniforms.uBloom = { value: 1 };
  pass.material.fragmentShader = pass.material.fragmentShader
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tBloom;\nuniform float uBloom;')
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `gl_FragColor = texture2D( tDiffuse, vUv );
      vec4 bloom = texture2D( tBloom, vUv );
      gl_FragColor.rgb += bloom.rgb * bloom.a * uBloom;`);
  return pass;
}
