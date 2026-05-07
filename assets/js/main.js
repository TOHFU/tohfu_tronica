document.addEventListener('DOMContentLoaded', init);

async function init() {

  const container = document.getElementById('container');

  let camera, scene, renderer;
  let uniforms, gameUniforms;
  let texture;
  let renderTarget, renderTargetSwap;
  let gameScene, gameMesh;
  // ゲーム状態バッファ／テクスチャ
  let gameStateTexture = null;
  let gameStateData = null;
  let gameStateNextData = null;
  let gameStateWidth = 0;
  let gameStateHeight = 0;

  let isPlaying = true;
  let animationId;

  // テクスチャの読み込み
  await loadTexture(`./assets/img/mainvisual_${Math.floor(Math.random()*5+1)}.jpg`);

  // カメラを作成
  camera = new THREE.Camera();
  camera.position.z = 1;

  // シーンを作成
  scene = new THREE.Scene();

  // ゲーム計算用のシーンを作成
  gameScene = new THREE.Scene();

  // レンダラーを作成
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);

  // RenderTargetを作成（ライフゲーム状態を保存）
  const rtWidth = Math.floor(texture.image.width / 8); // cellSize = 8
  const rtHeight = Math.floor(texture.image.height / 8);
  renderTarget = new THREE.WebGLRenderTarget(rtWidth, rtHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });
  renderTargetSwap = new THREE.WebGLRenderTarget(rtWidth, rtHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });

  // 板ポリゴンのメッシュをシーンに追加
  scene.add(createPlaneMesh());

  // ゲーム計算用メッシュを作成
  gameMesh = createGameMesh();
  gameScene.add(gameMesh);

  // リサイズイベント
  onWindowResize();
  window.addEventListener('resize', onWindowResize, false);

  // マウス移動イベント
  if (window.PointerEvent) {
    document.addEventListener('pointermove', onPointerMove, true);
  } else {
    document.addEventListener('touchmove', onPointerMove, true);
    document.addEventListener('mousemove', onPointerMove, true);
  }

  // マウスダウン／アップイベント（mousedown の状態をシェーダに渡す）
  function setMouseDownState(down) {
    if (uniforms && uniforms.u_mouseDown) uniforms.u_mouseDown.value = down ? 1.0 : 0.0;
    render(performance.now());
  }
  document.querySelectorAll('a').forEach(link => {
    link.addEventListener('mouseover', () => setMouseDownState(true), true);
    link.addEventListener('mouseout', () => setMouseDownState(false), true);
  });

  // 0.5秒ごとにゲーム世代を進める
  setInterval(() => {
    updateGameOfLife();
  }, 50);

  // 初期化：エッジデータをゲーム状態テクスチャに保存
  initializeGameState();

  // ボタンのイベントリスナー
  const btn = document.getElementById('playPauseBtn');
  btn.addEventListener('click', () => {
    if (isPlaying) {
      isPlaying = false;
      cancelAnimationFrame(animationId);
      btn.textContent = 'play movie >>>';
    } else {
      isPlaying = true;
      animate(performance.now());
      btn.textContent = 'pause movie |||';
    }
  });

  // アニメーション
  animate();

  // 一定時間レンダー後に停止
  setTimeout(() => {
    isPlaying = false;
    cancelAnimationFrame(animationId);
  }, 100);

  /**
   * テクスチャの読み込み
   *
   * @param {string} imagePath 画像のパス
   */
  function loadTexture(imagePath) {
    return new Promise(resolve => {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(imagePath, (tex) => {
          texture = tex;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearFilter;
          resolve();
      });
    });
  }

  /**
   * 板ポリゴンを作成
   *
   * @return {Object} メッシュオブジェクト
   */
  function createPlaneMesh() {
    // 2x2の板ポリゴンを作成
    const geometry = new THREE.PlaneBufferGeometry(2, 2);

    // uniform変数を定義
    // ここで定義した変数が、shader内で利用できます
    uniforms = {
      u_time       : { type : "f" , value : 0.0 },                        // 時間
      u_resolution : { type : "v2", value : new THREE.Vector2() },        // 画面の解像度
      u_tex        : { type : "t",  value : texture },                    // テクスチャ
      u_texsize    : { type : "v2", value : new THREE.Vector2(texture.image.width, texture.image.height)}, // テクスチャのサイズ
      u_mouse      : { type : "v2", value : new THREE.Vector2() },        // マウス座標
      u_mouseDown  : { type : "f",  value : 0.0 },                        // マウスダウンフラグ
      u_gameState  : { type : "t",  value : renderTarget.texture }        // ゲーム状態テクスチャ
    };

    // 板ポリに貼り付けるマテリアルを作成
    // shaderを利用するときは、ShaderMaterialを使う
    const material = new THREE.ShaderMaterial({
      uniforms       : uniforms,
      vertexShader   : document.getElementById('vertexShader').textContent,  // vertex shaderの指定
      fragmentShader : document.getElementById('fragmentShader').textContent // fragment shaderの指定
    });
    material.extensions.derivatives = true;

    // メッシュを作成
    return new THREE.Mesh(geometry, material);
  }

  /**
   * ゲーム計算用メッシュを作成
   *
   * @return {Object} メッシュオブジェクト
   */
  function createGameMesh() {
    const geometry = new THREE.PlaneBufferGeometry(2, 2);

    // ゲーム計算用のuniform変数
    gameUniforms = {
      u_gameState : { type : "t", value : renderTarget.texture },
      u_texsize   : { type : "v2", value : new THREE.Vector2(renderTarget.width, renderTarget.height) }
    };

    const material = new THREE.ShaderMaterial({
      uniforms       : gameUniforms,
      vertexShader   : document.getElementById('vertexShader').textContent,
      fragmentShader : document.getElementById('gameShader').textContent
    });

    return new THREE.Mesh(geometry, material);
  }

  /**
   * ゲーム状態を更新（ライフゲーム計算）
   */
  function updateGameOfLife() {
    // 永続的なバッファが初期化されているか確認
    if (!gameStateTexture || !gameStateData || !gameStateNextData) {
      console.warn('Game state buffers not initialized, skipping update');
      return;
    }

    const width = gameStateWidth;
    const height = gameStateHeight;
    const data = gameStateData;
    const next = gameStateNextData;

    // ラップ（周期）読み取り用ヘルパー
    const getData = (x, y) => {
      const nx = ((x % width) + width) % width;
      const ny = ((y % height) + height) % height;
      return data[(ny * width + nx) * 4] > 128 ? 1 : 0;
    };

    // 次世代の状態を 'next' バッファに計算する
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            neighbors += getData(x + dx, y + dy);
          }
        }

        const currentCell = getData(x, y);
        let nextState = 0;
        if (currentCell === 1) {
          if (neighbors === 2 || neighbors === 3) nextState = 1;
        } else {
          if (neighbors === 3) nextState = 1;
        }

        const idx = (y * width + x) * 4;
        next[idx] = nextState * 255;
        next[idx + 1] = 0;
        next[idx + 2] = 0;
        next[idx + 3] = 255;
      }
    }

    // 再割り当てを避けるため、currentに上書き
    gameStateData.set(next);
    gameStateTexture.needsUpdate = true;
  }

  /**
   * ゲーム状態を初期化（エッジ検出結果で初期化）
   */
  function initializeGameState() {
    
    // Canvas上でエッジ検出を実行
    const canvas = document.createElement('canvas');
    canvas.width = texture.image.width;
    canvas.height = texture.image.height;
    const ctx = canvas.getContext('2d');
    
    // 画像を描画
    ctx.drawImage(texture.image, 0, 0);
    
    // 画像データを取得
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Sobelフィルターでエッジ検出
    const width = canvas.width;
    const height = canvas.height;
    const edgeData = new Uint8Array(width * height * 4);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        // 周辺ピクセルのグレースケール値を取得
        const getGray = (dx, dy) => {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          return (data[idx] + data[idx + 1] + data[idx + 2]) / 3 / 255;
        };
        
        // Sobelフィルター
        const sobelX = 
          -getGray(-1, -1) - 2 * getGray(-1, 0) - getGray(-1, 1) +
          getGray(1, -1) + 2 * getGray(1, 0) + getGray(1, 1);
        
        const sobelY =
          -getGray(-1, -1) - 2 * getGray(0, -1) - getGray(1, -1) +
          getGray(-1, 1) + 2 * getGray(0, 1) + getGray(1, 1);
        
        const edge = Math.sqrt(sobelX * sobelX + sobelY * sobelY);
        const isEdge = edge > 0.1 ? 255 : 0;
        
        const idx = (y * width + x) * 4;
        edgeData[idx] = isEdge;
        edgeData[idx + 1] = 0;
        edgeData[idx + 2] = 0;
        edgeData[idx + 3] = 255;
      }
    }
    
    // サンプリング：cellSizeごとにダウンサンプリング
    const cellSize = 8;
    const rtWidth = Math.floor(width / cellSize);
    const rtHeight = Math.floor(height / cellSize);
    const downSampledData = new Uint8Array(rtWidth * rtHeight * 4);
    
    for (let y = 0; y < rtHeight; y++) {
      for (let x = 0; x < rtWidth; x++) {
        // セルの中心をサンプリング
        const srcX = Math.floor((x + 0.5) * cellSize);
        const srcY = Math.floor((y + 0.5) * cellSize);
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * rtWidth + x) * 4;
        
        downSampledData[dstIdx] = edgeData[srcIdx];
        downSampledData[dstIdx + 1] = 0;
        downSampledData[dstIdx + 2] = 0;
        downSampledData[dstIdx + 3] = 255;
      }
    }
    
    // テクスチャを作成
    // 各更新で再割り当てしないよう、永続的な DataTexture とバッファを作成
    gameStateWidth = rtWidth;
    gameStateHeight = rtHeight;
    gameStateData = downSampledData;
    gameStateNextData = new Uint8Array(rtWidth * rtHeight * 4);

    gameStateTexture = new THREE.DataTexture(
      gameStateData,
      rtWidth,
      rtHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    gameStateTexture.minFilter = THREE.NearestFilter;
    gameStateTexture.magFilter = THREE.NearestFilter;
    gameStateTexture.needsUpdate = true;
    
    // renderTarget と uniforms を更新
    renderTarget.texture = gameStateTexture;
    gameUniforms.u_gameState.value = gameStateTexture;
    uniforms.u_gameState.value = gameStateTexture;
  }

  /**
   * 画面のリサイズ
   *
   * @param event
   */
  function onWindowResize(event) {
    // リサイズ
    renderer.setSize( window.innerWidth, window.innerHeight );
    // uniform変数の位置情報を更新
    uniforms.u_resolution.value.x = renderer.domElement.width;
    uniforms.u_resolution.value.y = renderer.domElement.height;
    // リサイズ後に描画
    render(performance.now());
  }

  /**
   * マウスポインタ一の取得(画面左下が原点)
   *
   * @param event
   */
  function onPointerMove(event) {
    // uniform変数のマウスポインタ情報を更新
    const ratio = window.innerHeight / window.innerWidth;
    uniforms.u_mouse.value.x = (event.pageX - window.innerWidth / 2) / window.innerWidth / ratio;
    uniforms.u_mouse.value.y = (event.pageY - window.innerHeight / 2) / window.innerHeight * -1;
  }

  /**
   * アニメーション
   *
   * @param delta
   */
  function animate(delta) {
    if (isPlaying) {
      animationId = requestAnimationFrame(animate);
      render(delta);
    }
  }

  /**
   * 描画
   *
   * @param delta
   */
  function render(delta) {
    uniforms.u_time.value = delta;
    renderer.render( scene, camera );
  }

};