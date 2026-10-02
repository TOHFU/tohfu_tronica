document.addEventListener('DOMContentLoaded', init);

const ITEMS_URL = 'data/items.json';

const FALLBACK_ITEMS = [
  { text: 'note', url: 'https://note.com/tohfu_tronica' },
  { text: 'github', url: 'https://github.com/TOHFU' },
];

const FLOW_BOTTOM = -13;
const FLOW_TOP = 13;
const FLOW_X_RANGE = 12;
const FLOW_Z = 0;
const FLOW_BASE_SPEED = 1.1;

const LANE_COUNT = 14;
const ITEM_GAP = 3.2;
const ITEM_GAP_JITTER = 1.6;
const LANE_X_JITTER = 0.6;
const ITEM_Z_JITTER = 1.5; // Prevents z-fighting flicker
const SPEED_JITTER = 0.6;
const FONT_SIZE_MAX_MULTIPLIER = 8;
const FADE_IN_DURATION = 0.6;

const CAMERA_PIVOT_Z = -4; // Off-center pivot for asymmetric feel
const POINTER_FOLLOW_SECONDS = 0.3;

async function init() {

  const container = document.getElementById('container');

  let camera, scene, renderer;
  let raycaster, pointer;
  let hovered = null;
  let overLink = false;
  let lastTime = 0;
  let fadeInElapsed = 0;
  let fadingIn = false;
  let isLoading = true;
  const items = [];

  // Tight near/far reduces z-fighting; low near prevents ray line clipping
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 3, 25);
  camera.position.z = 12;

  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(3, 6, 8);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 1.2);
  fillLight.position.set(-4, -2, 6);
  scene.add(fillLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2(0, 0);
  const targetPointer = new THREE.Vector2(0, 0);

  const rayLineMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 1.0,
    depthTest: false,
    depthWrite: false
  });
  let rayLine = null;

  const randomOffset = new THREE.Vector2(0, 0);
  const targetRandomOffset = new THREE.Vector2(0, 0);
  let randomChangeTimer = 0;
  const RANDOM_CHANGE_INTERVAL = 2.0;
  const RANDOM_OFFSET_RANGE = 3.0;

  onWindowResize();
  window.addEventListener('resize', onWindowResize, false);

  if (window.PointerEvent) {
    document.addEventListener('pointermove', onPointerMove, true);
  } else {
    document.addEventListener('touchmove', onPointerMove, true);
    document.addEventListener('mousemove', onPointerMove, true);
  }
  document.addEventListener('click', onClick, true);

  loadItems();

  requestAnimationFrame(animate);

  async function loadItems() {
    try {
      await document.fonts.load('400 64px "Staatliches"');
    } catch (e) {
      console.warn('Font loading failed:', e);
    }

    const fetched = shuffle(await fetchItems().catch(() => []));
    const source = fetched.length > 0 ? fetched : FALLBACK_ITEMS;

    const laneSlotCount = Math.ceil(source.length / LANE_COUNT);
    const laneLoopLength = Math.max(laneSlotCount, 1) * ITEM_GAP;

    // Show pulse animation for minimum duration
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Yield to main thread periodically to prevent animation freeze
    for (let index = 0; index < source.length; index++) {
      const data = source[index];
      const lane = index % LANE_COUNT;
      const laneSlot = Math.floor(index / LANE_COUNT);
      addTextItem(data, lane, laneSlot, laneLoopLength);

      if (index % 5 === 4) {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }

    fadingIn = true;
    isLoading = false;

    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('loading--hidden');
      loading.addEventListener('transitionend', () => loading.remove(), { once: true });
    }
  }

  async function fetchItems() {
    const res = await fetch(ITEMS_URL);
    if (!res.ok) throw new Error(`items fetch failed: ${res.status}`);
    return res.json();
  }

  function addTextItem(data, lane, laneSlot, laneLoopLength) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sizeMultiplier = 1 + Math.random() * (FONT_SIZE_MAX_MULTIPLIER - 1);
    const fontSize = Math.round(64 * sizeMultiplier);
    const font = `400 ${fontSize}px "Staatliches", sans-serif`;
    ctx.font = font;

    let displayText = data.textEn || data.text;

    // Truncate to max width to avoid WebGL texture resize warnings
    const MAX_CANVAS_WIDTH = 4096;
    let textWidth = ctx.measureText(displayText).width;
    const maxTextWidth = MAX_CANVAS_WIDTH - fontSize * 2;

    if (textWidth > maxTextWidth) {
      let truncated = displayText;
      const ellipsis = '...';
      const ellipsisWidth = ctx.measureText(ellipsis).width;

      while (textWidth + ellipsisWidth > maxTextWidth && truncated.length > 1) {
        truncated = truncated.slice(0, -1);
        textWidth = ctx.measureText(truncated).width;
      }

      displayText = truncated + ellipsis;
      textWidth = ctx.measureText(displayText).width;
    }

    canvas.width = Math.ceil(textWidth + fontSize * 2);
    canvas.height = fontSize * 2;

    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // Baked 3D bevel on 2D canvas instead of layered 3D meshes (avoids z-fighting)
    const bevelSteps = 8;
    const bevelOffset = fontSize * 0.015;
    for (let i = bevelSteps; i >= 1; i--) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeText(
        displayText,
        canvas.width / 2 + i * bevelOffset * 0.5,
        canvas.height / 2 + i * bevelOffset
      );
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeText(displayText, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(displayText, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const aspect = canvas.width / canvas.height;
    const planeHeight = 1.1 * sizeMultiplier;
    const geometry = new THREE.PlaneBufferGeometry(planeHeight * aspect, planeHeight);

    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.85,
      metalness: 0.05,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 1.0,
    });
    const layer = new THREE.Mesh(geometry, material);
    group.add(layer);

    const laneX = LANE_COUNT > 1
      ? (lane / (LANE_COUNT - 1) - 0.5) * FLOW_X_RANGE * 2 + (Math.random() - 0.5) * LANE_X_JITTER
      : 0;
    const speed = FLOW_BASE_SPEED * (1 + (Math.random() - 0.5) * SPEED_JITTER);
    const startY = FLOW_BOTTOM + Math.random() * (FLOW_TOP - FLOW_BOTTOM);

    const itemZ = FLOW_Z + (Math.random() - 0.5) * ITEM_Z_JITTER;

    group.userData = { url: data.url, text: data.text, laneLoopLength, speed, material, canvas };
    group.position.set(laneX, startY, itemZ);
    group.rotation.set(0, 0, 0);

    scene.add(group);
    items.push(group);
  }

  function shuffle(array) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function onPointerMove(event) {
    overLink = !!(event.target.closest && event.target.closest('a'));
    targetPointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    targetPointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  function onClick(event) {
    if (event.target.closest && event.target.closest('a')) return;
    if (hovered) {
      window.open(hovered.userData.url, '_blank', 'noopener,noreferrer');
    }
  }

  function updateHover(time) {
    raycaster.setFromCamera(pointer, camera);

    const rayStart = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(6));
    const rayEnd = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(12));

    if (rayLine) {
      scene.remove(rayLine);
    }

    const direction = new THREE.Vector3().subVectors(rayEnd, rayStart);
    const length = direction.length();
    const center = new THREE.Vector3().addVectors(rayStart, rayEnd).multiplyScalar(0.5);

    const geometry = new THREE.CylinderGeometry(0.05, 0.05, length, 32);
    rayLine = new THREE.Mesh(geometry, rayLineMaterial);

    rayLine.position.copy(center);
    rayLine.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize()
    );

    // Stronger pulse during loading, subtle pulse after
    const maxScale = isLoading ? 3.0 : 1.5;
    const pulseScale = 1.0 + (maxScale - 1.0) * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 / 1.2));
    rayLine.scale.set(pulseScale, 1, pulseScale);

    if (Math.random() < 0.01) {
      console.log('Loading:', isLoading, 'Scale:', pulseScale.toFixed(2), 'Time:', time.toFixed(2));
    }

    rayLine.renderOrder = 999;
    scene.add(rayLine);

    const intersections = raycaster.intersectObjects(items, true);

    let next = null;
    if (!overLink && intersections.length > 0) {
      // Pixel-perfect hit detection via alpha threshold
      for (let i = 0; i < intersections.length; i++) {
        const intersection = intersections[i];
        const group = intersection.object.parent;

        if (group.userData.canvas && intersection.uv) {
          const canvas = group.userData.canvas;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          const x = Math.floor(intersection.uv.x * canvas.width);
          const y = Math.floor((1 - intersection.uv.y) * canvas.height);

          const imageData = ctx.getImageData(x, y, 1, 1);
          const alpha = imageData.data[3];

          if (alpha > 127) {
            next = group;
            break;
          }
        }
      }
    }

    if (next !== hovered) {
      if (hovered) {
        hovered.scale.set(1, 1, 1);
      }
      hovered = next;
      if (hovered) {
        hovered.scale.set(1.15, 1.15, 1.15);
      }
      container.style.cursor = hovered ? 'pointer' : 'crosshair';
    }
  }

  function updateFlow(delta) {
    items.forEach((group) => {
      group.position.y += group.userData.speed * delta;

      if (group.position.y > FLOW_TOP) {
        group.position.y -= group.userData.laneLoopLength;
      }
    });
  }

  function updateFadeIn(delta) {
    if (!fadingIn) return;

    fadeInElapsed = Math.min(fadeInElapsed + delta, FADE_IN_DURATION);
    const opacity = fadeInElapsed / FADE_IN_DURATION;

    items.forEach((group) => {
      group.userData.material.opacity = opacity;
    });

    if (fadeInElapsed >= FADE_IN_DURATION) {
      fadingIn = false;
    }
  }

  function animate(now) {
    requestAnimationFrame(animate);

    const time = now * 0.001;
    const delta = lastTime ? Math.min(time - lastTime, 0.1) : 0;
    lastTime = time;

    randomChangeTimer += delta;
    if (randomChangeTimer >= RANDOM_CHANGE_INTERVAL) {
      randomChangeTimer = 0;
      targetRandomOffset.set(
        (Math.random() - 0.5) * RANDOM_OFFSET_RANGE * 2,
        (Math.random() - 0.5) * RANDOM_OFFSET_RANGE * 2
      );
    }

    // Frame-rate independent exponential smoothing
    randomOffset.lerp(targetRandomOffset, 1 - Math.exp(-delta / POINTER_FOLLOW_SECONDS));
    pointer.lerp(targetPointer, 1 - Math.exp(-delta / POINTER_FOLLOW_SECONDS));

    camera.position.x = pointer.x * 3 + randomOffset.x;
    camera.position.y = pointer.y * 3 + randomOffset.y;
    camera.lookAt(0, 0, CAMERA_PIVOT_Z);

    updateFlow(delta);
    updateFadeIn(delta);
    updateHover(time);

    renderer.render(scene, camera);
  }

};
