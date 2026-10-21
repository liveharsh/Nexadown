/**
 * NEXADOWN 3D - Main Application Logic
 * Integrates URL analysis, format rendering, live SSE download streaming,
 * local drag-and-drop media conversion, 3D card physics, and navigation.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Warning if opened via file:// protocol
  if (window.location.protocol === 'file:') {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff0055;color:#fff;text-align:center;padding:12px;z-index:999999;font-weight:bold;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
    banner.innerHTML = '⚠️ Note: File mode detected! Please run through server at <strong>http://localhost:3000</strong> or your Render link so downloads work.';
    document.body.prepend(banner);
  }

  // DOM Elements
  const urlInput = document.getElementById('urlInput');
  const btnAnalyze = document.getElementById('btnAnalyze');
  const btnPaste = document.getElementById('btnPaste');
  const btnClear = document.getElementById('btnClear');
  const resultsSection = document.getElementById('resultsSection');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const mobileToggleBtn = document.getElementById('mobileToggleBtn');
  const navLinks = document.getElementById('navLinks');

  // Modal Elements
  const progressModal = document.getElementById('progressModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalTitle = document.getElementById('modalTitle');
  const modalQualityText = document.getElementById('modalQualityText');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressStatusText = document.getElementById('progressStatusText');
  const progressNumber = document.getElementById('progressNumber');
  const modalSpeed = document.getElementById('modalSpeed');
  const modalSize = document.getElementById('modalSize');
  const modalEta = document.getElementById('modalEta');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const modalActions = document.getElementById('modalActions');
  const btnSaveReadyFile = document.getElementById('btnSaveReadyFile');
  const modalCoverWrapper = document.getElementById('modalCoverWrapper');
  const modalCoverImg = document.getElementById('modalCoverImg');
  const modalDefaultIcon = document.getElementById('modalDefaultIcon');

  // Inline Clean Error Banner in Results Card
  function showInlineError(message) {
    clearInlineError();
    const card = document.querySelector('.results-card');
    if (!card) return;

    const alertBox = document.createElement('div');
    alertBox.id = 'activeInlineError';
    alertBox.className = 'inline-error-banner';
    alertBox.innerHTML = `
      <div style="font-size:1.3rem;line-height:1;margin-top:2px;">⚠️</div>
      <div style="flex:1;">
        <strong style="color:#fff;display:block;margin-bottom:3px;font-size:0.92rem;">Download Notice</strong>
        <span style="line-height:1.4;display:block;">${escapeHtml(message)}</span>
      </div>
      <button type="button" class="inline-error-close" title="Dismiss" onclick="this.parentElement.remove()">✕</button>
    `;
    card.prepend(alertBox);
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearInlineError() {
    const existing = document.getElementById('activeInlineError');
    if (existing) existing.remove();
  }

  // Native Browser Download Trigger (No modal popup, streams directly into browser Downloads tray)
  function triggerNativeBrowserDownload(fileUrl, filename) {
    try {
      const dlLink = document.createElement('a');
      dlLink.href = fileUrl;
      dlLink.setAttribute('download', filename);
      dlLink.style.display = 'none';
      document.body.appendChild(dlLink);
      dlLink.click();
      setTimeout(() => {
        try { dlLink.remove(); } catch (_) {}
      }, 1000);
    } catch (_) {
      window.location.assign(fileUrl);
    }
  }

  // Custom Cyberpunk Cursor
  const cursorDot = document.getElementById('cursor-dot');
  const cursorRing = document.getElementById('cursor-ring');

  if (cursorDot && cursorRing && window.matchMedia('(pointer: fine)').matches) {
    let mouseX = -100;
    let mouseY = -100;
    let ringX = -100;
    let ringY = -100;
    let isMoving = false;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!isMoving) {
        ringX = mouseX;
        ringY = mouseY;
        isMoving = true;
      }
      cursorDot.style.left = `${mouseX}px`;
      cursorDot.style.top = `${mouseY}px`;
    });

    function renderCursor() {
      if (isMoving) {
        ringX += (mouseX - ringX) * 0.18;
        ringY += (mouseY - ringY) * 0.18;
        cursorRing.style.left = `${ringX}px`;
        cursorRing.style.top = `${ringY}px`;
      }
      requestAnimationFrame(renderCursor);
    }
    requestAnimationFrame(renderCursor);

    const hoverElements = 'button, a, input, select, .card-3d, .format-card-item, .platform-pill, .tab-btn, .btn-paste, .btn-analyze';
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest(hoverElements)) {
        document.body.classList.add('cursor-hover');
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (e.target.closest(hoverElements)) {
        document.body.classList.remove('cursor-hover');
      }
    });
  }

  // State
  let currentMetadata = null;
  let activeEventSource = null;
  let activeJobId = null;
  const themes = ['neon', 'aurora', 'synthwave', 'matrix'];
  let currentThemeIdx = 0;

  // Initialize Theme
  const savedTheme = localStorage.getItem('nexadown_theme') || 'neon';
  currentThemeIdx = Math.max(0, themes.indexOf(savedTheme));
  applyTheme(themes[currentThemeIdx]);

  function applyTheme(themeName) {
    document.body.setAttribute('data-theme', themeName);
    localStorage.setItem('nexadown_theme', themeName);
    if (window.update3DTheme) {
      window.update3DTheme(themeName);
    }
  }

  themeToggleBtn.addEventListener('click', () => {
    currentThemeIdx = (currentThemeIdx + 1) % themes.length;
    applyTheme(themes[currentThemeIdx]);
    if (window.soundFx) window.soundFx.playClick();
  });

  // Sound FX Toggle
  function updateSoundIcon() {
    const isMuted = localStorage.getItem('nexadown_muted') === 'true';
    soundToggleBtn.innerHTML = isMuted ? '🔇' : '🔊';
  }
  updateSoundIcon();

  soundToggleBtn.addEventListener('click', () => {
    if (window.soundFx) {
      const muted = window.soundFx.toggleMute();
      updateSoundIcon();
      if (!muted) window.soundFx.playClick();
    }
  });

  // Mobile Menu Toggle
  if (mobileToggleBtn && navLinks) {
    mobileToggleBtn.addEventListener('click', () => {
      navLinks.classList.toggle('mobile-open');
    });
  }

  // 3D Card Tilt Physics
  // Interactive 3D tilt physics for desktop cards only (disabled on mobile for 60fps performance)
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.innerWidth <= 850;
  if (!isTouchDevice) {
    document.querySelectorAll('.card-3d').forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -10;
        const rotateY = ((x - centerX) / centerX) * 10;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)';
      });
    });
  }

  // Paste from Clipboard with Automatic Search Trigger
  btnPaste.addEventListener('click', async () => {
    if (window.soundFx) window.soundFx.playClick();
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        urlInput.value = text.trim();
        urlInput.focus();
        showToast('Link pasted! Scanning now...', '⚡');
        analyzeCurrentUrl();
      }
    } catch (err) {
      alert('Clipboard access denied. Please paste manually using Ctrl+V.');
    }
  });

  // Automatic Search on native input paste event (Ctrl+V / right click paste)
  urlInput.addEventListener('paste', () => {
    setTimeout(() => {
      if (urlInput.value.trim()) {
        showToast('Link pasted! Scanning now...', '⚡');
        analyzeCurrentUrl();
      }
    }, 120);
  });

  // Clear Input
  btnClear.addEventListener('click', () => {
    if (window.soundFx) window.soundFx.playClick();
    urlInput.value = '';
    urlInput.focus();
  });

  // Quick Platform Pill Click (pre-fill URL template)
  document.querySelectorAll('.platform-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      if (window.soundFx) window.soundFx.playClick();
      const platform = pill.getAttribute('data-platform');
      urlInput.placeholder = `Paste your ${platform} link here...`;
      urlInput.focus();
    });
  });

  // Enter Key Triggers Analyze
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      analyzeCurrentUrl();
    }
  });

  btnAnalyze.addEventListener('click', () => {
    analyzeCurrentUrl();
  });

  /**
   * Analyze media URL via backend API
   */
  async function analyzeCurrentUrl() {
    const rawUrl = urlInput.value.trim();
    if (window.location.protocol === 'file:') {
      alert('⚠️ Analysis Error: Website is opened as a direct file (file://).\n\nPlease open through the running server:\n👉 http://localhost:3000\nor live on Render:\n👉 https://nexadown.onrender.com');
      return;
    }
    if (!rawUrl) {
      alert('Please enter or paste a valid media URL.');
      urlInput.focus();
      return;
    }

    if (window.soundFx) window.soundFx.playAnalyze();

    // UI Loading state
    btnAnalyze.disabled = true;
    btnAnalyze.innerHTML = `
      <svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" />
      </svg>
      Scanning Link...
    `;

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to extract media information.');
      }

      currentMetadata = data.data;
      currentMetadata.platform = data.platform;

      renderResults(currentMetadata);

      if (window.soundFx) window.soundFx.playSuccess();

      // Smooth scroll to results
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (window.soundFx) window.soundFx.playError();
      alert(`⚠️ Analysis Error: ${err.message}`);
    } finally {
      btnAnalyze.disabled = false;
      btnAnalyze.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        Analyze Link
      `;
    }
  }

  /**
   * Render dynamic results panel
   */
  function renderResults(meta) {
    resultsSection.style.display = 'block';

    // Thumbnail & Duration
    const thumbImg = document.getElementById('mediaThumbnail');
    thumbImg.src = meta.thumbnail || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600';
    document.getElementById('mediaDuration').textContent = meta.durationFormatted || 'Live';

    // Platform Tag
    const platformTag = document.getElementById('mediaPlatformTag');
    const platformName = meta.platform ? meta.platform.name : (meta.extractor || 'Spotify');
    const platformColor = meta.platform ? meta.platform.color : '#1db954';
    platformTag.textContent = platformName;
    platformTag.style.background = `${platformColor}25`;
    platformTag.style.color = platformColor;
    platformTag.style.border = `1px solid ${platformColor}50`;

    // Title & Uploader
    document.getElementById('mediaTitle').textContent = meta.title;
    document.getElementById('mediaUploader').textContent = meta.uploader;
    document.getElementById('mediaViews').textContent = meta.viewCount ? `${meta.viewCount}` : 'Verified Source';

    const tabsNav = document.querySelector('.tabs-nav');
    const playlistContainer = document.getElementById('playlistContainer');

    if (meta.isPlaylist) {
      if (tabsNav) tabsNav.style.display = 'none';
      document.getElementById('videoFormatsList').style.display = 'none';
      document.getElementById('audioFormatsList').style.display = 'none';
      document.getElementById('thumbnailFormatList').style.display = 'none';
      const subList = document.getElementById('subtitlesFormatList');
      if (subList) subList.style.display = 'none';

      if (playlistContainer) {
        playlistContainer.style.display = 'block';
        renderPlaylistTracks(meta.tracks || [], meta);
      }
    } else {
      if (tabsNav) tabsNav.style.display = 'flex';
      if (playlistContainer) playlistContainer.style.display = 'none';

      // Render Formats
      renderVideoFormats(meta.videoOptions);
      renderAudioFormats(meta.audioOptions);
      renderThumbnailFormat(meta.thumbnailUrl, meta.title);
      renderSubtitlesFormat(meta.subtitlesList, meta.originalUrl, meta.title);

      // Adjust tab label if post contains photos
      const videoTabBtn = document.querySelector('.tab-btn[data-tab="video"]');
      if (videoTabBtn) {
        const hasImages = meta.videoOptions && meta.videoOptions.some(o => o.type === 'image');
        videoTabBtn.innerHTML = hasImages 
          ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>Photos &amp; Media</span>`
          : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg><span>Video + Subtitles</span>`;
      }

      // Default to Video/Media tab
      switchTab('video');
    }
  }

  /**
   * Render Spotify Playlist Tracks List with Real-time Search Filter & Batch ZIP Download
   */
  let allPlaylistTracks = [];
  let selectedTrackIndices = new Set();

  function renderPlaylistTracks(tracks, meta) {
    allPlaylistTracks = tracks;
    selectedTrackIndices = new Set(tracks.map(t => t.index));

    const countBadge = document.getElementById('playlistTrackCountBadge');
    if (countBadge) {
      countBadge.textContent = `${tracks.length} Songs`;
    }

    const selectAllChk = document.getElementById('selectAllPlaylistTracks');
    if (selectAllChk) {
      selectAllChk.checked = true;
      selectAllChk.onchange = () => {
        if (selectAllChk.checked) {
          allPlaylistTracks.forEach(t => selectedTrackIndices.add(t.index));
        } else {
          selectedTrackIndices.clear();
        }
        document.querySelectorAll('.track-chk').forEach(c => {
          c.checked = selectAllChk.checked;
        });
        updateSelectionUI(meta);
      };
    }

    const btnDownloadAll = document.getElementById('btnDownloadAllPlaylist');
    if (btnDownloadAll) {
      btnDownloadAll.onclick = () => {
        triggerPlaylistBatchDownload(meta);
      };
    }

    const searchInput = document.getElementById('playlistSearchInput');
    if (searchInput) {
      searchInput.value = '';
      searchInput.oninput = (e) => {
        const q = e.target.value.toLowerCase().trim();
        const filtered = allPlaylistTracks.filter(t => 
          (t.title && t.title.toLowerCase().includes(q)) || 
          (t.artist && t.artist.toLowerCase().includes(q))
        );
        populateTracksGrid(filtered, meta);
      };
    }

    updateSelectionUI(meta);
    populateTracksGrid(tracks, meta);
  }

  function updateSelectionUI(meta) {
    const count = selectedTrackIndices.size;
    const total = allPlaylistTracks.length;
    const badge = document.getElementById('selectedCountBadge');
    if (badge) {
      badge.textContent = `${count} of ${total} selected`;
    }
    const selectAllChk = document.getElementById('selectAllPlaylistTracks');
    if (selectAllChk) {
      selectAllChk.checked = count === total && total > 0;
      selectAllChk.indeterminate = count > 0 && count < total;
    }
    const btnText = document.getElementById('btnDownloadAllText');
    const btnDownloadAll = document.getElementById('btnDownloadAllPlaylist');
    if (btnText && btnDownloadAll) {
      btnDownloadAll.disabled = count === 0;
      if (count === total) {
        btnText.textContent = `⚡ Download All (${total} Songs ZIP Folder)`;
      } else if (count === 0) {
        btnText.textContent = 'Select songs to download';
      } else {
        btnText.textContent = `⚡ Download ${count} Songs (ZIP Folder)`;
      }
    }
  }

  let activePreviewAudio = null;
  let activePreviewBtn = null;

  function handleTrackAudioPreview(previewUrl, btn) {
    if (activePreviewAudio) {
      activePreviewAudio.pause();
      if (activePreviewBtn) {
        activePreviewBtn.classList.remove('playing');
        activePreviewBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      }
      if (activePreviewBtn === btn) {
        activePreviewAudio = null;
        activePreviewBtn = null;
        return;
      }
    }

    if (!previewUrl) return;

    activePreviewAudio = new Audio(previewUrl);
    activePreviewBtn = btn;
    btn.classList.add('playing');
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

    activePreviewAudio.play().catch(() => {});

    activePreviewAudio.onended = () => {
      btn.classList.remove('playing');
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      activePreviewAudio = null;
      activePreviewBtn = null;
    };
  }

  // Cache for resolved individual song album artwork from high-speed iTunes store
  const trackArtworkCache = new Map();

  async function resolveTrackArtwork(query) {
    if (!query) return null;
    const clean = query.replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    if (trackArtworkCache.has(clean)) {
      return trackArtworkCache.get(clean);
    }
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(clean)}&entity=song&limit=1`);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0 && data.results[0].artworkUrl100) {
          const highRes = data.results[0].artworkUrl100.replace('100x100bb', '300x300bb');
          trackArtworkCache.set(clean, highRes);
          return highRes;
        }
      }
    } catch (e) {}
    trackArtworkCache.set(clean, null);
    return null;
  }

  function populateTracksGrid(tracks, meta) {
    const listContainer = document.getElementById('playlistTracksList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (!tracks || tracks.length === 0) {
      listContainer.innerHTML = `
        <div class="playlist-empty-state">
          <p>No matching tracks found in this playlist.</p>
        </div>
      `;
      return;
    }

    tracks.forEach((track) => {
      const isSelected = selectedTrackIndices.has(track.index);
      const row = document.createElement('div');
      row.className = 'playlist-track-row';
      const placeholderImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%231db954' width='24' height='24'%3E%3Cpath d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/%3E%3C/svg%3E";
      const initialCover = (track.coverUrl && !track.coverUrl.includes('mosaic.scdn.co')) ? track.coverUrl : placeholderImg;

      row.innerHTML = `
        <div class="track-left">
          <input type="checkbox" class="track-chk" data-track-index="${track.index}" ${isSelected ? 'checked' : ''} title="Select song for batch ZIP download">
          <div class="track-num">${track.index || '♪'}</div>
          <div class="track-cover-box">
            <img class="track-cover-img" src="${initialCover}" alt="" loading="lazy" onerror="this.src='${placeholderImg}'">
            ${track.audioPreviewUrl ? `
              <button class="btn-track-preview" data-preview-url="${track.audioPreviewUrl}" title="Play 30s preview">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>` : ''}
          </div>
          <div class="track-info">
            <div class="track-title-row">
              <span class="track-title">${escapeHtml(track.title)}</span>
              ${track.isExplicit ? '<span class="explicit-badge" title="Explicit Content">E</span>' : ''}
            </div>
            <div class="track-artist">${escapeHtml(track.artist || 'Unknown Artist')}</div>
          </div>
        </div>
        <div class="track-right">
          <span class="track-duration">${track.durationFormatted || '3:30'}</span>
          <button class="btn-track-dl" title="Download single 320 kbps MP3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>320k MP3</span>
          </button>
        </div>
      `;

      // Always dynamically fetch and display the individual song album artwork image
      resolveTrackArtwork(`${track.title} ${track.artist}`).then(coverUrl => {
        if (coverUrl) {
          track.coverUrl = coverUrl;
          const img = row.querySelector('.track-cover-img');
          if (img) img.src = coverUrl;
        }
      }).catch(() => {});

      const chk = row.querySelector('.track-chk');
      chk.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedTrackIndices.add(track.index);
        } else {
          selectedTrackIndices.delete(track.index);
        }
        updateSelectionUI(meta);
      });

      // Row click selection
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-track-dl') || e.target.closest('.btn-track-preview') || e.target.classList.contains('track-chk')) {
          return;
        }
        chk.checked = !chk.checked;
        if (chk.checked) {
          selectedTrackIndices.add(track.index);
        } else {
          selectedTrackIndices.delete(track.index);
        }
        updateSelectionUI(meta);
      });

      const previewBtn = row.querySelector('.btn-track-preview');
      if (previewBtn) {
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleTrackAudioPreview(track.audioPreviewUrl, previewBtn);
        });
      }

      const btn = row.querySelector('.btn-track-dl');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload({
          url: meta.originalUrl,
          query: track.query || `${track.title} ${track.artist}`,
          type: 'audio',
          audioFormat: 'mp3',
          audioBitrate: '320k',
          title: track.title,
          artist: track.artist,
          quality: '320 kbps Studio Master MP3',
          size: '~8.5 MB',
          coverUrl: track.coverUrl || meta.thumbnail,
          thumbnail: track.coverUrl || meta.thumbnail
        }, btn);
      });

      listContainer.appendChild(row);
    });
  }

  /**
   * Batch Download Entire Playlist or Selected Songs into a single ZIP Folder
   */
  async function triggerPlaylistBatchDownload(meta) {
    const selected = allPlaylistTracks.filter(t => selectedTrackIndices.has(t.index));
    if (selected.length === 0) {
      alert('Please select at least one song to download.');
      return;
    }

    if (window.soundFx) window.soundFx.playClick();

    // 1. Open Progress Modal
    if (progressModal) {
      progressModal.classList.add('active');
    }

    // Show Playlist Cover Art in Download Modal
    if (modalCoverWrapper && modalCoverImg && modalDefaultIcon) {
      if (meta.thumbnail) {
        modalCoverImg.src = meta.thumbnail;
        modalCoverWrapper.style.display = 'block';
        modalDefaultIcon.style.display = 'none';
      } else {
        modalCoverWrapper.style.display = 'none';
        modalDefaultIcon.style.display = 'block';
      }
    }

    const playlistName = meta.title || 'Spotify Playlist';
    if (modalTitle) modalTitle.textContent = `${playlistName} (ZIP Folder)`;
    if (modalQualityText) modalQualityText.textContent = `Batch downloading ${selected.length} songs • High-Quality 320 kbps MP3 Album`;
    if (progressBarFill) {
      progressBarFill.style.width = '0%';
      progressBarFill.style.background = 'linear-gradient(90deg, #1db954, #00f2fe, #fe0979)';
    }
    if (progressNumber) progressNumber.textContent = '0%';
    if (progressStatusText) progressStatusText.textContent = `Initializing batch download for ${selected.length} songs...`;
    if (modalSpeed) modalSpeed.textContent = `0/${selected.length}`;
    if (modalSize) modalSize.textContent = `~${Math.round(selected.length * 8.5)} MB`;
    if (modalEta) modalEta.textContent = 'Calculating...';

    // Steps
    if (step1) step1.className = 'modal-step active';
    if (step2) step2.className = 'modal-step';
    if (step3) step3.className = 'modal-step';
    if (modalActions) modalActions.style.display = 'none';

    // Close any previous SSE
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }

    try {
      const res = await fetch('/api/download/playlist-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playlistTitle: playlistName,
          tracks: selected,
          audioFormat: 'mp3',
          audioBitrate: '320k'
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to start batch download.');
      }

      const jobId = data.jobId;
      activeJobId = jobId;

      // Connect to SSE
      activeEventSource = new EventSource(`/api/download/progress/${jobId}`);
      activeEventSource.onmessage = (e) => {
        try {
          const job = JSON.parse(e.data);
          const isComplete = job.complete || job.status === 'ready' || job.status === 'complete';
          const isFailed = job.status === 'failed' || job.status === 'error';

          if (isComplete) {
            if (activeEventSource) {
              activeEventSource.close();
              activeEventSource = null;
            }

            if (progressBarFill) progressBarFill.style.width = '100%';
            if (progressNumber) progressNumber.textContent = '100%';
            if (progressStatusText) progressStatusText.textContent = job.message || '✨ 100% Complete! ZIP Folder ready for download.';
            if (step1) step1.className = 'modal-step completed';
            if (step2) step2.className = 'modal-step completed';
            if (step3) step3.className = 'modal-step completed';

            if (window.soundFx) window.soundFx.playSuccess();

            const safeFilename = job.targetFilename || `${playlistName}.zip`;
            const fileDownloadUrl = `/api/download/file/${jobId}/${encodeURIComponent(safeFilename)}`;

            if (btnSaveReadyFile) {
              btnSaveReadyFile.href = fileDownloadUrl;
              btnSaveReadyFile.setAttribute('download', safeFilename);
            }
            if (modalActions) {
              modalActions.style.display = 'block';
            }

            // Trigger browser download
            triggerNativeBrowserDownload(fileDownloadUrl, safeFilename);
            return;
          }

          if (isFailed) {
            if (activeEventSource) {
              activeEventSource.close();
              activeEventSource = null;
            }
            if (progressStatusText) progressStatusText.textContent = `❌ ${job.error || 'Batch download encountered an issue.'}`;
            if (modalSpeed) modalSpeed.textContent = 'Failed';
            if (progressBarFill) progressBarFill.style.background = '#fe0979';
            if (window.soundFx) window.soundFx.playError();
            return;
          }

          // Live progress
          const percent = Math.min(100, Math.max(0, job.percentage || 0));
          if (progressBarFill) progressBarFill.style.width = `${percent}%`;
          if (progressNumber) progressNumber.textContent = `${percent}%`;
          if (progressStatusText) progressStatusText.textContent = job.message || 'Downloading songs in batch...';
          if (modalSpeed) modalSpeed.textContent = job.speed || 'Downloading';
          if (modalEta) modalEta.textContent = job.eta || '--:--';

          if (percent > 10 && step1) step1.className = 'modal-step completed';
          if (percent > 15 && step2) step2.className = 'modal-step active';
          if (percent >= 90 && step2) step2.className = 'modal-step completed';
          if (percent >= 90 && step3) step3.className = 'modal-step active';
        } catch (_) {}
      };

      activeEventSource.onerror = async () => {
        try {
          const checkRes = await fetch(`/api/download/status/${jobId}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData && (checkData.complete || checkData.status === 'ready')) {
              if (activeEventSource) {
                activeEventSource.close();
                activeEventSource = null;
              }
              const safeFilename = checkData.targetFilename || `${playlistName}.zip`;
              const fileDownloadUrl = `/api/download/file/${jobId}/${encodeURIComponent(safeFilename)}`;
              if (btnSaveReadyFile) {
                btnSaveReadyFile.href = fileDownloadUrl;
                btnSaveReadyFile.setAttribute('download', safeFilename);
              }
              if (modalActions) modalActions.style.display = 'block';
              triggerNativeBrowserDownload(fileDownloadUrl, safeFilename);
              if (window.soundFx) window.soundFx.playSuccess();
            }
          }
        } catch (_) {}
      };

    } catch (err) {
      if (window.soundFx) window.soundFx.playError();
      if (progressStatusText) progressStatusText.textContent = `⚠️ Error: ${err.message}`;
      if (progressBarFill) progressBarFill.style.background = '#fe0979';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Render Video formats list
   */
  /**
   * Render Video formats list
   */
  function renderVideoFormats(options) {
    const container = document.getElementById('videoFormatsList');
    container.innerHTML = '';

    if (!options || options.length === 0) {
      container.innerHTML = '<p class="text-muted">No direct video streams found.</p>';
      return;
    }

    options.forEach((opt) => {
      const card = document.createElement('div');
      card.className = 'format-card-item card-3d';
      const sizeDisplay = opt.estimatedSize || (opt.type === 'image' ? '~2.5 MB' : '~25.0 MB');
      const isImage = opt.type === 'image';

      card.innerHTML = `
        <div class="format-card-header">
          <div class="format-title">${opt.label}</div>
          <div class="format-size-tag">💾 ${sizeDisplay}</div>
        </div>
        <div class="format-badges-row">
          <span class="format-badge" style="background: rgba(0, 242, 254, 0.2); color: #00f2fe;">${opt.ext.toUpperCase()}</span>
          ${opt.badge ? `<span class="format-badge badge-glow">${opt.badge}</span>` : ''}
          ${isImage ? '<span class="format-badge" style="background: rgba(254, 9, 121, 0.2); color: #fe0979;">HD PHOTO</span>' : '<span class="format-badge" style="background: rgba(121, 40, 202, 0.2); color: #c084fc;">⚡ SUBTITLES</span><span class="format-badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">HD AUDIO</span>'}
        </div>
        <div class="format-subtext">
          ${isImage ? 'Original high-resolution photo from Instagram post in crystal clear quality.' : 'High-definition video stream with synchronized subtitles & crisp high-fidelity audio.'}
        </div>
        <div class="format-action-row">
          <button class="format-dl-btn" data-type="${opt.type || 'video'}" data-height="${opt.height || 0}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              ${isImage ? '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>' : '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>'}
            </svg>
            ${isImage ? 'Download Photo (HD JPG)' : `Download Video (${opt.quality || opt.ext.toUpperCase()})`}
          </button>
        </div>
      `;

      card.querySelector('.format-dl-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload({
          url: currentMetadata.originalUrl,
          type: opt.type || 'video',
          height: opt.height,
          directUrl: opt.directUrl || null,
          title: currentMetadata.title,
          artist: currentMetadata.uploader || currentMetadata.artist || '',
          quality: opt.quality || (isImage ? 'Original HD Photo' : `${opt.height}p Video`),
          size: sizeDisplay
        }, e.currentTarget);
      });

      container.appendChild(card);
    });
  }

  /**
   * Render Audio formats list
   */
  function renderAudioFormats(options) {
    const container = document.getElementById('audioFormatsList');
    container.innerHTML = '';

    if (!options || options.length === 0) {
      container.innerHTML = '<p class="text-muted">No audio options found for this link.</p>';
      return;
    }

    // Filter out any mp4 audio formats
    const pureAudioOptions = options.filter(o => o.type !== 'audio_mp4_subs' && o.ext !== 'mp4');

    // 1. Featured Top Card: MP3 320 kbps Studio Quality with Embedded Subtitles & Cover Artwork
    const featuredMp3Option = pureAudioOptions.find(o => o.id === 'audio-mp3-320') || pureAudioOptions.find(o => o.audioFormat === 'mp3') || pureAudioOptions[0];
    const otherAudioOptions = pureAudioOptions.filter(o => o !== featuredMp3Option);

    if (featuredMp3Option) {
      const featuredCard = document.createElement('div');
      featuredCard.className = 'format-card-item featured-format-card card-3d';
      featuredCard.style.gridColumn = '1 / -1';
      const sizeDisplay = featuredMp3Option.estimatedSize || '~8.3 MB';
      featuredCard.innerHTML = `
        <div class="format-card-header">
          <div class="format-title" style="color: #00f2fe; font-size: 1.15rem;">
            <span class="pulse-indicator"></span>
            ⚡ ${featuredMp3Option.label}
          </div>
          <div class="format-size-tag" style="background: rgba(0, 242, 254, 0.25); color: #00f2fe; border-color: #00f2fe;">
            💾 ${sizeDisplay}
          </div>
        </div>
        <div class="format-badges-row">
          <span class="format-badge badge-glow">⭐ RECOMMENDED</span>
          <span class="format-badge" style="background: rgba(0, 242, 254, 0.2); color: #00f2fe;">MP3 320 KBPS</span>
          <span class="format-badge" style="background: rgba(121, 40, 202, 0.25); color: #c084fc;">SUBTITLES / LYRICS EMBEDDED</span>
          <span class="format-badge" style="background: rgba(254, 9, 121, 0.25); color: #fe0979;">COVER ART EMBEDDED</span>
        </div>
        <div class="format-subtext">
          Maximum studio fidelity 320 kbps MP3 with embedded synchronized lyrics/subtitles & HD album artwork. Plays with native lyrics on mobile phones and media players!
        </div>
        <div class="format-action-row">
          <button class="format-dl-btn btn-highlight" data-type="audio" data-format="mp3" data-bitrate="320k">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
            Download MP3 (320 kbps + Subtitles & Cover Art)
          </button>
        </div>
      `;

      featuredCard.querySelector('.format-dl-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload({
          url: currentMetadata.originalUrl,
          type: 'audio',
          audioFormat: 'mp3',
          audioBitrate: '320k',
          title: currentMetadata.title,
          artist: currentMetadata.uploader || currentMetadata.artist || '',
          quality: 'MP3 320 kbps + Subtitles & Art',
          size: sizeDisplay
        }, e.currentTarget);
      });

      container.appendChild(featuredCard);
    }

    // 2. High-Res Cover Artwork Card
    const artCard = document.createElement('div');
    artCard.className = 'format-card-item card-3d';
    artCard.innerHTML = `
      <div class="format-card-header">
        <div class="format-title">🎨 High-Resolution Cover Artwork</div>
        <div class="format-size-tag" style="background: rgba(254, 9, 121, 0.15); color: #fe0979; border-color: rgba(254, 9, 121, 0.35);">💾 ~1.2 MB</div>
      </div>
      <div class="format-badges-row">
        <span class="format-badge" style="background: rgba(254, 9, 121, 0.2); color: #fe0979;">HD COVER ART</span>
        <span class="format-badge">ORIGINAL RESOLUTION</span>
      </div>
      <div class="format-subtext">
        Direct high-resolution thumbnail and album artwork image for your phone gallery or music player.
      </div>
      <div class="format-action-row">
        <a href="${currentMetadata.thumbnailUrl}" target="_blank" download="${(currentMetadata.title || 'media').replace(/[^a-zA-Z0-9_-]/g, '_')}_cover.jpg" class="format-dl-btn" style="text-decoration: none; background: linear-gradient(135deg, #fe0979, #ff758c);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          Download Cover Artwork
        </a>
      </div>
    `;
    container.appendChild(artCard);

    // 3. Regular Audio Options (MP3 256k, 192k, 128k, M4A, WAV, FLAC)
    otherAudioOptions.forEach((opt) => {
      const card = document.createElement('div');
      card.className = 'format-card-item card-3d';
      const sizeDisplay = opt.estimatedSize || '~8.5 MB';
      const isMp3 = (opt.audioFormat === 'mp3' || opt.ext === 'mp3');
      card.innerHTML = `
        <div class="format-card-header">
          <div class="format-title">${opt.label}</div>
          <div class="format-size-tag">💾 ${sizeDisplay}</div>
        </div>
        <div class="format-badges-row">
          <span class="format-badge" style="background: rgba(0, 242, 254, 0.2); color: #00f2fe;">${opt.ext.toUpperCase()}</span>
          ${opt.badge ? `<span class="format-badge badge-glow">${opt.badge}</span>` : ''}
          ${isMp3 ? `<span class="format-badge" style="background: rgba(121, 40, 202, 0.2); color: #c084fc;">SUBTITLES & ART</span>` : ''}
          <span class="format-badge" style="background: rgba(254, 9, 121, 0.2); color: #fe0979;">COVER ART EMBEDDED</span>
        </div>
        <div class="format-subtext">
          ${isMp3 ? 'High-quality MP3 with embedded subtitles/lyrics and album cover art.' : 'High-fidelity audio stream with embedded metadata.'}
        </div>
        <div class="format-action-row">
          <button class="format-dl-btn" data-type="audio" data-format="${opt.audioFormat}" data-bitrate="${opt.audioBitrate || ''}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
            Download ${opt.ext.toUpperCase()} (${opt.quality || opt.audioFormat})
          </button>
        </div>
      `;

      card.querySelector('.format-dl-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload({
          url: currentMetadata.originalUrl,
          type: opt.type || 'audio',
          audioFormat: opt.audioFormat,
          audioBitrate: opt.audioBitrate,
          title: currentMetadata.title,
          artist: currentMetadata.uploader || currentMetadata.artist || '',
          quality: opt.quality || `${opt.ext.toUpperCase()} Audio`,
          size: sizeDisplay
        }, e.currentTarget);
      });

      container.appendChild(card);
    });
  }

  /**
   * Render Subtitles & Lyrics formats list
   */
  function renderSubtitlesFormat(subtitlesList, originalUrl, title) {
    const container = document.getElementById('subtitlesFormatList');
    container.innerHTML = '';

    if (!subtitlesList || subtitlesList.length === 0) {
      container.innerHTML = '<p class="text-muted">No subtitles available for this source.</p>';
      return;
    }

    subtitlesList.forEach((sub) => {
      const card = document.createElement('div');
      card.className = 'format-card-item card-3d';
      card.innerHTML = `
        <div class="format-card-header">
          <div class="format-title">💬 ${sub.label}</div>
          <div class="format-size-tag">💾 ~45 KB</div>
        </div>
        <div class="format-badges-row">
          <span class="format-badge">${sub.badge || 'SRT'}</span>
          <span class="format-badge" style="background: rgba(121, 40, 202, 0.2); color: #c084fc;">SUBTITLES / LYRICS</span>
        </div>
        <div class="format-subtext">
          SubRip Subtitle (.SRT) text format, compatible with all video players, VLC, and mobile apps.
        </div>
        <div class="format-action-row">
          <button class="format-dl-btn" style="background: linear-gradient(135deg, #7928ca, #4338ca);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            Download .SRT Subtitle
          </button>
        </div>
      `;

      card.querySelector('.format-dl-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerSubtitleDownload({
          url: currentMetadata.originalUrl,
          lang: sub.lang,
          title: currentMetadata.title
        }, e.currentTarget);
      });

      container.appendChild(card);
    });
  }

  /**
   * Direct Subtitle Download Trigger
   */
  function triggerSubtitleDownload(options, btnElement) {
    if (window.soundFx) window.soundFx.playClick();

    const originalBtnHtml = btnElement ? btnElement.innerHTML : null;
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.innerHTML = `
        <svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
        Fetching...
      `;
    }

    showToast(`Downloading subtitle (${options.lang.toUpperCase()}) directly!`, '💬');
    if (window.soundFx) window.soundFx.playSuccess();

    const params = new URLSearchParams({
      url: options.url,
      lang: options.lang,
      title: options.title || 'subtitles'
    });

    const subUrl = `/api/download/subtitle?${params.toString()}`;

    let dlIframe = document.getElementById('hidden-download-iframe');
    if (!dlIframe) {
      dlIframe = document.createElement('iframe');
      dlIframe.id = 'hidden-download-iframe';
      dlIframe.style.display = 'none';
      document.body.appendChild(dlIframe);
    }
    dlIframe.src = subUrl;

    setTimeout(() => {
      if (btnElement) btnElement.innerHTML = `✓ Downloaded!`;
    }, 1500);

    setTimeout(() => {
      if (btnElement && originalBtnHtml) {
        btnElement.innerHTML = originalBtnHtml;
        btnElement.disabled = false;
      }
    }, 3500);
  }

  /**
   * Render Thumbnail download format
   */
  function renderThumbnailFormat(url, title) {
    const container = document.getElementById('thumbnailFormatList');
    container.innerHTML = `
      <div class="format-card-item card-3d" style="grid-column: 1 / -1;">
        <div class="format-card-header">
          <div class="format-title">🖼️ High-Definition Thumbnail / Cover Art</div>
          <div class="format-size-tag" style="background: rgba(254, 9, 121, 0.15); color: #fe0979; border-color: rgba(254, 9, 121, 0.35);">💾 ~1.2 MB</div>
        </div>
        <div class="format-badges-row">
          <span class="format-badge badge-glow">ORIGINAL RESOLUTION</span>
          <span class="format-badge">ULTRA-HD</span>
        </div>
        <div class="format-subtext">Original resolution artwork directly from content source</div>
        <div class="format-action-row">
          <a href="${url}" target="_blank" download="${(title || 'artwork').replace(/[^a-zA-Z0-9_-]/g, '_')}_artwork.jpg" class="format-dl-btn" style="text-decoration: none;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            Download Original Artwork
          </a>
        </div>
      </div>
    `;
  }

  // Format Tabs switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
      if (window.soundFx) window.soundFx.playClick();
    });
  });

  function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });

    document.getElementById('videoFormatsList').style.display = tabName === 'video' ? 'grid' : 'none';
    document.getElementById('audioFormatsList').style.display = tabName === 'audio' ? 'grid' : 'none';
    document.getElementById('thumbnailFormatList').style.display = tabName === 'thumbnail' ? 'grid' : 'none';
    const subContainer = document.getElementById('subtitlesFormatList');
    if (subContainer) {
      subContainer.style.display = tabName === 'subtitles' ? 'grid' : 'none';
    }
  }

  // Sleek Floating Toast Notification
  function showToast(message, icon = '🚀') {
    const existing = document.querySelector('.nexadown-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'nexadown-toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s ease';
      setTimeout(() => toast.remove(), 500);
    }, 4500);
  }

  /**
   * High-Speed Direct Download Trigger
   * Opens live 3D cyberpunk progress modal with real-time download telemetry (speed, size, ETA)
   * and automatically initiates native browser file download upon completion.
   */
  async function triggerDownload(options, btnElement) {
    if (window.soundFx) window.soundFx.playClick();

    // 1. Open Progress Modal
    if (progressModal) {
      progressModal.classList.add('active');
    }

    // Set Modal Cover Art if available
    const coverArt = options.coverUrl || options.thumbnail || (currentMetadata ? currentMetadata.thumbnail : null);
    if (modalCoverWrapper && modalCoverImg && modalDefaultIcon) {
      if (coverArt) {
        modalCoverImg.src = coverArt;
        modalCoverWrapper.style.display = 'block';
        modalDefaultIcon.style.display = 'none';
      } else {
        modalCoverWrapper.style.display = 'none';
        modalDefaultIcon.style.display = 'block';
      }
    }

    // 2. Set Modal Details
    if (modalTitle) modalTitle.textContent = options.title || 'Downloading Media';
    if (modalQualityText) modalQualityText.textContent = `${options.quality || (options.type ? options.type.toUpperCase() : 'MEDIA')} • Fast Multi-Threaded Download`;
    if (progressBarFill) {
      progressBarFill.style.width = '0%';
      progressBarFill.style.background = 'linear-gradient(90deg, #00f2fe, #fe0979, #ffde59)';
    }
    if (progressNumber) progressNumber.textContent = '0%';
    if (progressStatusText) progressStatusText.textContent = 'Initializing high-speed engine...';
    if (modalSpeed) modalSpeed.textContent = 'Starting...';
    if (modalSize) modalSize.textContent = options.size || 'Estimating...';
    if (modalEta) modalEta.textContent = '--:--';

    // Reset Checklist Steps
    if (step1) { step1.className = 'modal-step active'; }
    if (step2) { step2.className = 'modal-step'; }
    if (step3) { step3.className = 'modal-step'; }
    if (modalActions) { modalActions.style.display = 'none'; }

    // Close any previous SSE connection
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }

    try {
      // Start background download job
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: options.url,
          type: options.type,
          height: options.height,
          audioFormat: options.audioFormat || options.format,
          format: options.audioFormat || options.format,
          audioBitrate: options.audioBitrate || options.bitrate,
          bitrate: options.audioBitrate || options.bitrate,
          title: options.title,
          artist: options.artist,
          directUrl: options.directUrl || null,
          query: options.query || null
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to start download job');
      }

      const jobId = data.jobId;

      // Connect to Server-Sent Events (SSE) for Real-Time Progress Updates
      activeEventSource = new EventSource(`/api/download/progress/${jobId}`);

      activeEventSource.onmessage = (e) => {
        try {
          const job = JSON.parse(e.data);
          const isComplete = job.complete || job.status === 'ready' || job.status === 'complete';
          const isFailed = job.status === 'failed' || job.status === 'error';

          if (isComplete) {
            if (activeEventSource) {
              activeEventSource.close();
              activeEventSource = null;
            }

            if (progressBarFill) progressBarFill.style.width = '100%';
            if (progressNumber) progressNumber.textContent = '100%';
            if (progressStatusText) progressStatusText.textContent = '✨ Complete! File ready for download.';
            if (step1) step1.className = 'modal-step completed';
            if (step2) step2.className = 'modal-step completed';
            if (step3) step3.className = 'modal-step completed';

            if (window.soundFx) window.soundFx.playSuccess();

            const safeDownloadFilename = (job.targetFilename || options.title || 'nexadown_media')
              .replace(/[\\/:*?"<>|]/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            const fileDownloadUrl = `/api/download/file/${jobId}/${encodeURIComponent(safeDownloadFilename)}`;

            if (btnSaveReadyFile) {
              btnSaveReadyFile.href = fileDownloadUrl;
              btnSaveReadyFile.setAttribute('download', safeDownloadFilename);
            }
            if (modalActions) {
              modalActions.style.display = 'block';
            }

            // Automatically trigger native browser download
            triggerNativeBrowserDownload(fileDownloadUrl, safeDownloadFilename);

            showToast(`✓ Download ready: ${safeDownloadFilename}`, '💾');
          } else if (isFailed) {
            if (activeEventSource) {
              activeEventSource.close();
              activeEventSource = null;
            }
            if (progressStatusText) progressStatusText.textContent = `❌ ${job.error || 'Download failed'}`;
            if (progressBarFill) progressBarFill.style.background = '#fe0979';
            if (modalSpeed) modalSpeed.textContent = 'Failed';
            if (window.soundFx) window.soundFx.playError();
          } else {
            // In progress (downloading, processing, initializing)
            const rawPct = job.percentage !== undefined ? job.percentage : (job.progress || 0);
            const pct = Math.min(99, Math.max(0, Math.round(rawPct)));
            if (progressBarFill) progressBarFill.style.width = `${pct}%`;
            if (progressNumber) progressNumber.textContent = `${pct}%`;
            if (progressStatusText) {
              let msg = 'Downloading media stream...';
              if (job.status === 'initializing') msg = 'Initializing engine...';
              else if (job.status === 'processing') msg = job.message || 'Processing media & embedding artwork...';
              else if (job.message) msg = job.message;
              progressStatusText.textContent = msg;
            }
            if (modalSpeed) modalSpeed.textContent = job.speed || '-- KiB/s';
            if (modalSize) modalSize.textContent = job.totalSize || job.size || options.size || '-- MB';
            if (modalEta) modalEta.textContent = job.eta || '--:--';

            if (pct > 20 && step1 && step2) {
              step1.className = 'modal-step completed';
              step2.className = 'modal-step active';
            }
            if (pct > 80 && step2 && step3) {
              step2.className = 'modal-step completed';
              step3.className = 'modal-step active';
            }
          }
        } catch (parseErr) {
          console.error('SSE Message error:', parseErr);
        }
      };

      activeEventSource.onerror = async () => {
        // Fallback: check status via direct JSON API if SSE closes or encounters a glitch
        try {
          const checkRes = await fetch(`/api/download/status/${jobId}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData && (checkData.complete || checkData.status === 'ready')) {
              if (activeEventSource) {
                activeEventSource.close();
                activeEventSource = null;
              }
              if (progressBarFill) progressBarFill.style.width = '100%';
              if (progressNumber) progressNumber.textContent = '100%';
              if (progressStatusText) progressStatusText.textContent = '✨ Complete! File ready for download.';
              if (step1) step1.className = 'modal-step completed';
              if (step2) step2.className = 'modal-step completed';
              if (step3) step3.className = 'modal-step completed';
              if (window.soundFx) window.soundFx.playSuccess();
              const safeFallbackName = (checkData.targetFilename || options.title || 'nexadown_media')
                .replace(/[\\/:*?"<>|]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              const fUrl = `/api/download/file/${jobId}/${encodeURIComponent(safeFallbackName)}`;
              if (btnSaveReadyFile) {
                btnSaveReadyFile.href = fUrl;
                btnSaveReadyFile.setAttribute('download', safeFallbackName);
              }
              if (modalActions) modalActions.style.display = 'block';

              triggerNativeBrowserDownload(fUrl, safeFallbackName);
            }
          }
        } catch (_) {}
      };

    } catch (err) {
      if (progressStatusText) progressStatusText.textContent = `⚠️ Error: ${err.message}`;
      if (progressBarFill) progressBarFill.style.background = '#fe0979';
      if (window.soundFx) window.soundFx.playError();
    }
  }

  // Modal Close Listeners
  
  // Cancel active job via API
  async function cancelActiveJob() {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    if (activeJobId) {
      const idToCancel = activeJobId;
      activeJobId = null;
      try {
        await fetch(`/api/jobs/${idToCancel}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('Failed to delete job:', err);
      }
    }
    resetModalVisuals();
    if (progressModal) progressModal.classList.remove('active');
    showToast('Download cancelled', 'ℹ️');
  }

  function resetModalVisuals() {
    if (modalCoverWrapper && modalDefaultIcon) {
      modalCoverWrapper.style.display = 'none';
      modalDefaultIcon.style.display = 'block';
      if (modalCoverImg) modalCoverImg.src = '';
    }
    if (progressBarFill) {
      progressBarFill.style.width = '0%';
      progressBarFill.style.background = 'linear-gradient(90deg, #00f2fe, #fe0979, #ffde59)';
    }
    if (progressNumber) progressNumber.textContent = '0%';
    if (modalSpeed) modalSpeed.textContent = '0 KiB/s';
    if (modalSize) modalSize.textContent = '-- / --';
    if (modalEta) modalEta.textContent = '--:--';
    if (step1) step1.className = 'modal-step active';
    if (step2) step2.className = 'modal-step';
    if (step3) step3.className = 'modal-step';
    if (modalActions) modalActions.style.display = 'none';
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
      }
      resetModalVisuals();
      if (progressModal) progressModal.classList.remove('active');
      if (window.soundFx) window.soundFx.playClick();
    });
  }

  if (progressModal) {
    progressModal.addEventListener('click', (e) => {
      if (e.target === progressModal) {
        if (activeEventSource) {
          activeEventSource.close();
          activeEventSource = null;
        }
        resetModalVisuals();
        progressModal.classList.remove('active');
      }
    });
  }

  // ==========================================================================
  // LOCAL MEDIA CONVERTER (Drag & Drop + FFmpeg)
  // ==========================================================================
  const dropZone = document.getElementById('dropZone');
  const localFileInput = document.getElementById('localFileInput');
  const btnConvertLocal = document.getElementById('btnConvertLocal');
  const localTargetFormat = document.getElementById('localTargetFormat');
  const localBitrate = document.getElementById('localBitrate');
  const converterStatus = document.getElementById('converterStatus');

  let selectedLocalFile = null;

  if (dropZone && localFileInput) {
    dropZone.addEventListener('click', () => localFileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    localFileInput.addEventListener('change', () => {
      if (localFileInput.files.length > 0) {
        handleFileSelect(localFileInput.files[0]);
      }
    });
  }

  function handleFileSelect(file) {
    selectedLocalFile = file;
    document.getElementById('dropZonePrompt').innerHTML = `
      <div style="color: var(--primary); font-weight: 700; font-size: 1.1rem;">📄 ${file.name}</div>
      <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">Size: ${(file.size / (1024 * 1024)).toFixed(2)} MB</div>
    `;
    btnConvertLocal.disabled = false;
  }

  if (btnConvertLocal) {
    btnConvertLocal.addEventListener('click', async () => {
      if (!selectedLocalFile) return;

      if (window.soundFx) window.soundFx.playClick();
      btnConvertLocal.disabled = true;
      converterStatus.textContent = '⚡ Uploading & converting with FFmpeg...';

      const formData = new FormData();
      formData.append('mediaFile', selectedLocalFile);
      formData.append('format', localTargetFormat.value);
      formData.append('bitrate', localBitrate.value);

      try {
        const response = await fetch('/api/convert-local', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error('Local file conversion failed.');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedLocalFile.name.replace(/\.[^/.]+$/, '')}_converted.${localTargetFormat.value}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        converterStatus.textContent = '✨ Conversion complete! File saved.';
        if (window.soundFx) window.soundFx.playSuccess();
      } catch (err) {
        converterStatus.textContent = `❌ Error: ${err.message}`;
        if (window.soundFx) window.soundFx.playError();
      } finally {
        btnConvertLocal.disabled = false;
      }
    });
  }

  // ==========================================================================
  // MOBILE BOTTOM APP DOCK CONTROLS
  // ==========================================================================
  const mobileThemeBtn = document.getElementById('mobileThemeBtn');
  if (mobileThemeBtn) {
    mobileThemeBtn.addEventListener('click', () => {
      currentThemeIdx = (currentThemeIdx + 1) % themes.length;
      applyTheme(themes[currentThemeIdx]);
      if (window.soundFx) window.soundFx.playClick();
    });
  }

  const mobileSoundBtn = document.getElementById('mobileSoundBtn');
  const mobileSoundIcon = document.getElementById('mobileSoundIcon');
  if (mobileSoundBtn) {
    mobileSoundBtn.addEventListener('click', () => {
      if (window.soundFx) {
        const muted = window.soundFx.toggleMute();
        updateSoundIcon();
        if (mobileSoundIcon) mobileSoundIcon.textContent = muted ? '🔇' : '🔊';
        if (!muted) window.soundFx.playClick();
      }
    });
  }

  document.querySelectorAll('.dock-item').forEach((item) => {
    if (item.tagName === 'A') {
      item.addEventListener('click', () => {
        document.querySelectorAll('.dock-item').forEach(d => d.classList.remove('active'));
        item.classList.add('active');
        if (window.soundFx) window.soundFx.playClick();
      });
    }
  });

  // Navigation Links Page Switching
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (targetId && targetId.startsWith('#')) {
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        if (navLinks.classList.contains('mobile-open')) {
          navLinks.classList.remove('mobile-open');
        }
      }
    });
  });
});

