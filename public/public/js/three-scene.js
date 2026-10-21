/**
 * NEXADOWN 3D - High-Performance Mobile-Optimized Holographic Three.js Background
 * Automatically scales down for mobile devices to maintain 60-120 FPS with zero lag.
 */

(function () {
  const container = document.getElementById('three-canvas-container');
  if (!container || typeof THREE === 'undefined') return;

  const isMobile = window.innerWidth <= 850 || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  // Scene, Camera, Renderer
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 36);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: !isMobile, // Disable antialiasing on mobile for massive GPU boost
    powerPreference: isMobile ? 'low-power' : 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, isMobile ? 0.8 : 0.55);
  scene.add(ambientLight);

  const pointLight1 = new THREE.PointLight(0x00f2fe, isMobile ? 2.0 : 3.5, 90);
  pointLight1.position.set(22, 18, 18);
  scene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0xfe0979, isMobile ? 2.0 : 3.5, 90);
  pointLight2.position.set(-22, -18, 14);
  scene.add(pointLight2);

  // Group for floating 3D objects
  const objectsGroup = new THREE.Group();
  scene.add(objectsGroup);

  // Helper: Create soft radial circle sprite texture
  function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(0, 242, 254, 0.8)');
    gradient.addColorStop(0.7, 'rgba(121, 40, 202, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  const glowTexture = createGlowTexture();

  // 1. Central Holographic Gyroscope
  const gyroGroup = new THREE.Group();
  gyroGroup.position.set(isMobile ? 0 : 16, isMobile ? 12 : 4, isMobile ? -14 : -8);
  objectsGroup.add(gyroGroup);

  // Outer Ring
  const ringGeo1 = new THREE.TorusGeometry(isMobile ? 4.5 : 6.2, 0.08, 8, isMobile ? 40 : 80);
  const ringMat1 = new THREE.MeshBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.5 });
  const ring1 = new THREE.Mesh(ringGeo1, ringMat1);
  gyroGroup.add(ring1);

  // Middle Ring
  const ringGeo2 = new THREE.TorusGeometry(isMobile ? 3.5 : 4.8, 0.07, 8, isMobile ? 32 : 60);
  const ringMat2 = new THREE.MeshBasicMaterial({ color: 0xfe0979, transparent: true, opacity: 0.45 });
  const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
  ring2.rotation.x = Math.PI / 3;
  gyroGroup.add(ring2);

  // Central Octahedron Core
  const coreGeo = new THREE.OctahedronGeometry(isMobile ? 1.4 : 2.0, 0);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, wireframe: true, transparent: true, opacity: 0.6 });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  gyroGroup.add(coreMesh);

  // 2. Floating Crystals (Only 2 on mobile, 6 on desktop)
  const floatingCrystals = [];
  const crystalCount = isMobile ? 2 : 6;
  for (let i = 0; i < crystalCount; i++) {
    const geo = new THREE.OctahedronGeometry(1.6, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0x00f2fe : 0xfe0979,
      wireframe: true,
      transparent: true,
      opacity: 0.25
    });
    const crystal = new THREE.Mesh(geo, mat);
    crystal.position.set(
      (Math.random() - 0.5) * 45,
      (Math.random() - 0.5) * 30,
      (Math.random() - 0.5) * 15 - 5
    );
    crystal.rotationSpeed = {
      x: (Math.random() - 0.5) * 0.012,
      y: (Math.random() - 0.5) * 0.012
    };
    crystal.baseY = crystal.position.y;
    crystal.floatSpeed = 0.8 + Math.random() * 0.8;
    crystal.floatOffset = Math.random() * Math.PI * 2;
    objectsGroup.add(crystal);
    floatingCrystals.push(crystal);
  }

  // 3. Stardust Nebula (Only 80 particles on mobile, 500 on desktop)
  const particleCount = isMobile ? 80 : 500;
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);

  const themeColors = [
    new THREE.Color(0x00f2fe),
    new THREE.Color(0xfe0979),
    new THREE.Color(0x7928ca)
  ];

  for (let i = 0; i < particleCount; i++) {
    const i3 = i * 3;
    const radius = 10 + Math.random() * 45;
    const theta = Math.random() * Math.PI * 2;
    const phi = (Math.random() - 0.5) * Math.PI * 0.9;

    particlePositions[i3] = radius * Math.cos(theta) * Math.cos(phi);
    particlePositions[i3 + 1] = radius * Math.sin(phi) * 0.75;
    particlePositions[i3 + 2] = radius * Math.sin(theta) * Math.cos(phi) - 8;

    const col = themeColors[Math.floor(Math.random() * themeColors.length)];
    particleColors[i3] = col.r;
    particleColors[i3 + 1] = col.g;
    particleColors[i3 + 2] = col.b;
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const particleMaterial = new THREE.PointsMaterial({
    size: isMobile ? 2.5 : 1.8,
    map: glowTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particleSystem);

  // Parallax Tracking
  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;
  let scrollY = 0;
  let isScrolling = false;
  let scrollTimer = null;

  if (!isMobile) {
    window.addEventListener('mousemove', (e) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = -(e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  window.addEventListener('scroll', () => {
    scrollY = window.scrollY || window.pageYOffset || 0;
    if (isMobile) {
      isScrolling = true;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => { isScrolling = false; }, 120);
    }
  }, { passive: true });

  // Dynamic Theme Palette Adapter
  window.update3DTheme = function (themeName) {
    if (themeName === 'aurora') {
      pointLight1.color.setHex(0x00ffd5);
      pointLight2.color.setHex(0x7928ca);
      ringMat1.color.setHex(0x00ffd5);
      ringMat2.color.setHex(0x7928ca);
      coreMat.color.setHex(0x00ffd5);
    } else if (themeName === 'synthwave') {
      pointLight1.color.setHex(0xff758c);
      pointLight2.color.setHex(0x6a11cb);
      ringMat1.color.setHex(0xff758c);
      ringMat2.color.setHex(0xff7eb3);
      coreMat.color.setHex(0xff758c);
    } else if (themeName === 'matrix') {
      pointLight1.color.setHex(0x00ff88);
      pointLight2.color.setHex(0x00b4d8);
      ringMat1.color.setHex(0x00ff88);
      ringMat2.color.setHex(0x00b4d8);
      coreMat.color.setHex(0x00ff88);
    } else {
      pointLight1.color.setHex(0x00f2fe);
      pointLight2.color.setHex(0xfe0979);
      ringMat1.color.setHex(0x00f2fe);
      ringMat2.color.setHex(0xfe0979);
      coreMat.color.setHex(0x00f2fe);
    }
  };

  // Resize Handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  }, { passive: true });

  // Animation Loop with Visibility & Mobile Scroll Throttling
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    // Skip frame rendering if user is scrolling on mobile or tab is hidden
    if (document.hidden || (isMobile && isScrolling)) {
      return;
    }

    const time = clock.getElapsedTime();

    if (!isMobile) {
      targetX += (mouseX * 3.5 - targetX) * 0.05;
      targetY += (mouseY * 3.5 - targetY) * 0.05;
      camera.position.x = targetX;
      camera.position.y = targetY - (scrollY * 0.012);
      camera.lookAt(0, -scrollY * 0.008, 0);
    }

    // Rotate Gyroscope Rings
    ring1.rotation.z = time * 0.22;
    ring2.rotation.x = time * 0.28;
    coreMesh.rotation.y = time * 0.45;

    // Floating Crystals
    floatingCrystals.forEach((c) => {
      c.rotation.x += c.rotationSpeed.x;
      c.rotation.y += c.rotationSpeed.y;
      c.position.y = c.baseY + Math.sin(time * c.floatSpeed + c.floatOffset) * 1.2;
    });

    // Particle field rotation
    particleSystem.rotation.y = time * 0.02;

    renderer.render(scene, camera);
  }

  animate();
})();
