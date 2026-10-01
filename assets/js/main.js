document.addEventListener('DOMContentLoaded', init);

const ITEMS_URL = 'data/items.json';

const FALLBACK_ITEMS = [
  { text: 'note', url: 'https://note.com/tohfu_tronica' },
  { text: 'github', url: 'https://github.com/TOHFU' },
];

// テキストが流れる範囲（下から上へループ）
const FLOW_BOTTOM = -13;
const FLOW_TOP = 13;
const FLOW_X_RANGE = 12;
const FLOW_Z = 0;
const FLOW_BASE_SPEED = 1.1;

// テキストを整列させる縦レーンの数と、レーン内での縦の間隔
const LANE_COUNT = 14;
const ITEM_GAP = 3.2;
const ITEM_GAP_JITTER = 1.6; // レーン内の間隔にランダムな揺らぎを持たせる
const LANE_X_JITTER = 0.6; // レーン内でのX位置のランダムなブレ
const ITEM_Z_JITTER = 1.5; // アイテム同士が同じZ座標で重なりちらつくのを防ぐランダムなZブレ
const SPEED_JITTER = 0.6; // 速度のランダムな個体差（0〜1の割合）
const FONT_SIZE_MAX_MULTIPLIER = 8; // フォントサイズの最大倍率（1倍〜この倍率でランダム）
const FADE_IN_DURATION = 0.6; // ローディング完了後、テキストがフェードインする秒数

// マウス追従のカメラ挙動
const CAMERA_PIVOT_Z = -4; // 注視点（回転の中心）をZ方向の奥へずらし、中心がずれているように感じさせる
const POINTER_FOLLOW_SECONDS = 0.3; // マウスの動きに追いつくまでの時間定数（秒）

async function init() {

  const container = document.getElementById('container');

  let camera, scene, renderer;
  let raycaster, pointer;
  let hovered = null;
  let overLink = false;
  let lastTime = 0;
  let fadeInElapsed = 0;
  let fadingIn = false;
  const items = [];

  // near/farをテキストが実際に存在する距離帯に絞り、深度バッファの精度を上げて
  // 重なったポリゴン同士のちらつき（深度精度不足によるz-fighting）を抑える
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 5, 25);
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

  /**
   * データ取得（githubリポジトリ + note記事）、失敗してもフェイルソフト
   */
  async function loadItems() {
    const fetched = shuffle(await fetchItems().catch(() => []));
    const source = fetched.length > 0 ? fetched : FALLBACK_ITEMS;

    const laneSlotCount = Math.ceil(source.length / LANE_COUNT);
    const laneLoopLength = Math.max(laneSlotCount, 1) * ITEM_GAP;

    source.forEach((data, index) => {
      const lane = index % LANE_COUNT;
      const laneSlot = Math.floor(index / LANE_COUNT);
      addTextItem(data, lane, laneSlot, laneLoopLength);
    });

    fadingIn = true;

    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('loading--hidden');
      loading.addEventListener('transitionend', () => loading.remove(), { once: true });
    }
  }

  /**
   * 事前生成された静的JSON（GitHub Actionsで定期更新）を取得
   */
  async function fetchItems() {
    const res = await fetch(ITEMS_URL);
    if (!res.ok) throw new Error(`items fetch failed: ${res.status}`);
    return res.json();
  }

  /**
   * テキストをCanvasにラスタライズしてテクスチャ化し、
   * 奥行き方向に薄いレイヤーを重ねて3Dの厚み（マットな質感）を持つグループを追加。
   * 各テキストは固定のレーン（x）に整列させつつ、間隔・位置・速度に個別の揺らぎを持たせ、
   * 不定期でまばらに上へ流れるようにする（向きは揃えて回転させない）。
   */
  function addTextItem(data, lane, laneSlot, laneLoopLength) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const sizeMultiplier = 1 + Math.random() * (FONT_SIZE_MAX_MULTIPLIER - 1);
    const fontSize = Math.round(64 * sizeMultiplier);
    const font = `900 ${fontSize}px "Noto Sans JP", sans-serif`;
    ctx.font = font;
    const textWidth = ctx.measureText(data.text).width;

    canvas.width = Math.ceil(textWidth + fontSize * 2);
    canvas.height = fontSize * 2;

    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // 3D空間での複数レイヤー重ねはZファイティングによるちらつきの原因になるため、
    // 厚み（マットな立体感）は2Dキャンバス上にオフセットした影のストロークを
    // 焼き込むことで表現する（3Dメッシュは1枚のみ）。
    const bevelSteps = 5;
    const bevelOffset = fontSize * 0.02;
    for (let i = bevelSteps; i >= 1; i--) {
      const shade = Math.round(255 * (1 - (i / bevelSteps) * 0.35));
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillText(
        data.text,
        canvas.width / 2 + i * bevelOffset * 0.4,
        canvas.height / 2 + i * bevelOffset
      );
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = fontSize * 0.08;
    ctx.strokeText(data.text, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(data.text, canvas.width / 2, canvas.height / 2);

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
    });
    const layer = new THREE.Mesh(geometry, material);
    group.add(layer);

    const laneX = LANE_COUNT > 1
      ? (lane / (LANE_COUNT - 1) - 0.5) * FLOW_X_RANGE * 2 + (Math.random() - 0.5) * LANE_X_JITTER
      : 0;
    const gapJitter = (Math.random() - 0.5) * ITEM_GAP_JITTER;
    const baseY = FLOW_BOTTOM - laneSlot * ITEM_GAP + gapJitter;
    const speed = FLOW_BASE_SPEED * (1 + (Math.random() - 0.5) * SPEED_JITTER);
    // 初回表示時に下から順に出現するのを避けるため、Y軸のどこかにランダムに開始位置をずらす
    let startY = baseY + Math.random() * laneLoopLength;
    while (startY > FLOW_TOP) startY -= laneLoopLength;

    const itemZ = FLOW_Z + (Math.random() - 0.5) * ITEM_Z_JITTER;

    group.userData = { url: data.url, text: data.text, laneLoopLength, speed, material };
    group.position.set(laneX, startY, itemZ);
    group.rotation.set(0, 0, 0);

    scene.add(group);
    items.push(group);
  }

  /**
   * Fisher-Yatesシャッフル
   */
  function shuffle(array) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * 画面のリサイズ
   */
  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * マウス／タッチ座標を正規化デバイス座標(-1〜1)で保持
   */
  function onPointerMove(event) {
    overLink = !!(event.target.closest && event.target.closest('a'));
    targetPointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    targetPointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  /**
   * テキストをクリックしたら対応するページへ遷移
   */
  function onClick(event) {
    if (event.target.closest && event.target.closest('a')) return;
    if (hovered) {
      window.open(hovered.userData.url, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * ホバー中のテキストを判定してカーソル・見た目を更新
   */
  function updateHover() {
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(items, true);
    const next = !overLink && intersections.length > 0 ? intersections[0].object.parent : null;

    if (next !== hovered) {
      if (hovered) {
        hovered.scale.set(1, 1, 1);
        hovered.userData.material.color.set(0xffffff);
      }
      hovered = next;
      if (hovered) {
        hovered.scale.set(1.15, 1.15, 1.15);
        hovered.userData.material.color.set(0x333333);
      }
      container.style.cursor = hovered ? 'pointer' : 'crosshair';
    }
  }

  /**
   * テキストを同一方向へ下から上へ流す。向きは揃えたまま（回転させない）。
   * 各テキストは自分のレーン（x）と個別の速度・間隔の揺らぎを保ち、
   * 画面上を抜けたら自分のレーン内でループするので、不定期でまばらな流れに見える。
   */
  function updateFlow(delta) {
    items.forEach((group) => {
      group.position.y += group.userData.speed * delta;

      if (group.position.y > FLOW_TOP) {
        group.position.y -= group.userData.laneLoopLength;
      }
    });
  }

  /**
   * ローディング完了直後、テキストを一気に表示せずフェードインさせる
   */
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

  /**
   * 描画・アニメーション
   */
  function animate(now) {
    requestAnimationFrame(animate);

    const time = now * 0.001;
    const delta = lastTime ? Math.min(time - lastTime, 0.1) : 0;
    lastTime = time;

    // フレームレートに依存しない指数平滑化。約0.3秒かけて滑らかに追従する
    pointer.lerp(targetPointer, 1 - Math.exp(-delta / POINTER_FOLLOW_SECONDS));

    camera.position.x = pointer.x * 3;
    camera.position.y = pointer.y * 3;
    camera.lookAt(0, 0, CAMERA_PIVOT_Z);

    updateFlow(delta);
    updateFadeIn(delta);
    updateHover();

    renderer.render(scene, camera);
  }

};
