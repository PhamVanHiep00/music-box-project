/**
 * ==============================================================================
 * Global Configurations & Environment Variables
 * ==============================================================================
 */

// Firebase Service Configurations
const firebaseConfig = {
  apiKey: "AIzaSyA5e5QwVu0cKXRLx743cEk74J4xPiEp9qA",
  authDomain: "music-box-87234.firebaseapp.com",
  databaseURL: "https://music-box-87234-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "music-box-87234",
  storageBucket: "music-box-87234.firebasestorage.app",
  messagingSenderId: "659368332742",
  appId: "1:659368332742:web:277268d8c509ededbdb6c7"
};

// Initialize Firebase Realtime Database Instance
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Administrative Credentials & External API Keys
const MY_ADMIN_CODE = "admin123";
const YOUTUBE_API_KEY = "AIzaSyBy9wjn6KtQMurf7P_aYtXNfwfJKzq52xA";

/**
 * ==============================================================================
 * Application State Management Variables
 * ==============================================================================
 */

// Local Media Stream & Hardware States
let localStream = null;
let isMicOn = true;
let isCamOn = true;
let selectedAvatar = "🐱";

// User & Session Identity
let currentRoomId = null;
let myUserId = "user_" + Math.random().toString(36).substr(2, 6);
let isAdmin = false;

// PeerJS Connection Pool & Signalling
let peer = null;
let calls = {};

// YouTube Embedded Player & Queue Controller
let ytPlayer = null;
let currentSongKey = null;
let currentVideoId = null;
let currentVolume = 100; // Mặc định âm lượng 100%

// PeerJS ICE Server Topology Configuration
const peerConfig = {
    config: {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            {
                urls: "turn:openrelay.metered.ca:80",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            {
                urls: "turn:openrelay.metered.ca:443",
                username: "openrelayproject",
                credential: "openrelayproject"
            }
        ]
    }
};

/**
 * ==============================================================================
 * User Profile & UI Event Handlers
 * ==============================================================================
 */

function selectAvatar(element) {
    document.querySelectorAll('.avatar-item').forEach(item => item.classList.remove('selected'));
    element.classList.add('selected');
    selectedAvatar = element.innerText;
}

function openAdminModal() {
    document.getElementById('admin-modal').style.display = 'flex';
}

function closeAdminModal() {
    document.getElementById('admin-modal').style.display = 'none';
}

function handleAdminSubmit(e) {
    e.preventDefault();
    const inputCode = document.getElementById('admin-code-input').value.trim();
    if (inputCode === MY_ADMIN_CODE) {
        alert("Xác thực Admin thành công!");
        isAdmin = true;
        document.getElementById('btn-create-room').style.display = 'block';
        closeAdminModal();
    } else {
        alert("Sai Admin Code!");
    }
}

/**
 * ==============================================================================
 * Room Lifecycle & Realtime Database Synchronization
 * ==============================================================================
 */

async function createRoom() {
    const roomId = document.getElementById('room-id').value.trim();
    const roomPass = document.getElementById('room-pass').value.trim();
    const userName = document.getElementById('user-name').value.trim();

    if (!roomId || !roomPass || !userName) return alert("Vui lòng nhập đủ thông tin!");

    const roomRef = db.ref(`rooms/${roomId}`);
    const snapshot = await roomRef.once('value');
    if (snapshot.exists()) return alert("ID Phòng đã tồn tại!");

    isAdmin = true;
    await roomRef.set({ password: roomPass, hostId: myUserId });
    enterRoomProcess(roomId, userName);
}

async function joinRoom() {
    const roomId = document.getElementById('room-id').value.trim();
    const roomPass = document.getElementById('room-pass').value.trim();
    const userName = document.getElementById('user-name').value.trim();

    if (!roomId || !roomPass || !userName) return alert("Vui lòng nhập đủ thông tin!");

    const roomRef = db.ref(`rooms/${roomId}`);
    const snapshot = await roomRef.once('value');
    if (!snapshot.exists()) return alert("Phòng không tồn tại!");
    if (snapshot.val().password !== roomPass) return alert("Sai mật khẩu!");

    enterRoomProcess(roomId, userName);
}

async function enterRoomProcess(roomId, userName) {
    currentRoomId = roomId;

    document.getElementById('display-room-id').innerText = roomId;
    document.getElementById('local-name-tag').innerText = userName + (isAdmin ? " (Admin)" : " (Bạn)");
    document.getElementById('local-avatar').innerText = selectedAvatar;

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'flex';

    updateAdminControlsUI();

    await initMedia();
    initPeerJS(userName);

    listenForMusicBox(roomId);
}

function updateAdminControlsUI() {
    const btnSkip = document.getElementById('btn-skip-song');
    if (btnSkip) {
        // Cho phép tất cả mọi người nhìn thấy và bấm chuyển bài
        btnSkip.style.display = 'inline-block';
    }
}

async function initMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVid = document.getElementById('local-video');
        localVid.srcObject = localStream;
        localVid.muted = true;
        isMicOn = true;
        isCamOn = true;
    } catch (e) {
        console.warn("Chưa cấp quyền Mic/Cam:", e);
        isMicOn = false;
        isCamOn = false;
    }
    updateMicUI(isMicOn);
    updateCamUI(isCamOn);
}

/**
 * ==============================================================================
 * WebRTC Peer-to-Peer Signaling & Mesh Network Management
 * ==============================================================================
 */

function initPeerJS(userName) {
    peer = new Peer(myUserId, peerConfig);

    peer.on('open', (id) => {
        const myUserRef = db.ref(`rooms/${currentRoomId}/users/${myUserId}`);
        myUserRef.set({ 
            name: userName, 
            avatar: selectedAvatar,
            isMicOn: isMicOn, 
            isCamOn: isCamOn,
            isAdmin: isAdmin
        });
        myUserRef.onDisconnect().remove();

        listenForUsers();
    });

    peer.on('call', (call) => {
        call.answer(localStream);
        
        call.on('stream', (remoteStream) => {
            addRemoteStream(call.peer, remoteStream);
        });

        calls[call.peer] = call;
    });
}

function listenForUsers() {
    const usersRef = db.ref(`rooms/${currentRoomId}/users`);

    usersRef.on('child_added', (snapshot) => {
        const userId = snapshot.key;
        const userData = snapshot.val();

        if (userId !== myUserId) {
            createRemoteUserCard(userId, userData.name, userData.avatar || "👤");
            updateUserStatusUI(userId, userData.isMicOn, userData.isCamOn);
            
            if (localStream) {
                const call = peer.call(userId, localStream);
                call.on('stream', (remoteStream) => {
                    addRemoteStream(userId, remoteStream);
                });
                calls[userId] = call;
            }
        }
    });

    usersRef.on('child_changed', (snapshot) => {
        const userId = snapshot.key;
        const userData = snapshot.val();
        updateUserStatusUI(userId, userData.isMicOn, userData.isCamOn);
    });

    usersRef.on('child_removed', (snapshot) => {
        const userId = snapshot.key;
        removeRemoteUserCard(userId);
        if (calls[userId]) {
            calls[userId].close();
            delete calls[userId];
        }
    });
}

function addRemoteStream(userId, stream) {
    const remoteVideo = document.getElementById(`video-${userId}`);
    if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        
        remoteVideo.play().catch(() => {
            window.addEventListener('click', () => remoteVideo.play(), { once: true });
        });
    }
}

function createRemoteUserCard(userId, userName, avatar) {
    if (document.getElementById(`card-${userId}`)) return;

    const container = document.getElementById('participants-container');
    const userCard = document.createElement('div');
    userCard.className = 'user-card';
    userCard.id = `card-${userId}`;

    userCard.innerHTML = `
        <video id="video-${userId}" class="user-video" autoplay playsinline></video>
        <div id="avatar-${userId}" class="user-avatar" style="display:none;">${avatar}</div>
        <div class="status-badge">
            <span id="mic-badge-${userId}" class="badge-icon">🎙️</span>
            <span id="cam-badge-${userId}" class="badge-icon">📹</span>
        </div>
        <span class="user-name">${userName}</span>
    `;
    container.appendChild(userCard);
}

function removeRemoteUserCard(userId) {
    const card = document.getElementById(`card-${userId}`);
    if (card) card.remove();
}

function updateUserStatusUI(userId, micActive, camActive) {
    let micBadge, camBadge, remoteVideo, remoteAvatar;

    if (userId === myUserId) {
        micBadge = document.getElementById('local-mic-badge');
        camBadge = document.getElementById('local-cam-badge');
    } else {
        micBadge = document.getElementById(`mic-badge-${userId}`);
        camBadge = document.getElementById(`cam-badge-${userId}`);
        remoteVideo = document.getElementById(`video-${userId}`);
        remoteAvatar = document.getElementById(`avatar-${userId}`);
    }

    if (micBadge) {
        micBadge.innerText = micActive ? "🎙️" : "🔇";
        micBadge.classList.toggle('off', !micActive);
    }

    if (camBadge) {
        camBadge.innerText = camActive ? "📹" : "🚫";
        camBadge.classList.toggle('off', !camActive);
    }

    if (userId !== myUserId && remoteVideo && remoteAvatar) {
        remoteVideo.style.display = camActive ? 'block' : 'none';
        remoteAvatar.style.display = camActive ? 'none' : 'flex';
    }
}

/**
 * ==============================================================================
 * Hardware Controls (Audio / Video Track Muters)
 * ==============================================================================
 */

function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMicOn = audioTrack.enabled;
        
        updateMicUI(isMicOn);
        updateUserStatusUI(myUserId, isMicOn, isCamOn);

        if (currentRoomId) {
            db.ref(`rooms/${currentRoomId}/users/${myUserId}`).update({ isMicOn: isMicOn });
        }
    }
}

function toggleCam() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        isCamOn = videoTrack.enabled;

        updateCamUI(isCamOn);
        updateUserStatusUI(myUserId, isCamOn, isCamOn);

        if (currentRoomId) {
            db.ref(`rooms/${currentRoomId}/users/${myUserId}`).update({ isCamOn: isCamOn });
        }
    }
}

function updateMicUI(on) {
    document.getElementById('mic-label').innerText = on ? "Tắt Mic" : "Bật Mic";
    document.getElementById('mic-btn').classList.toggle('off', !on);
}

function updateCamUI(on) {
    document.getElementById('local-video').style.display = on ? 'block' : 'none';
    document.getElementById('local-avatar').style.display = on ? 'none' : 'flex';
    document.getElementById('cam-label').innerText = on ? "Tắt Cam" : "Bật Cam";
    document.getElementById('cam-btn').classList.toggle('off', !on);
}

/**
 * ==============================================================================
 * YouTube Data API Integration & Playlist Queue Management
 * ==============================================================================
 */

async function searchYouTube() {
    const input = document.getElementById('song-search');
    const query = input.value.trim();
    if (!query) return;

    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '<p class="placeholder-text">🔍 Đang tìm kiếm trên YouTube...</p>';

    let searchQuery = query;
    if (!searchQuery.toLowerCase().includes('karaoke')) {
        searchQuery += ' karaoke';
    }

    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=6&q=${encodeURIComponent(searchQuery)}&type=video&key=${YOUTUBE_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message);
        }

        resultsContainer.innerHTML = '';
        const items = data.items;

        if (!items || items.length === 0) {
            resultsContainer.innerHTML = '<p class="placeholder-text">Không tìm thấy bài hát nào!</p>';
            return;
        }

        items.forEach(item => {
            const videoId = item.id.videoId;
            const titleEscaped = item.snippet.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const channelTitle = item.snippet.channelTitle;
            const thumbUrl = item.snippet.thumbnails.default.url;

            const card = document.createElement('div');
            card.className = 'song-card';
            card.innerHTML = `
                <div class="song-card-content">
                    <img src="${thumbUrl}" alt="thumb">
                    <div class="song-info">
                        <span class="song-title">${item.snippet.title}</span>
                        <span class="song-artist">${channelTitle}</span>
                    </div>
                </div>
                <button class="btn-select" onclick="addToQueue('${videoId}', '${titleEscaped}')">+ Thêm</button>
            `;
            resultsContainer.appendChild(card);
        });

    } catch (err) {
        console.error("Lỗi tìm kiếm YouTube:", err);
        resultsContainer.innerHTML = `<p class="placeholder-text" style="color:#ff4757;">❌ Lỗi tìm kiếm: ${err.message}</p>`;
    }
}

function addToQueue(videoId, title) {
    if (!currentRoomId) return;
    db.ref(`rooms/${currentRoomId}/queue`).push({
        videoId: videoId,
        title: title,
        addedBy: myUserId
    });
}

function listenForMusicBox(roomId) {
    db.ref(`rooms/${roomId}/queue`).on('value', (snapshot) => {
        const queueData = snapshot.val();
        const queueListDiv = document.getElementById('queue-list');
        queueListDiv.innerHTML = '';

        if (!queueData) {
            document.getElementById('queue-count').innerText = "0";
            document.getElementById('lyric-screen').classList.remove('active');
            document.getElementById('selection-screen').classList.add('active');
            if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
                ytPlayer.stopVideo();
            }
            currentVideoId = null;
            currentSongKey = null;
            return;
        }

        const keys = Object.keys(queueData);
        document.getElementById('queue-count').innerText = keys.length;

        keys.forEach((key, index) => {
            if (index > 0) {
                const item = queueData[key];
                const badge = document.createElement('div');
                badge.className = 'queue-item';
                badge.innerText = `${index}. ${item.title}`;
                queueListDiv.appendChild(badge);
            }
        });

        const firstKey = keys[0];
        const firstSong = queueData[firstKey];

        if (currentVideoId !== firstSong.videoId) {
            currentVideoId = firstSong.videoId;
            currentSongKey = firstKey;
            
            playYouTubeVideo(firstSong.videoId, firstSong.title);
        }
    });
}

function playYouTubeVideo(videoId, title) {
    document.getElementById('selection-screen').classList.remove('active');
    document.getElementById('lyric-screen').classList.add('active');
    document.getElementById('playing-song-info').innerText = `🎤 Đang phát: ${title}`;

    if (!ytPlayer) {
        ytPlayer = new YT.Player('youtube-player', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: { 
                'autoplay': 1, 
                'controls': 1, // Tất cả người dùng đều có thanh điều khiển trên video
                'origin': window.location.origin || 'http://localhost'
            },
            host: 'https://www.youtube-nocookie.com',
            events: {
                'onReady': (event) => {
                    event.target.setVolume(currentVolume);
                    event.target.playVideo();
                },
                'onStateChange': (event) => {
                    if (event.data === 0) { // Khi video phát hết tự chuyển bài tiếp
                        skipSong();
                    }
                }
            }
        });
    } else {
        ytPlayer.loadVideoById(videoId);
        ytPlayer.setVolume(currentVolume);
        ytPlayer.playVideo();
    }
}

// Hàm thay đổi âm lượng YouTube Player
function setVolume(val) {
    currentVolume = parseInt(val, 10);
    document.getElementById('volume-val').innerText = `${currentVolume}%`;
    if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
        ytPlayer.setVolume(currentVolume);
    }
}

// Bất kỳ ai bấm nút này cũng sẽ xóa bài hát hiện tại khỏi danh sách chờ để chuyển sang bài tiếp theo
function skipSong() {
    if (!currentRoomId || !currentSongKey) return;
    db.ref(`rooms/${currentRoomId}/queue/${currentSongKey}`).remove();
}

function leaveRoom() {
    if (currentRoomId) db.ref(`rooms/${currentRoomId}/users/${myUserId}`).remove();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    location.reload();
}