document.addEventListener("DOMContentLoaded", () => {
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
  }

  const addBtn = document.getElementById("addBtn");
  const fileInput = document.getElementById("fileInput");
  const searchInput = document.getElementById("searchInput");
  const trackList = document.getElementById("trackList");
  const trackCounter = document.getElementById("trackCounter");

  const miniPlayer = document.getElementById("miniPlayer");
  const miniTitle = document.getElementById("miniTitle");
  const miniArtist = document.getElementById("miniArtist");
  const miniPlayBtn = document.getElementById("miniPlayBtn");

  const fullPlayer = document.getElementById("fullPlayer");
  const closeFullBtn = document.getElementById("closeFullBtn");
  const fullTitle = document.getElementById("fullTitle");
  const fullArtist = document.getElementById("fullArtist");

  const progressBar = document.getElementById("progressBar");
  const currentTime = document.getElementById("currentTime");
  const durationTime = document.getElementById("durationTime");

  const prevBtn = document.getElementById("prevBtn");
  const playBtn = document.getElementById("playBtn");
  const nextBtn = document.getElementById("nextBtn");
  const shuffleBtn = document.getElementById("shuffleBtn");
  const repeatBtn = document.getElementById("repeatBtn");

  const DB_NAME = "offline_music_player_db_v2";
  const DB_VERSION = 1;
  const STORE_NAME = "tracks";

  let db = null;
  let tracks = [];
  let currentIndex = -1;
  let searchQuery = "";
  let isShuffle = false;
  let repeatMode = "off";

  const audio = new Audio();

  init();

  async function init() {
    try {
      db = await openDb();
      tracks = await getAllTracks();
    } catch (error) {
      console.warn("IndexedDB недоступен, работаем без сохранения:", error);
      tracks = [];
    }

    renderTracks();

    if (tracks.length > 0) {
      currentIndex = 0;
      loadCurrent(false);
    }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB не поддерживается"));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function saveTrackToDb(track) {
    return new Promise((resolve, reject) => {
      if (!db) {
        resolve(track);
        return;
      }

      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(track);

      request.onsuccess = () => {
        track.id = request.result;
        resolve(track);
      };

      request.onerror = () => reject(request.error);
    });
  }

  function getAllTracks() {
    return new Promise((resolve, reject) => {
      if (!db) {
        resolve([]);
        return;
      }

      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const savedTracks = request.result.map((track) => ({
          ...track,
          url: URL.createObjectURL(track.file),
        }));

        resolve(savedTracks);
      };

      request.onerror = () => reject(request.error);
    });
  }

  function deleteTrackFromDb(id) {
    return new Promise((resolve, reject) => {
      if (!db || id === undefined || id === null) {
        resolve();
        return;
      }

      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  addBtn.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      try {
        const cleanName = getCleanFileName(file);

        const track = {
          title: cleanName,
          artist: "Локальный файл",
          name: file.name || cleanName,
          type: file.type || "audio",
          size: file.size || 0,
          file,
        };

        let savedTrack = track;

        try {
          savedTrack = await saveTrackToDb(track);
        } catch (dbError) {
          console.warn("Не удалось сохранить трек, добавляю временно:", dbError);
        }

        tracks.push({
          ...savedTrack,
          url: URL.createObjectURL(file),
        });
      } catch (error) {
        console.error("Ошибка добавления файла:", error);
        alert("Не удалось добавить файл");
      }
    }

    renderTracks();

    if (currentIndex === -1 && tracks.length > 0) {
      currentIndex = 0;
      loadCurrent(false);
    }

    fileInput.value = "";
  });

  searchInput.addEventListener("input", (event) => {
    searchQuery = event.target.value.toLowerCase().trim();
    renderTracks();
  });

  miniPlayer.addEventListener("click", (event) => {
    if (event.target === miniPlayBtn) return;
    openFullPlayer();
  });

  miniPlayBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    await togglePlay();
  });

  closeFullBtn.addEventListener("click", () => {
    fullPlayer.classList.add("hidden");
  });

  fullPlayer.addEventListener("click", (event) => {
    if (event.target === fullPlayer) {
      fullPlayer.classList.add("hidden");
    }
  });

  playBtn.addEventListener("click", togglePlay);
  prevBtn.addEventListener("click", previousTrack);
  nextBtn.addEventListener("click", () => nextTrack(false));

  shuffleBtn.addEventListener("click", () => {
    isShuffle = !isShuffle;
    updateButtons();
  });

  repeatBtn.addEventListener("click", () => {
    if (repeatMode === "off") repeatMode = "playlist";
    else if (repeatMode === "playlist") repeatMode = "one";
    else repeatMode = "off";

    updateButtons();
  });

  progressBar.addEventListener("input", () => {
    audio.currentTime = Number(progressBar.value);
  });

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("play", updateButtons);
  audio.addEventListener("pause", updateButtons);

  audio.addEventListener("ended", () => {
    if (repeatMode === "one") {
      audio.currentTime = 0;
      audio.play();
      return;
    }

    nextTrack(true);
  });

  function renderTracks() {
    trackList.innerHTML = "";

    if (trackCounter) {
      trackCounter.textContent = `${tracks.length} ${pluralTrack(tracks.length)}`;
    }

    const filtered = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => track.title.toLowerCase().includes(searchQuery));

    if (filtered.length === 0) {
      trackList.innerHTML =
        '<p class="empty-text">Пока пусто. Нажми плюс.</p>';
      return;
    }

    filtered.forEach(({ track, index }) => {
      const item = document.createElement("div");
      item.className = "track" + (index === currentIndex ? " active" : "");

      item.innerHTML = `
        <div class="cover">♪</div>

        <div class="track-info">
          <div class="track-title">${escapeHtml(track.title)}</div>
          <div class="track-artist">${escapeHtml(track.artist)}</div>
        </div>

        <button class="delete-track" type="button">×</button>
      `;

      item.addEventListener("click", () => {
        currentIndex = index;
        loadCurrent(true);
        renderTracks();
      });

      const deleteBtn = item.querySelector(".delete-track");

      deleteBtn.addEventListener("click", async (event) => {
        event.stopPropagation();

        await deleteTrack(index);
      });

      trackList.appendChild(item);
    });
  }

  async function deleteTrack(index) {
    const track = tracks[index];
    if (!track) return;

    try {
      await deleteTrackFromDb(track.id);
    } catch (error) {
      console.warn("Не удалось удалить из IndexedDB:", error);
    }

    if (track.url) {
      URL.revokeObjectURL(track.url);
    }

    const wasCurrent = index === currentIndex;

    tracks.splice(index, 1);

    if (tracks.length === 0) {
      currentIndex = -1;
      audio.pause();
      audio.src = "";
      miniPlayer.classList.add("hidden");
      fullPlayer.classList.add("hidden");
      updateProgress();
      updateButtons();
      renderTracks();
      return;
    }

    if (currentIndex >= tracks.length) {
      currentIndex = tracks.length - 1;
    }

    if (index < currentIndex) {
      currentIndex--;
    }

    if (wasCurrent) {
      loadCurrent(false);
    }

    renderTracks();
  }

  function loadCurrent(autoplay) {
    const track = tracks[currentIndex];
    if (!track) return;

    audio.src = track.url;

    miniTitle.textContent = track.title;
    miniArtist.textContent = track.artist;

    fullTitle.textContent = track.title;
    fullArtist.textContent = track.artist;

    miniPlayer.classList.remove("hidden");

    if (autoplay) {
      audio.play().catch((error) => {
        console.error("Не удалось запустить аудио:", error);
      });
    }

    updateButtons();
    updateProgress();
  }

  async function togglePlay() {
    if (tracks.length === 0) return;

    if (currentIndex === -1) {
      currentIndex = 0;
      loadCurrent(false);
    }

    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (error) {
      console.error("Ошибка воспроизведения:", error);
    }

    updateButtons();
  }

  function nextTrack(auto = false) {
    if (tracks.length === 0) return;

    if (isShuffle && tracks.length > 1) {
      let nextIndex = currentIndex;

      while (nextIndex === currentIndex) {
        nextIndex = Math.floor(Math.random() * tracks.length);
      }

      currentIndex = nextIndex;
      loadCurrent(true);
      renderTracks();
      return;
    }

    if (currentIndex < tracks.length - 1) {
      currentIndex++;
      loadCurrent(true);
      renderTracks();
      return;
    }

    if (repeatMode === "playlist") {
      currentIndex = 0;
      loadCurrent(true);
      renderTracks();
      return;
    }

    if (auto) {
      audio.pause();
      audio.currentTime = 0;
      updateButtons();
    }
  }

  function previousTrack() {
    if (tracks.length === 0) return;

    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    if (currentIndex > 0) {
      currentIndex--;
      loadCurrent(true);
      renderTracks();
    }
  }

  function openFullPlayer() {
    if (currentIndex === -1) return;
    fullPlayer.classList.remove("hidden");
  }

  function updateButtons() {
    const icon = audio.paused ? "▶" : "⏸";

    miniPlayBtn.textContent = icon;
    playBtn.textContent = icon;

    shuffleBtn.classList.toggle("active", isShuffle);
    repeatBtn.classList.toggle("active", repeatMode !== "off");

    repeatBtn.textContent = repeatMode === "one" ? "↺1" : "↻";
  }

  function updateProgress() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

    progressBar.max = duration || 100;
    progressBar.value = current;

    currentTime.textContent = formatTime(current);
    durationTime.textContent = formatTime(duration);
  }

  function getCleanFileName(file) {
    const rawName = file.name && file.name.trim() ? file.name.trim() : "untitled";

    try {
      const decoded = decodeURIComponent(rawName);
      return decoded.replace(/\.[^/.]+$/, "") || "untitled";
    } catch {
      return rawName.replace(/\.[^/.]+$/, "") || "untitled";
    }
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00";

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function pluralTrack(count) {
    const lastDigit = count % 10;
    const lastTwo = count % 100;

    if (lastTwo >= 11 && lastTwo <= 14) return "треков";
    if (lastDigit === 1) return "трек";
    if (lastDigit >= 2 && lastDigit <= 4) return "трека";
    return "треков";
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[char];
    });
  }

  renderTracks();
});